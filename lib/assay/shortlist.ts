import type { AssayInput } from "./types";
import { assay } from "./engine";
import type { Receipt } from "./receipt";

export interface ShortlistEntry {
  readonly rank: number;
  readonly vendor: string;
  readonly verdict: string;
  readonly score: number;
  readonly askingPrice?: number;
  readonly recommendedMaxPrice?: number;
  readonly allocated: number;
  readonly decision: "buy" | "trial" | "hold" | "avoid";
  readonly why: string;
  readonly receiptId: string;
}

export interface Shortlist {
  readonly goal?: string;
  readonly budget?: number;
  readonly spent: number;
  readonly held: number;
  readonly entries: readonly ShortlistEntry[];
  readonly receipts: readonly Receipt[];
  readonly elapsedMs: number;
}

/**
 * A buyer with a hundred credits and thirty listings does not need thirty
 * verdicts — it needs to know where the credits go.
 *
 * Ranking is by score, but allocation is by verdict, because those are
 * different questions. A flagged vendor is skipped no matter how it ranks; an
 * unproven one is worth exactly one trial rather than a commitment; and
 * whatever is left over stays unspent rather than being pushed into the next
 * name on the list. Held budget is a recommendation too.
 */
export async function shortlist(
  vendors: readonly AssayInput[],
  options: { readonly budget?: number; readonly goal?: string } = {},
): Promise<Shortlist> {
  const started = Date.now();
  const outcomes = await Promise.all(vendors.map((vendor) => assay(vendor)));

  const ranked = outcomes
    .map((outcome) => outcome.receipt)
    .sort((left, right) => right.report.score - left.report.score);

  let remaining = options.budget ?? Number.POSITIVE_INFINITY;
  const entries: ShortlistEntry[] = ranked.map((receipt, index) => {
    const report = receipt.report;
    const ask = report.recommendedMaxPrice;

    if (report.verdict === "FLAGGED") {
      return entry(index, receipt, 0, "avoid", "Flagged. Nothing it charges is a good price.");
    }
    if (ask === undefined) {
      return entry(index, receipt, 0, "hold", "No price quoted, so no allocation can be made. Ask for one.");
    }
    if (ask > remaining) {
      return entry(index, receipt, 0, "hold", `Costs ${ask} with ${fmt(remaining)} left. Out of budget at this rank.`);
    }

    remaining -= ask;
    if (report.verdict === "TRUSTED") {
      return entry(index, receipt, ask, "buy", `Every checked commitment held. Pay up to ${ask}.`);
    }
    return entry(index, receipt, ask, "trial", `Enough held up to justify one job, not a standing order. Cap at ${ask}.`);
  });

  const spent = entries.reduce((sum, item) => sum + item.allocated, 0);
  return {
    goal: options.goal,
    budget: options.budget,
    spent,
    held: options.budget === undefined ? 0 : Math.max(0, Math.round((options.budget - spent) * 100) / 100),
    entries,
    receipts: ranked,
    elapsedMs: Date.now() - started,
  };
}

function entry(
  index: number,
  receipt: Receipt,
  allocated: number,
  decision: ShortlistEntry["decision"],
  why: string,
): ShortlistEntry {
  return {
    rank: index + 1,
    vendor: receipt.report.vendor,
    verdict: receipt.report.verdict,
    score: receipt.report.score,
    recommendedMaxPrice: receipt.report.recommendedMaxPrice,
    allocated,
    decision,
    why,
    receiptId: receipt.receiptId,
  };
}

function fmt(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "no limit";
}
