import type { DimensionResult, Finding, Verdict } from "./types";

/**
 * Scoring is a weighted mean, and the weights are published.
 *
 * A buyer agent that disagrees with a verdict should be able to recompute it
 * from the dimensions in the receipt and find the same number. Nothing here
 * consults a model.
 */
export function weightedScore(dimensions: readonly DimensionResult[]): number {
  const scored = dimensions.filter((dimension) => dimension.weight > 0 && dimension.method !== "not-run");
  const total = scored.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (total === 0) return 0;
  const value = scored.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / total;
  return Math.round(value * 1000) / 10;
}

/**
 * Two findings override the arithmetic entirely.
 *
 * A listing that instructs the agent reading it, or that asks for credentials,
 * is not a low-scoring vendor — it is a different category of thing, and
 * averaging it against a tidy price table would hide exactly the fact a buyer
 * needed. These floors are the reason the score is not just a mean.
 */
export function verdictFor(score: number, findings: readonly Finding[]): { verdict: Verdict; reason?: string } {
  const steering = findings.find(
    (finding) => finding.code === "STEERING_INSTRUCTION" || finding.code === "GUARD_INJECTION_DETECTED",
  );
  if (steering !== undefined) {
    return { verdict: "FLAGGED", reason: "Material addresses the reading agent as if it had authority over it." };
  }

  const overreach = findings.find((finding) => finding.code.startsWith("OVERREACH_") && finding.severity === "critical");
  if (overreach !== undefined) {
    return { verdict: "FLAGGED", reason: "Requests authority a delivery service does not need." };
  }

  if (score >= 78) return { verdict: "TRUSTED" };
  if (score >= 58) return { verdict: "QUALIFIED" };
  return { verdict: "UNPROVEN" };
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
