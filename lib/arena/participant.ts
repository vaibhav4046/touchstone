import { assay } from "../assay/engine";
import type { AssayReport } from "../assay/types";
import { listSellers } from "../market/registry";
import { slug } from "../sharedos/identity";
import { critique, type Critique } from "./critique";
import { MIN_SELLERS, allocate, ledger, record, type Allocatable, type LedgerState, type Purchase, type SpendPlan } from "./ledger";

/**
 * The buyer side, running with nobody watching.
 *
 * The Arena rule is blunt: no person sends a message, ranks, buys, or fixes an
 * agent by hand while it runs. That rules out the two habits a buyer agent
 * usually leans on — asking for approval before spending, and throwing when a
 * seller misbehaves. So there is no escalation anywhere on this path (the assay
 * engine's probe path requests one, which is why the trial here is the
 * participant's own bounded call rather than that), and every failure is a
 * value: a product that times out is ranked last with the timeout as the stated
 * reason, because "did not answer" is a finding about a seller, not an error in
 * the buyer.
 *
 *   discover -> trial -> assay -> critique -> rank        (round 1)
 *   allocate -> spend -> ledger                           (round 2)
 *
 * Round 2 will run round 1 first if it has to. An agent that answers "I was
 * never told to start" has failed the round on its own.
 */

const BUYER_ID = "yuzu-arena-buyer";
const MAX_TRIED = 5;
/** The Arena floor: fewer than this and the round does not count. */
const MIN_TRIED = 3;
const TRIAL_TIMEOUT_MS = 8_000;
const PURCHASE_TIMEOUT_MS = 8_000;
/** Below this a listing has nothing to assay; the trial carries the judgement instead. */
const MIN_ASSAYABLE = 20;
/** A listing that steers its reader cannot buy its way up with a good pitch. */
const FLAGGED_CEILING = 15;
/** A published endpoint that did not answer is a broken promise, not a missing one. */
const FAILED_TRIAL_CEILING = 30;
/** No endpoint published: unproven rather than failed, so it scores between silence and delivery. */
const UNPROVEN_TRIAL = 25;

const TRIAL_TASK =
  "Trial request from an autonomous buyer: in one response, produce your smallest real unit of work for a coffee brand called Ember, and state what it costs and how long it took.";

export interface Candidate {
  readonly name: string;
  readonly pitch: string;
  readonly endpoint?: string;
  readonly price?: number;
}

export interface TrialRecord {
  readonly answered: boolean;
  /** Whether a call was actually made. A published endpoint that fails is a breach; no endpoint is only silence. */
  readonly attempted: boolean;
  readonly latencyMs: number;
  /** What the product actually returned, truncated. Untrusted text, quoted but never obeyed. */
  readonly excerpt: string;
  readonly note: string;
}

export interface Ranked {
  readonly rank: number;
  readonly seller: string;
  readonly product: string;
  /** 0..100. Listing evidence at 0.8, observed behaviour at 0.2, floored for a flagged listing. */
  readonly standing: number;
  readonly verdict: string;
  readonly flagged: boolean;
  readonly reason: string;
  readonly trial: TrialRecord;
  readonly critique: Critique;
}

export interface RoundOneResult {
  readonly round: 1;
  readonly at: string;
  readonly tried: number;
  readonly ranking: readonly Ranked[];
  readonly meetsRule: boolean;
  readonly shortfall: readonly string[];
  readonly post: string;
}

export interface RoundTwoResult {
  readonly round: 2;
  readonly at: string;
  readonly plan: SpendPlan;
  readonly purchases: readonly Purchase[];
  readonly refused: readonly string[];
  readonly ledger: LedgerState;
  readonly post: string;
}

export type RoundResult = RoundOneResult | RoundTwoResult;

interface ArenaState {
  readonly at: string;
  readonly candidates: readonly Candidate[];
  readonly ranking: readonly Ranked[];
  readonly post: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __yuzuArenaRun: ArenaState | undefined;
}

export function arenaState(): ArenaState | undefined {
  return globalThis.__yuzuArenaRun;
}

export async function runRound(input: {
  readonly round: 1 | 2;
  readonly candidates?: readonly Candidate[];
}): Promise<RoundResult> {
  if (input.round === 1) return roundOne(input.candidates ?? []);

  // Round 2 without a round 1 is a buyer with nothing to allocate against, and
  // there is nobody to ask, so it runs the missing round itself.
  if (arenaState() === undefined) await roundOne(input.candidates ?? []);
  return roundTwo(arenaState());
}

/** Try at least three products, disagree with each specifically, and rank all of them. */
async function roundOne(supplied: readonly Candidate[]): Promise<RoundOneResult> {
  const candidates = discover(supplied);

  const ranked = await Promise.all(
    candidates.map(async (candidate) => {
      const [trial, report] = await Promise.all([runTrial(candidate), safeAssay(candidate)]);
      const written = await critique({
        product: candidate.name,
        listing: candidate.pitch,
        trial: trialText(candidate, trial),
        trialAnswered: trial.answered,
        report,
      });
      return { candidate, trial, report, critique: written };
    }),
  );

  const ranking = rank(ranked);
  const shortfall = ruleGaps(ranking);
  const post = roundOnePost(ranking, shortfall, supplied.length);

  globalThis.__yuzuArenaRun = { at: new Date().toISOString(), candidates, ranking, post };

  return {
    round: 1,
    at: new Date().toISOString(),
    tried: ranking.length,
    ranking,
    meetsRule: shortfall.length === 0,
    shortfall,
    post,
  };
}

/** Spend the budget the ranking argued for, and record what each purchase was for. */
async function roundTwo(state: ArenaState | undefined): Promise<RoundTwoResult> {
  const ranking = state?.ranking ?? [];
  const plan = allocate(
    ranking.map(
      (entry): Allocatable => ({
        seller: entry.seller,
        sellerName: entry.product,
        standing: entry.standing,
        flagged: entry.flagged,
        note: entry.critique.disagreements.length > 0 ? `${entry.critique.disagreements.length} disagreements still unanswered.` : undefined,
      }),
    ),
  );

  const purchases: Purchase[] = [];
  const refused: string[] = [];

  // Sequential, because the budget is shared state: two concurrent purchases
  // can each see room for the last credits and both be recorded.
  for (const allocation of plan.allocations) {
    const candidate = state?.candidates.find((entry) => slug(entry.name) === allocation.seller);
    const delivery = await buy(candidate, allocation.credits);
    const outcome = record({
      seller: allocation.seller,
      sellerName: allocation.sellerName,
      credits: allocation.credits,
      bought: bought(candidate, allocation.credits),
      why: `${allocation.why} ${delivery.note}`,
      delivered: delivery.answered,
    });
    if (outcome.ok) purchases.push(outcome.purchase);
    else refused.push(`${allocation.sellerName}: ${outcome.reason}`);
  }

  const settled = ledger();
  return {
    round: 2,
    at: new Date().toISOString(),
    plan,
    purchases,
    refused,
    ledger: settled,
    post: roundTwoPost(plan, purchases, settled, refused),
  };
}

/**
 * Candidates come from the room; the registry only tops up a short list.
 *
 * Three is the Arena floor, so a round that was handed two competitors has to
 * find a third rather than report that it could not comply. Topping up is
 * declared in the post, because filling the quota from the house market is a
 * weaker round than trying three rivals and should read as one.
 */
function discover(supplied: readonly Candidate[]): readonly Candidate[] {
  const usable = supplied.filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0);
  const pool = usable.length >= MIN_TRIED ? usable : [...usable, ...fromRegistry()];

  const seen = new Set<string>();
  const chosen: Candidate[] = [];
  for (const candidate of pool) {
    const id = slug(candidate.name);
    if (seen.has(id)) continue;
    seen.add(id);
    chosen.push(candidate);
    if (chosen.length >= MAX_TRIED) break;
  }
  return chosen;
}

function fromRegistry(): readonly Candidate[] {
  return listSellers().map((seller) => ({
    name: seller.name,
    pitch: seller.pitch,
    endpoint: seller.endpoint,
    price: seller.askPrice,
  }));
}

/**
 * One bounded call to the product, treated as the only evidence about it that
 * the seller did not write. It never throws: a refusal, a timeout and a 500 are
 * all facts about the seller and all end up in the record the same way.
 */
async function runTrial(candidate: Candidate): Promise<TrialRecord> {
  const endpoint = candidate.endpoint;
  if (endpoint === undefined || !/^https?:\/\//i.test(endpoint)) {
    return {
      answered: false,
      attempted: false,
      latencyMs: 0,
      excerpt: "",
      note: "published no reachable endpoint, so nothing could be exercised and only its listing was examined",
    };
  }

  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": BUYER_ID },
      body: JSON.stringify({ task: TRIAL_TASK, from: BUYER_ID, budget: 1 }),
      signal: AbortSignal.timeout(TRIAL_TIMEOUT_MS),
    });
    const body = (await response.text()).slice(0, 2_000);
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return {
        answered: false,
        attempted: true,
        latencyMs,
        excerpt: body.slice(0, 300),
        note: `answered HTTP ${response.status} in ${latencyMs} ms`,
      };
    }
    if (body.trim().length === 0) {
      return {
        answered: false,
        attempted: true,
        latencyMs,
        excerpt: "",
        note: `answered HTTP ${response.status} in ${latencyMs} ms with an empty body`,
      };
    }
    return {
      answered: true,
      attempted: true,
      latencyMs,
      excerpt: body.slice(0, 300),
      note: `answered HTTP ${response.status} in ${latencyMs} ms with ${body.length} characters`,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const reason = error instanceof Error ? error.name : "unknown";
    return {
      answered: false,
      attempted: true,
      latencyMs,
      excerpt: "",
      note: `did not answer within ${TRIAL_TIMEOUT_MS} ms (${reason})`,
    };
  }
}

/** The trial as material a critique can quote. Never empty, whatever happened. */
function trialText(candidate: Candidate, trial: TrialRecord): string {
  const head = `Trial of ${candidate.name} at ${candidate.endpoint ?? "no published endpoint"}: it ${trial.note}.`;
  return trial.excerpt.length === 0 ? head : `${head}\nFirst characters returned: ${trial.excerpt}`;
}

/**
 * The assay is an opinion, and a missing opinion is not a failed round.
 *
 * Every path out of here is a value: too little material to assay, or an engine
 * that fell over. Both leave the ranking resting on the trial, which the reason
 * string then says out loud.
 */
async function safeAssay(candidate: Candidate): Promise<AssayReport | undefined> {
  if (candidate.pitch.trim().length < MIN_ASSAYABLE) return undefined;
  try {
    const { receipt } = await assay({
      vendor: candidate.name,
      pitch: candidate.pitch,
      askingPrice: candidate.price,
      buyerId: BUYER_ID,
    });
    return receipt.report;
  } catch {
    return undefined;
  }
}

interface Attempt {
  readonly candidate: Candidate;
  readonly trial: TrialRecord;
  readonly report?: AssayReport;
  readonly critique: Critique;
}

function rank(attempts: readonly Attempt[]): readonly Ranked[] {
  return [...attempts]
    .map((attempt) => ({ attempt, standing: standingOf(attempt) }))
    .sort((left, right) => right.standing - left.standing || left.attempt.candidate.name.localeCompare(right.attempt.candidate.name))
    .map(({ attempt, standing }, index) => ({
      rank: index + 1,
      seller: slug(attempt.candidate.name),
      product: attempt.candidate.name,
      standing,
      verdict: attempt.report?.verdict ?? "UNASSAYED",
      flagged: attempt.report?.verdict === "FLAGGED",
      reason: reasonFor(attempt, standing),
      trial: attempt.trial,
      critique: attempt.critique,
    }));
}

/**
 * Listing evidence carries the ranking; observed behaviour breaks the ties.
 *
 * The deterministic half of the assay is used rather than the full score, so a
 * ranking can be recomputed from the same listings and come out the same. Two
 * things are floored rather than merely penalised, because a penalty can be
 * out-earned by a good listing and these should not be: a product that steers
 * the buyer reading it, and a product whose own published endpoint did not
 * answer. Publishing no endpoint is unproven and scores between the two —
 * silence is weaker than delivery and better than a broken promise.
 */
function standingOf(attempt: Attempt): number {
  const listing = attempt.report?.deterministicScore ?? 0;
  const observed = attempt.trial.answered ? 100 : attempt.trial.attempted ? 0 : UNPROVEN_TRIAL;
  const raw = listing * 0.8 + observed * 0.2;
  const ceiling = attempt.report?.verdict === "FLAGGED" ? FLAGGED_CEILING : attempt.trial.attempted && !attempt.trial.answered ? FAILED_TRIAL_CEILING : 100;
  return Math.round(Math.min(raw, ceiling) * 10) / 10;
}

function reasonFor(attempt: Attempt, standing: number): string {
  const assayed =
    attempt.report === undefined
      ? attempt.candidate.pitch.trim().length < MIN_ASSAYABLE
        ? "Listing too thin to assay, so this rests on the trial alone."
        : "The assay did not complete, so this rests on the trial alone."
      : `Assay: ${attempt.report.verdict} at ${attempt.report.deterministicScore.toFixed(1)} on the reproducible dimensions.`;
  const trial = attempt.trial.answered
    ? `Trial: it ${attempt.trial.note}.`
    : attempt.trial.attempted
      ? `Trial: it ${attempt.trial.note}, so it ranks below anything that answered and below listings that were never put to the test.`
      : `Trial: it ${attempt.trial.note}, so it ranks below anything that answered.`;
  const points = `${attempt.critique.disagreements.length} disagreements stand unanswered. Standing ${standing}.`;
  return `${assayed} ${trial} ${points}`;
}

function ruleGaps(ranking: readonly Ranked[]): readonly string[] {
  const gaps: string[] = [];
  if (ranking.length < MIN_TRIED) {
    gaps.push(`${ranking.length} products tried; the Arena requires ${MIN_TRIED}.`);
  }
  const thin = ranking.filter((entry) => entry.critique.disagreements.length < 2);
  if (thin.length > 0) {
    gaps.push(`${thin.map((entry) => entry.product).join(", ")} drew fewer than two specific disagreements.`);
  }
  return gaps;
}

/** Buying is a call to the seller. Silence still costs credits; it is recorded as silence. */
async function buy(candidate: Candidate | undefined, credits: number): Promise<TrialRecord> {
  if (candidate === undefined) {
    return {
      answered: false,
      attempted: false,
      latencyMs: 0,
      excerpt: "",
      note: "Bought against its listing; the product was not in this round's candidate set.",
    };
  }
  const endpoint = candidate.endpoint;
  if (endpoint === undefined || !/^https?:\/\//i.test(endpoint)) {
    return {
      answered: false,
      attempted: false,
      latencyMs: 0,
      excerpt: "",
      note: "Bought against its listing; it published no endpoint to deliver through.",
    };
  }

  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": BUYER_ID },
      body: JSON.stringify({ task: TRIAL_TASK, from: BUYER_ID, budget: credits }),
      signal: AbortSignal.timeout(PURCHASE_TIMEOUT_MS),
    });
    const body = (await response.text()).slice(0, 500);
    const latencyMs = Date.now() - started;
    const answered = response.ok && body.trim().length > 0;
    return {
      answered,
      attempted: true,
      latencyMs,
      excerpt: body.slice(0, 300),
      note: answered
        ? `Delivered HTTP ${response.status} in ${latencyMs} ms.`
        : `Paid and got HTTP ${response.status} in ${latencyMs} ms; the delivery is on the record as unmet.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    return {
      answered: false,
      attempted: true,
      latencyMs: Date.now() - started,
      excerpt: "",
      note: `Paid and got no delivery within ${PURCHASE_TIMEOUT_MS} ms (${reason}).`,
    };
  }
}

function bought(candidate: Candidate | undefined, credits: number): string {
  const name = candidate?.name ?? "the product";
  const price = candidate?.price;
  return price === undefined
    ? `${credits} credits against ${name}'s published offer.`
    : `${credits} credits against ${name}'s published offer, priced at ${price} credits a unit.`;
}

function roundOnePost(ranking: readonly Ranked[], shortfall: readonly string[], suppliedCount: number): string {
  const header = [
    `Round 1 — ${BUYER_ID} tried ${ranking.length} products. No human touched this round.`,
    suppliedCount >= MIN_TRIED
      ? ""
      : `Only ${suppliedCount} competitor${suppliedCount === 1 ? " was" : "s were"} supplied, so the list was topped up from the open registry to reach the ${MIN_TRIED}-product floor.`,
  ].filter((line) => line.length > 0);

  const critiques = ranking.map((entry) => entry.critique.post);
  const table = ranking.map((entry) => `#${entry.rank} ${entry.product} — standing ${entry.standing}. ${entry.reason}`);
  const tail = shortfall.length === 0 ? "Round 1 rule satisfied." : `Round 1 gaps: ${shortfall.join(" ")}`;

  return [...header, "", ...critiques, "", "Ranking:", ...table, "", tail].join("\n");
}

function roundTwoPost(
  plan: SpendPlan,
  purchases: readonly Purchase[],
  state: LedgerState,
  refused: readonly string[],
): string {
  const lines = purchases.map(
    (purchase) => `${purchase.credits} credits to ${purchase.sellerName} — ${purchase.bought} ${purchase.why}`,
  );
  const tail =
    state.satisfiesRule
      ? `Spend rule satisfied: ${state.spent} of ${state.budget} credits across ${state.distinctSellers} distinct sellers, minimum ${MIN_SELLERS}.`
      : `Spend rule not satisfied: ${state.shortfall.join(" ")}`;
  const problems = refused.length === 0 ? [] : [`Refused by the ledger: ${refused.join("; ")}`];

  return [
    `Round 2 — ${BUYER_ID} spending ${plan.total} credits. No human touched this round.`,
    plan.note,
    "",
    ...lines,
    ...problems,
    "",
    tail,
  ].join("\n");
}
