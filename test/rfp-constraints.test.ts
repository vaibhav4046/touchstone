import { describe, expect, it, vi } from "vitest";

/**
 * A constraint is something the buyer wants of the work.
 *
 * Everything else in that list is ours, and handing it to a seller as a
 * requirement is how a competitor brief came back as the forty-character string
 * "Competitor Brief for Coffee Brand Launch". The model that turns a goal into
 * a request had helpfully written `deliverable <= 10 words` — reading the
 * schema's own description of the `deliverable` field as a limit on the work —
 * and the seller obeyed it exactly. Three live runs, perfectly correlated: with
 * that line the delivery was 71 to 74 characters, without it, 1838.
 *
 * The delivery prompt puts constraints last as a hard checklist, which is right
 * and which made this worse: the better a seller follows instructions, the more
 * completely a bad instruction destroys the work.
 */
const upstream = vi.hoisted(() => ({ constraints: [] as string[] }));

vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();
  return {
    ...actual,
    complete: async (options: { model: string; system?: string; user: string }) => {
      const system = options.system ?? "";
      if (system.includes("procurement request")) {
        return {
          ok: true,
          ms: 1,
          text: JSON.stringify({
            capability: "research.brief",
            deliverable: "Competitor Brief for Coffee Brand Launch",
            constraints: upstream.constraints,
          }),
        };
      }
      // Nothing else in the deal matters here; let every other stage fail our
      // way so the run reaches a conclusion quickly.
      return { ok: false, text: "", ms: 0, error: "http_429" as string | undefined };
    },
  };
});

const { runBroker } = await import("../lib/market/broker");

async function constraintsReachingTheSeller(written: readonly string[]): Promise<readonly string[]> {
  upstream.constraints = [...written];
  const outcome = await runBroker({
    goal: "Launch my coffee brand. I need a competitor brief.",
    budget: 22,
    buyerId: `constraint-${Math.random().toString(16).slice(2)}`,
  });
  return outcome.rfp.constraints;
}

describe("only the buyer's requirements reach the seller", () => {
  it("drops a price the model copied out of its own prompt", async () => {
    const kept = await constraintsReachingTheSeller([
      "budget <= 22 Arena credits",
      "name every competitor covered",
    ]);

    // The budget is enforced by the negotiation and by the grant. A seller that
    // sees it can only be confused by it.
    expect(kept).not.toContain("budget <= 22 Arena credits");
    expect(kept).toContain("name every competitor covered");
  }, 30_000);

  it("drops a word limit on the deliverable, which is our schema and not a brief", async () => {
    const kept = await constraintsReachingTheSeller([
      "deliverable <= 10 words",
      "one paragraph per competitor",
    ]);

    // This is the one that cost real deals.
    expect(kept).not.toContain("deliverable <= 10 words");
    expect(kept).toContain("one paragraph per competitor");
  }, 30_000);

  it("drops a delivery deadline, which the contract already carries", async () => {
    const kept = await constraintsReachingTheSeller([
      "delivery within 5 business days",
      "cite a source for every claim",
    ]);

    expect(kept).not.toContain("delivery within 5 business days");
    expect(kept).toContain("cite a source for every claim");
  }, 30_000);

  it("keeps a real requirement even when it mentions a number", async () => {
    const kept = await constraintsReachingTheSeller([
      "exactly three taglines",
      "each tagline no more than 8 words",
    ]);

    // A limit on the *artifact the buyer asked for* is the whole point of a
    // constraint. Only limits on our own schema are noise.
    expect(kept).toEqual(["exactly three taglines", "each tagline no more than 8 words"]);
  }, 30_000);
});
