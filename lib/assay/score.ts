import type { DimensionResult, Finding, Verdict } from "./types";

/**
 * Scoring is a weighted mean, and the weights are published.
 *
 * A buyer agent that disagrees with a verdict should be able to recompute it
 * from the dimensions in the receipt and find the same number. Nothing here
 * consults a model.
 */
/**
 * The half of the score a critic can reproduce exactly.
 *
 * One dimension comes from a language model, and a model is not a function:
 * eight identical calls to this service produced scores from 33.3 to 45.8
 * before this existed. The verdict held — the FLAGGED floor is deterministic —
 * but a buyer told "recompute it yourself" would have got a different number
 * and been right to say so.
 *
 * Publishing both numbers is the honest fix. This one is the rules: same input,
 * same output, every time. The headline score still includes the model's
 * judgement, because dropping it would lose real signal — but nobody has to
 * take that part on faith to check the rest.
 *
 * "Deterministic" has to mean it, so a measurement that could not be taken is
 * excluded rather than scored as though it had been. The injection classifier
 * is a hosted service that returns 429 under exactly the load the Arena
 * produces; counting it would mean the same listing scored differently at
 * 9:05 than at 9:45, which is the failure this field was added to prevent.
 * Dimensions that mix rules with an upstream call therefore contribute their
 * rules-only floor, and a dimension that did not run at all contributes
 * nothing. What was left out is named in the report's `reproducibility` block.
 */
export function deterministicScore(dimensions: readonly DimensionResult[]): number {
  return weightedScore(
    dimensions.flatMap((dimension) => {
      if (dimension.method === "model") return [];
      if (dimension.reproducibleScore === undefined) return [dimension];
      return [{ ...dimension, score: dimension.reproducibleScore }];
    }),
  );
}

export function weightedScore(dimensions: readonly DimensionResult[]): number {
  const scored = dimensions.filter((dimension) => dimension.weight > 0 && dimension.method !== "not-run");
  const total = scored.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (total === 0) return 0;
  const value = scored.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / total;
  return Math.round(value * 1000) / 10;
}

/** The floors that carry a stock explanation. Everything else speaks for itself. */
const STEERING_CODES = new Set(["STEERING_INSTRUCTION", "GUARD_INJECTION_DETECTED", "ANALYST_STEERING"]);

/**
 * A critical finding overrides the arithmetic entirely. Any critical finding.
 *
 * A listing that instructs the agent reading it, or that asks for credentials,
 * is not a low-scoring vendor — it is a different category of thing, and
 * averaging it against a tidy price table would hide exactly the fact a buyer
 * needed. These floors are the reason the score is not just a mean.
 *
 * This used to name two codes, and the list was the bug. `ANALYST_STEERING` is
 * raised at severity critical and was not on it, so a listing asking the buyer's
 * agent to write its own system prompt into the order notes came back TRUSTED at
 * 82.6 with the seller's full asking price recommended — measured on the live
 * deployment, with the critical finding sitting in the same report. Nothing was
 * wrong with the detector. The floor simply could not see what it found.
 *
 * So the floor reads the severity, which is the claim itself: "critical" already
 * means "do not buy on this evidence". A register of codes that has to be
 * remembered every time a finding is added would fail the same way again, and
 * the next omission would be just as invisible.
 */
export function verdictFor(score: number, findings: readonly Finding[]): { verdict: Verdict; reason?: string } {
  const critical = findings.find((finding) => finding.severity === "critical");
  if (critical !== undefined) return { verdict: "FLAGGED", reason: floorReason(critical) };

  if (score >= 78) return { verdict: "TRUSTED" };
  if (score >= 58) return { verdict: "QUALIFIED" };
  return { verdict: "UNPROVEN" };
}

/**
 * Why the floor fired, in the buyer's terms.
 *
 * The two familiar kinds get the sentence they have always had. A critical
 * nobody anticipated gets its own statement rather than a canned line that
 * would describe the wrong thing — a wrong explanation for a real finding is
 * worse than a plain one.
 */
function floorReason(finding: Finding): string {
  if (STEERING_CODES.has(finding.code)) {
    return "Material addresses the reading agent as if it had authority over it.";
  }
  if (finding.code.startsWith("OVERREACH_")) return "Requests authority a delivery service does not need.";
  return finding.statement;
}

/**
 * What the evidence supports paying, not what the vendor asked for.
 *
 * A flagged vendor is worth zero regardless of price. Everything else is
 * discounted against the quote in proportion to how much of the listing turned
 * out to be checkable.
 */
export function recommendedMaxPrice(
  askingPrice: number | undefined,
  score: number,
  verdict: Verdict,
): number | undefined {
  if (askingPrice === undefined || askingPrice <= 0) return undefined;
  if (verdict === "FLAGGED") return 0;
  const factor = verdict === "TRUSTED" ? 1 : Math.max(0.2, score / 100);
  return Math.round(askingPrice * factor * 100) / 100;
}

export function allFindings(dimensions: readonly DimensionResult[]): readonly Finding[] {
  return dimensions.flatMap((dimension) => dimension.findings);
}

/**
 * Two rules matching the same sentence is one finding, not two.
 *
 * Several steering patterns are written to overlap deliberately, so that a
 * phrasing nobody anticipated still trips something. The cost of that is a
 * report that says the same thing three times about the same quote, which
 * reads as padding and makes a real finding look inflated.
 */
export function dedupe(findings: readonly Finding[]): readonly Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}::${finding.evidence ?? finding.statement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const ORDER: Record<Finding["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function rankedRisks(findings: readonly Finding[], limit = 8): readonly Finding[] {
  return dedupe([...findings].filter((finding) => finding.severity !== "info"))
    .slice()
    .sort((left, right) => ORDER[left.severity] - ORDER[right.severity])
    .slice(0, limit);
}
