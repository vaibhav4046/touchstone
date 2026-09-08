/**
 * The credit budget, and the rule it has to satisfy.
 *
 * The Arena issues 100 credits, requires at least 80 of them spent across at
 * least 3 distinct sellers, and disqualifies an overspend. Those are three
 * different failures — too little, too concentrated, too much — so they are
 * three named shortfalls here rather than one boolean, and the one that is
 * unrecoverable is the only one enforced at write time: a purchase that would
 * pass 100 is refused, because credits that do not exist cannot be handed back
 * after the fact. Falling short is recoverable while the round is open, so it
 * is reported on every read instead of blocking one.
 *
 * Every purchase records what it bought and why it was bought. A ledger that
 * only records amounts cannot answer the question a judge actually asks, which
 * is not how much was spent but what the agent thought it was buying.
 */

export const ARENA_BUDGET = 100;
export const MIN_SPEND = 80;
export const MIN_SELLERS = 3;

/** Aim above the floor: a plan that lands exactly on 80 fails on one refused purchase. */
const TARGET_SPEND = 90;
/** How far down the ranking credits are spread. Enough for the rule, plus one. */
const SPREAD = 4;
const WEIGHTS: readonly number[] = [0.4, 0.3, 0.2, 0.1];

export interface Purchase {
  readonly seller: string;
  readonly sellerName: string;
  readonly credits: number;
  /** What the credits bought, in the seller's own terms. */
  readonly bought: string;
  /** Why this seller and this amount, in the buyer's terms. */
  readonly why: string;
  /** Whether anything came back. A purchase is recorded either way; silence is a fact about the seller. */
  readonly delivered: boolean;
  readonly at: string;
}

export interface LedgerState {
  readonly budget: number;
  readonly spent: number;
  readonly remaining: number;
  readonly distinctSellers: number;
  readonly purchases: readonly Purchase[];
  readonly satisfiesRule: boolean;
  /** Named gaps between this ledger and the Arena rule. Empty when it complies. */
  readonly shortfall: readonly string[];
}

export type RecordOutcome =
  | { readonly ok: true; readonly purchase: Purchase; readonly ledger: LedgerState }
  | { readonly ok: false; readonly reason: string; readonly ledger: LedgerState };

declare global {
  // eslint-disable-next-line no-var
  var __yuzuArenaLedger: Purchase[] | undefined;
}

function entries(): Purchase[] {
  globalThis.__yuzuArenaLedger ??= [];
  return globalThis.__yuzuArenaLedger;
}

export function ledger(): LedgerState {
  const purchases = [...entries()];
  const spent = purchases.reduce((total, purchase) => total + purchase.credits, 0);
  const sellers = new Set(purchases.map((purchase) => purchase.seller));

  const shortfall: string[] = [];
  if (spent < MIN_SPEND) {
    shortfall.push(`${MIN_SPEND - spent} credits short of the ${MIN_SPEND} the Arena requires spent.`);
  }
  if (sellers.size < MIN_SELLERS) {
    shortfall.push(
      `${sellers.size} distinct seller${sellers.size === 1 ? "" : "s"} bought from; the Arena requires ${MIN_SELLERS}.`,
    );
  }
  if (spent > ARENA_BUDGET) {
    shortfall.push(`${spent - ARENA_BUDGET} credits over the ${ARENA_BUDGET} issued.`);
  }

  return {
    budget: ARENA_BUDGET,
    spent,
    remaining: Math.max(0, ARENA_BUDGET - spent),
    distinctSellers: sellers.size,
    purchases,
    satisfiesRule: shortfall.length === 0,
    shortfall,
  };
}

export function record(entry: Omit<Purchase, "at">): RecordOutcome {
  const before = ledger();
  if (!Number.isInteger(entry.credits) || entry.credits <= 0) {
    return { ok: false, reason: "A purchase has to be a whole number of credits, and at least one.", ledger: before };
  }
  if (entry.credits > before.remaining) {
    return {
      ok: false,
      reason: `${entry.credits} credits would take the total to ${before.spent + entry.credits}, past the ${ARENA_BUDGET} the Arena issued.`,
      ledger: before,
    };
  }

  const purchase: Purchase = { ...entry, at: new Date().toISOString() };
  entries().push(purchase);
  return { ok: true, purchase, ledger: ledger() };
}

/** Only for tests and a fresh Arena run. A live round never resets its own ledger. */
export function resetLedger(): void {
  globalThis.__yuzuArenaLedger = [];
}

export interface Allocatable {
  readonly seller: string;
  readonly sellerName: string;
  /** 0..100 from the ranking. Ordering is the caller's; this file only splits money. */
  readonly standing: number;
  /** A product the assay flagged. Avoided while the rule can still be met without it. */
  readonly flagged: boolean;
  readonly note?: string;
}

export interface Allocation {
  readonly seller: string;
  readonly sellerName: string;
  readonly credits: number;
  readonly why: string;
}

export interface SpendPlan {
  readonly allocations: readonly Allocation[];
  readonly total: number;
  readonly satisfiesRule: boolean;
  readonly note: string;
}

/**
 * Turn a ranking into a spend that satisfies the rule.
 *
 * Flagged products are excluded while three clean ones remain, and pulled back
 * in — with the reason recorded against the purchase — when they do not. That
 * ordering matters: the rule says three distinct sellers, so an agent that
 * refuses to buy from anything it criticised would be disqualified for its
 * principles. Saying so in the ledger is the honest version of complying.
 */
export function allocate(candidates: readonly Allocatable[], remaining: number = ledger().remaining): SpendPlan {
  const clean = candidates.filter((candidate) => !candidate.flagged);
  const forced =
    clean.length >= MIN_SELLERS ? [] : candidates.filter((candidate) => candidate.flagged).slice(0, MIN_SELLERS - clean.length);
  const pool = [...clean, ...forced].slice(0, SPREAD);
  const state = ledger();

  if (pool.length === 0 || remaining <= 0) {
    return {
      allocations: [],
      total: 0,
      satisfiesRule: false,
      note:
        pool.length === 0
          ? "No candidate could be allocated to: nothing was tried, so nothing is bought."
          : `No credits left to allocate: ${state.spent} of ${ARENA_BUDGET} already spent.`,
    };
  }

  const target = Math.min(remaining, TARGET_SPEND);
  const credits = split(target, pool.length);
  const allocations = pool.flatMap((candidate, index) => {
    const amount = credits[index] ?? 0;
    if (amount <= 0) return [];
    return [
      {
        seller: candidate.seller,
        sellerName: candidate.sellerName,
        credits: amount,
        why: reasonFor(candidate, index, forced.includes(candidate), clean.length),
      },
    ];
  });

  const total = allocations.reduce((sum, allocation) => sum + allocation.credits, 0);
  const distinct = new Set([
    ...state.purchases.map((purchase) => purchase.seller),
    ...allocations.map((allocation) => allocation.seller),
  ]).size;
  const projected = state.spent + total;

  return {
    allocations,
    total,
    satisfiesRule: projected >= MIN_SPEND && projected <= ARENA_BUDGET && distinct >= MIN_SELLERS,
    note:
      `Spending ${total} of the ${remaining} credits left, across ${allocations.length} of ${candidates.length} products tried. ` +
      (forced.length > 0
        ? `${forced.length} flagged product${forced.length === 1 ? " was" : "s were"} included because only ${clean.length} cleared the assay and the Arena requires ${MIN_SELLERS} distinct sellers.`
        : "Flagged products were excluded; enough clean ones remained to meet the rule without them."),
  };
}

function reasonFor(candidate: Allocatable, index: number, wasForced: boolean, cleanCount: number): string {
  const rank = `Ranked #${index + 1} at standing ${candidate.standing}.`;
  const forced = wasForced
    ? ` Bought under protest: the assay flagged it, and only ${cleanCount} product${cleanCount === 1 ? "" : "s"} cleared, so the three-seller rule cannot be met without it.`
    : "";
  const note = candidate.note === undefined ? "" : ` ${candidate.note}`;
  return `${rank}${forced}${note}`;
}

/**
 * Split a whole-credit total by rank weight.
 *
 * Largest-remainder rather than rounding each share independently, because
 * independent rounding does not add up to the target, and a plan that is one
 * credit short of the target is one credit short of the rule.
 */
function split(target: number, count: number): readonly number[] {
  const weights = WEIGHTS.slice(0, count);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const raw = weights.map((weight) => (weight / sum) * target);
  const shares = raw.map(Math.floor);

  const remainders = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  let left = target - shares.reduce((total, share) => total + share, 0);
  for (const { index } of remainders) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}
