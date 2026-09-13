import { describe, expect, it } from "vitest";
import { MIN_ATTEMPT_MS, attemptWindow } from "../lib/assay/llm";

/**
 * The failover has to be bounded by a clock, not by counting suppliers.
 *
 * The bench is four Groq models and three further suppliers, each previously
 * allowed thirty seconds, so an exhausted bench could spend 210 seconds being
 * told no -- against a route whose platform ceiling is 120. Past that the call
 * dies with a platform timeout and the buyer gets no receipt at all, which is
 * worse than a refusal: a refusal is an answer, and it can be priced at zero.
 *
 * The first version of this file tested `complete()` end to end and was
 * worthless. With healthy suppliers the first attempt always succeeds, so the
 * exhausted path never ran and the whole suite still passed with the budget
 * disabled outright. A guard nothing can falsify is not a guard, so the
 * decision is now a function and these are about that decision.
 */

describe("the budget decides whether the next supplier may be asked", () => {
  it("gives a fresh call its full per-supplier timeout", () => {
    expect(attemptWindow(45_000, 0, 30_000)).toBe(30_000);
  });

  it("shrinks the timeout to what is actually left", () => {
    // 10s left of the budget, but the supplier would be allowed 30. It gets 10:
    // asking for longer than the route can wait is how a call dies with no
    // receipt instead of a stated refusal.
    expect(attemptWindow(45_000, 35_000, 30_000)).toBe(10_000);
  });

  it("refuses an attempt whose answer could not arrive in time", () => {
    // 1s left is not enough to ask anybody, so nobody is asked.
    expect(attemptWindow(45_000, 44_000, 30_000)).toBeUndefined();
  });

  it("refuses once the budget is spent, however long the caller would allow", () => {
    expect(attemptWindow(45_000, 45_000, 30_000)).toBeUndefined();
    expect(attemptWindow(45_000, 90_000, 30_000)).toBeUndefined();
  });

  it("never hands back a window below the floor it would refuse on", () => {
    // Whatever it returns must be a window worth having: if the function says
    // yes, the supplier gets at least as long as the floor.
    for (const elapsed of [0, 10_000, 41_000, 41_999, 42_000]) {
      const window = attemptWindow(45_000, elapsed, 30_000);
      if (window !== undefined) expect(window).toBeGreaterThanOrEqual(MIN_ATTEMPT_MS);
    }
  });

  it("bounds the whole bench, which is the point", () => {
    // Seven suppliers asked in sequence under one 45s budget. Sum the windows
    // the gate would actually grant and it cannot exceed the budget by more
    // than the single in-flight call that straddles the end.
    let elapsed = 0;
    let asked = 0;
    for (let supplier = 0; supplier < 7; supplier += 1) {
      const window = attemptWindow(45_000, elapsed, 30_000);
      if (window === undefined) break;
      elapsed += window;
      asked += 1;
    }
    expect(elapsed).toBeLessThanOrEqual(45_000 + 30_000);
    // The old behaviour asked all seven for 210s. This must stop earlier.
    expect(asked).toBeLessThan(7);
  });
});
