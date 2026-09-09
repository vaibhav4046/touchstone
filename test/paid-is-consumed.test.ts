import { describe, expect, it, vi } from "vitest";

/**
 * The claim under test is the headline one: there is no billing code here
 * because the kernel is the meter.
 *
 * It was false. The broker minted `maxUses = agreed`, called `market.deliver`
 * exactly once, and then set `paid: agreed` from a local variable — so a deal
 * struck at five credits reported five paid while the authorizer's meter read
 * one, which is precisely the number in a database that leaves the money and
 * the permissions free to disagree.
 *
 * So these assertions do not ask the settlement whether it agrees with itself.
 * They ask the kernel's usage store how many uses were consumed on the
 * contract's grant, and compare that to what the buyer was told it paid.
 */

const upstream = vi.hoisted(() => ({ verdict: "accepted" as "accepted" | "rejected" }));

const SAMPLE =
  "Yuzu sits between a buyer's goal and the agents that answer it, taking the brief apart into a capability, a budget and a deadline before anyone is asked to price it.";

const DELIVERY = `${SAMPLE} ${SAMPLE} The brief is answered in full, with the gaps named rather than filled.`;

vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();

  return {
    ...actual,
    complete: async (options: { model: string; system?: string; user: string }) => {
      if (options.model === actual.MODELS.guard) return { ok: false, text: "", ms: 0, error: "no_api_key" };

      const system = options.system ?? "";
      if (system.includes("procurement request")) {
        return {
          ok: true,
          ms: 1,
          text: '{"capability":"research.brief","deliverable":"A competitor brief in markdown.","constraints":["name every competitor"]}',
        };
      }
      if (system.includes("proof-of-capability")) return { ok: true, ms: 1, text: SAMPLE };
      if (system.includes("verify delivered work")) {
        // Judged either way. A rejection has to be a verdict on real work, not
        // an upstream outage, or the broker never reaches the rejected branch.
        return upstream.verdict === "accepted"
          ? { ok: true, ms: 1, text: '{"adherence":0.9,"quality":0.9,"accepted":true,"findings":["Answers the brief."]}' }
          : { ok: true, ms: 1, text: '{"adherence":0.1,"quality":0.1,"accepted":false,"findings":["Nowhere near the brief."]}' };
      }
      return { ok: true, ms: 1, text: DELIVERY };
    },
  };
});

const { runBroker } = await import("../lib/market/broker");
const { usageStore } = await import("../lib/sharedos/host");
const { NAMESPACE } = await import("../lib/sharedos/identity");

async function consumedOn(grantId: string): Promise<number> {
  return usageStore().getUsage(NAMESPACE, grantId);
}

describe("what the kernel consumed is what the buyer paid", () => {
  it("charges an accepted delivery by spending the whole grant, and the meter says so", async () => {
    upstream.verdict = "accepted";
    const outcome = await runBroker({
      goal: "I am launching a coffee brand and need a competitor brief.",
      budget: 20,
      buyerId: `buyer-invariant-${Date.now()}`,
      capability: "research.brief",
    });

    const contract = outcome.contract;
    const settlement = outcome.settlement;
    expect(outcome.unfilled).toBeUndefined();
    expect(contract).toBeDefined();
    expect(settlement).toBeDefined();
    if (contract === undefined || settlement === undefined) return;
    expect(outcome.verification?.accepted).toBe(true);

    // The invariant, asked of the authorizer rather than of ourselves.
    const consumed = await consumedOn(contract.grantId);
    expect(consumed, "uses the kernel spent must equal the credits reported paid").toBe(settlement.paid);

    // And the price was actually charged, rather than the meter being met by
    // charging less: an accepted delivery costs what was agreed.
    expect(settlement.paid).toBe(settlement.agreed);
    // Which is the whole of the minted grant. Nothing is left to spend.
    expect(consumed).toBe(contract.credits);
    expect(settlement.consumed).toBe(consumed);
  }, 30_000);

  it("charges a rejected delivery nothing, and still reports the use the attempt consumed", async () => {
    upstream.verdict = "rejected";
    const outcome = await runBroker({
      goal: "I am launching a coffee brand and need a competitor brief.",
      budget: 20,
      buyerId: `buyer-rejected-${Date.now()}`,
      capability: "research.brief",
    });

    const contract = outcome.contract;
    const settlement = outcome.settlement;
    expect(contract).toBeDefined();
    expect(settlement).toBeDefined();
    if (contract === undefined || settlement === undefined) return;

    // A verdict on the work, not an outage. Otherwise this tests nothing.
    expect(outcome.verification?.judged).toBe(true);
    expect(outcome.verification?.accepted).toBe(false);

    expect(settlement.paid).toBe(0);

    // The delivery was authorised and taken, so exactly one use was spent, and
    // the rest of the price was never charged. The gap between 0 paid and 1
    // consumed is the point: it is reported, not silent.
    const consumed = await consumedOn(contract.grantId);
    expect(consumed).toBe(1);
    expect(settlement.consumed).toBe(consumed);
    expect(consumed).toBeLessThan(settlement.agreed);
    expect(settlement.reason).toContain("rejected");
    expect(settlement.reason).toContain("stayed with the buyer");
  }, 30_000);
});
