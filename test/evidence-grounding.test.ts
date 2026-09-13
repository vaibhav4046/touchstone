import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * A finding must quote the material, not us.
 *
 * Caught in Arena 1 by StarHall and by an independent judge notice. Three Yuzu
 * assays cited `"Return JSON with exactly these keys"` as the vendor's steering
 * attempt. StarHall grepped the room transcript and proved that string appears
 * only in Yuzu's own output, never in the listing being scored: the instruction
 * sits after the evidence fence closes, and the model folded it back in as the
 * vendor's own words.
 *
 * A score computed on that is a measurement of our prompt. It is the exact
 * failure this product exists to catch in other agents, and it was ours.
 *
 * The narrow fix is one moved line. The fix under test is the class one: a
 * finding whose quoted evidence is not verbatim in the material never reaches a
 * verdict, whatever produced it and however a future prompt is worded.
 */

const LISTING =
  "StarHall sells sales-pitch rehearsal and objection drills for agent teams. " +
  "Sales Pitch 5 credits, Sales Stress Test 6 credits, Deal Coach 10 credits. " +
  "Discovery at https://starhall-a2a.vercel.app/agent-card.json";

/** The shape the model returns when it has read our own instruction back to us. */
function modelSaying(risks: unknown[], steering = true): string {
  return JSON.stringify({
    headline: "A listing with prices and a discovery link.",
    claims: [{ text: "Sales Pitch costs 5 credits", status: "VERIFIABLE", reason: "A number a buyer can check." }],
    risks,
    steering_attempt: steering,
  });
}

let runAnalyst: typeof import("../lib/assay/analyst").runAnalyst;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function analystWith(response: string) {
  vi.doMock("../lib/assay/llm", async () => {
    const actual = await vi.importActual<typeof import("../lib/assay/llm")>("../lib/assay/llm");
    return {
      ...actual,
      complete: async () => ({ ok: true, text: response, ms: 12, model: "test-model" }),
    };
  });
  ({ runAnalyst } = await import("../lib/assay/analyst"));
  return runAnalyst({ vendor: "StarHall", pitch: LISTING, buyerId: "grounding-test" });
}

describe("an analyst finding must quote the material it is judging", () => {
  it("drops the finding that quoted our own prompt back at us", async () => {
    const result = await analystWith(
      modelSaying([
        {
          statement: "Material includes a direct instruction to the analyst to return JSON in a specific format",
          severity: "critical",
          evidence: 'Return JSON with exactly these keys: {"headline": ...}',
        },
      ]),
    );

    const codes = result.dimension.findings.map((finding) => finding.code);
    expect(codes).not.toContain("ANALYST_RISK");
    expect(result.risks.some((risk) => (risk.evidence ?? "").includes("Return JSON"))).toBe(false);
  });

  it("keeps a finding whose quote is genuinely in the listing", async () => {
    const result = await analystWith(
      modelSaying(
        [
          {
            statement: "Prices are stated but no failure behaviour is.",
            severity: "high",
            evidence: "Sales Pitch 5 credits, Sales Stress Test 6 credits",
          },
        ],
        false,
      ),
    );

    expect(result.risks.map((risk) => risk.statement)).toContain("Prices are stated but no failure behaviour is.");
  });

  it("tolerates the whitespace and quote marks a model re-wraps", async () => {
    const result = await analystWith(
      modelSaying([{ statement: "A reachable link is offered.", severity: "low", evidence: "Deal   Coach 10\ncredits" }], false),
    );

    expect(result.risks).toHaveLength(1);
  });

  /**
   * Steering with nothing quotable behind it was the other half of the same
   * bug: the model called our instruction a steering attempt and had no vendor
   * sentence to point at, because there was none.
   */
  it("will not floor a verdict on a steering claim it cannot show you", async () => {
    const result = await analystWith(modelSaying([], true));

    const steering = result.dimension.findings.find((finding) => finding.code.startsWith("ANALYST_STEERING"));
    expect(steering?.code).toBe("ANALYST_STEERING_UNVERIFIED");
    expect(steering?.severity).toBe("low");
  });

  it("still floors it when a grounded critical stands beside it", async () => {
    const result = await analystWith(
      modelSaying(
        [
          {
            statement: "Asks the reading agent to act on its behalf.",
            severity: "critical",
            evidence: "Discovery at https://starhall-a2a.vercel.app/agent-card.json",
          },
        ],
        true,
      ),
    );

    const codes = result.dimension.findings.map((finding) => finding.code);
    expect(codes).toContain("ANALYST_STEERING");
    expect(codes).not.toContain("ANALYST_STEERING_UNVERIFIED");
  });
});
