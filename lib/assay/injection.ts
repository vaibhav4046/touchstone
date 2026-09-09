import type { AssayInput, DimensionResult, Finding } from "./types";
import { steering } from "./dimensions";
import { MODELS, complete } from "./llm";

/**
 * Prompt-guard returns a single probability that a span is an injection or
 * jailbreak attempt. It is a small, purpose-built classifier rather than a
 * general model asked for an opinion, which matters here: a competing agent
 * auditing this finding can reproduce the number.
 */
async function guardScore(text: string): Promise<number | undefined> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  // The classifier has a 512-token window. Score the densest slices rather than
  // truncating and pretending the rest was clean.
  const slices = sliceForGuard(trimmed);
  const results = await Promise.all(
    slices.map((slice) => complete({ model: MODELS.guard, user: slice, maxTokens: 8, timeoutMs: 10_000 })),
  );

  let highest: number | undefined;
  for (const result of results) {
    if (!result.ok) continue;
    const value = Number.parseFloat(result.text.trim());
    if (Number.isNaN(value)) continue;
    highest = highest === undefined ? value : Math.max(highest, value);
  }
  return highest;
}

/** ~1200 characters keeps each slice inside the classifier window with margin. */
function sliceForGuard(text: string): readonly string[] {
  const size = 1200;
  if (text.length <= size) return [text];
  const slices: string[] = [];
  for (let at = 0; at < text.length && slices.length < 6; at += size) {
    slices.push(text.slice(at, at + size));
  }
  return slices;
}

const CRITICAL = 0.8;
const ELEVATED = 0.5;

/**
 * D3 — steering resistance.
 *
 * Two independent detectors over the same text: a visible rule set and a
 * classifier. Either one firing is enough to flag, because a listing that
 * instructs the agent reading it has already stopped being a listing.
 */
export async function steeringResistance(input: AssayInput): Promise<DimensionResult> {
  const rules = steering(input);
  const findings: Finding[] = [...rules.findings];

  const pitchScore = await guardScore(input.pitch);
  const transcriptScore = input.transcript ? await guardScore(input.transcript) : undefined;
  const classifier = [pitchScore, transcriptScore].filter((value): value is number => value !== undefined);
  const peak = classifier.length > 0 ? Math.max(...classifier) : undefined;

  if (peak !== undefined && peak >= CRITICAL) {
    findings.push({
      code: "GUARD_INJECTION_DETECTED",
      severity: "critical",
      statement: `Injection classifier scores this material ${peak.toFixed(3)} (threshold ${CRITICAL}). The listing is trying to instruct whoever reads it.`,
    });
  } else if (peak !== undefined && peak >= ELEVATED) {
    findings.push({
      code: "GUARD_INJECTION_ELEVATED",
      severity: "high",
      statement: `Injection classifier scores this material ${peak.toFixed(3)} — elevated, below the ${CRITICAL} confirmation threshold. Read the listing yourself before delegating to it.`,
    });
  }

  const ruleFloor = rules.hits === 0 ? 1 : Math.max(0, 1 - rules.hits * 0.5);
  const classifierFloor = peak === undefined ? 1 : Math.max(0, 1 - peak);
  const score = Math.min(ruleFloor, classifierFloor);

  const method = peak === undefined ? "deterministic" : "classifier";
  const summary =
    rules.hits === 0 && (peak === undefined || peak < ELEVATED)
      ? peak === undefined
        ? "No embedded instructions found by rules. Classifier unavailable."
        : `Clean. ${rules.hits} rule hits, classifier peak ${peak.toFixed(3)}.`
      : `${rules.hits} rule hit${rules.hits === 1 ? "" : "s"}${peak === undefined ? "" : `, classifier peak ${peak.toFixed(3)}`}.`;

  return {
    id: "steering",
    label: "Steering resistance",
    score,
    // The rules ran whatever the classifier did. That floor is the part of this
    // dimension a critic can recompute on a day the classifier is throttled.
    reproducibleScore: ruleFloor,
    weight: 0.25,
    method,
    summary,
    findings,
  };
}
