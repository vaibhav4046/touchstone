import { describe, expect, it, vi } from "vitest";

/**
 * The claims under test: the money and the permission are the same number, and
 * a contract signed on no evidence says so out loud.
 *
 * Both were real defects. The broker minted `round(agreed)` grant uses and then
 * settled at `agreed`, so a deal struck at 5.34 paid 5.34 credits against a
 * five-use grant and the receipt printed both numbers as if they agreed. And an
 * upstream outage made every challenge return `passed`, which is deliberate —
 * failing a seller for our own rate limit empties a real shortlist — but it
 * also let the winner be picked, contracted and paid without ever producing a
 * sample, while the timeline read "2 of 2 cleared the challenge".
 */

const upstream = vi.hoisted(() => ({ mode: "answering" as "answering" | "down" }));

const SAMPLE =
  "Yuzu sits between a buyer's goal and the agents that answer it, taking the brief apart into a capability, a budget and a deadline before anyone is asked to price it.";

const DELIVERY = `${SAMPLE} ${SAMPLE} The brief is answered in full, with the gaps named rather than filled.`;

vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();
  const down = { ok: false, text: "", ms: 0, error: "no_api_key" as string | undefined };

  return {
    ...actual,
    complete: async (options: { model: string; system?: string; user: string }) => {
      // The injection classifier has no second supplier, so it is absent here
      // for the same reason it is absent on a keyless run: this is what the
      // rest of the suite already exercises.
      if (upstream.mode === "down" || options.model === actual.MODELS.guard) return down;

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
        return { ok: true, ms: 1, text: '{"adherence":0.9,"quality":0.9,"accepted":true,"findings":["Answers the brief."]}' };
      }
      return { ok: true, ms: 1, text: DELIVERY };
    },
  };
});

const { runBroker } = await import("../lib/market/broker");

describe("what was paid is what the grant allows", () => {
  it("settles at exactly the uses it minted, and both are whole", async () => {
    upstream.mode = "answering";
    const outcome = await runBroker({
      goal: "I am launching a coffee brand and need a competitor brief.",
      budget: 20,
      buyerId: `buyer-paid-${Date.now()}`,
      capability: "research.brief",
    });

    expect(outcome.unfilled).toBeUndefined();
    const contract = outcome.contract;
    const settlement = outcome.settlement;
    expect(contract).toBeDefined();
    expect(settlement).toBeDefined();
    if (contract === undefined || settlement === undefined) return;

    expect(outcome.verification?.accepted).toBe(true);

    // The defect: `paid` was a float and the grant carried its rounding.
    expect(settlement.paid).toBe(contract.credits);
    expect(settlement.paid).toBe(settlement.agreed);
    expect(Number.isInteger(settlement.paid)).toBe(true);
    // `credits` is read off the minted grant's maxUses, so this is the kernel's
    // number rather than a second copy of the price.
    expect(contract.price).toBe(contract.credits);

    // Nothing upstream of the contract may hand it a fraction either.
    expect(Number.isInteger(outcome.negotiation.at(-1)?.price)).toBe(true);
  }, 30_000);
});

describe("a contract signed on nothing says so", () => {
  it("keeps unprovable sellers shortlisted but records that no sample was ever produced", async () => {
    upstream.mode = "down";
    const outcome = await runBroker({
      goal: "I am launching a coffee brand and need a competitor brief.",
      budget: 20,
      buyerId: `buyer-outage-${Date.now()}`,
      capability: "research.brief",
    });

    expect(outcome.proofs.length).toBeGreaterThan(0);
    // Still shortlisted: our outage is not the seller's failure.
    expect(outcome.proofs.some((proof) => proof.passed)).toBe(true);
    // But nothing was demonstrated.
    expect(outcome.proofs.every((proof) => proof.proven)).toBe(false);
    expect(outcome.contract).toBeDefined();

    const prove = outcome.timeline.find((event) => event.stage === "prove");
    expect(prove?.summary).toContain("could not be challenged");

    const notChecked = outcome.receipt.report.notChecked.join(" ");
    expect(notChecked).toContain("signed without proof");
    expect(outcome.receipt.report.reproducibility.unavailable.join(" ")).toContain("Proof of capability");

    // Work that could not be delivered is not paid for either, and the seller
    // is not charged for our outage: it was never actually asked.
    expect(outcome.settlement?.paid ?? 0).toBe(0);
    expect(outcome.verification?.judged).toBe(false);
    expect(outcome.settlement?.reputationAfter).toBe(outcome.settlement?.reputationBefore);
  }, 30_000);
});
