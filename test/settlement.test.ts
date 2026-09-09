import { describe, expect, it } from "vitest";
import { balanceOf, sellCredits } from "../lib/market/settlement";
import { buildContext, callTool, traceFor } from "../lib/sharedos/host";
import { PURPOSES } from "../lib/sharedos/identity";

/**
 * The claim under test: credits are grant uses, and nothing else.
 *
 * If this passes, Yuzu has no billing code — the meter is the authorizer, the
 * balance is the usage store, and running out of money is `grant_exhausted`
 * refused on the same path as every other refusal. If it fails, the payment
 * story and the permission story have come apart, which is the exact defect the
 * design exists to make impossible.
 */
describe("credits are grant uses", () => {
  it("sells N credits as an N-use derived grant and refuses the N+1th delivery", async () => {
    const contractId = `ct_meter_${Date.now()}`;
    const buyer = `buyer-meter-${Date.now()}`;

    const sale = sellCredits({
      contractId,
      buyerId: buyer,
      capabilityFamily: "creative",
      credits: 3,
      deadlineSeconds: 300,
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    expect(sale.purchase.grant.constraints.maxUses).toBe(3);
    // Derived, not minted fresh: the contract hangs off the shelf grant.
    expect(sale.purchase.grant.parentGrantId).toBeDefined();

    const opening = await balanceOf(sale.purchase.grant);
    expect(opening).toMatchObject({ purchased: 3, spent: 0, remaining: 3 });

    const deliver = (context = buildContext({ buyerId: buyer, purpose: PURPOSES.deliver })) =>
      callTool(
        context,
        "market.deliver",
        { contractId, capabilityFamily: "creative" },
        { path: ["market", "creative"], action: "deliver" },
      );

    for (let paid = 1; paid <= 3; paid += 1) {
      const outcome = await deliver();
      expect(outcome.result?.status, `delivery ${paid} of 3 should be paid for`).toBe("succeeded");
    }

    const spent = await balanceOf(sale.purchase.grant);
    expect(spent).toMatchObject({ purchased: 3, spent: 3, remaining: 0 });

    // The fourth is not a business-logic error. It is a refusal from the kernel.
    //
    // Both literals, because they are different strings and the documentation
    // quotes the second one. An exhausted grant fails the kernel's
    // discoverability check first, so the tool is gone from the catalogue
    // before it can be called and the caller is handed `tool_unavailable` --
    // one coarse code the kernel deliberately spreads over several situations.
    // Which situation it was lives on the authorization decision, and that is
    // where `grant_exhausted` appears. Asserting only that a reason code was
    // set would keep passing if the tool simply stopped being registered, and
    // "running out of credits is a refusal from the authorizer" would be a
    // sentence with nothing behind it.
    const overdrawnContext = buildContext({ buyerId: buyer, purpose: PURPOSES.deliver });
    const overdrawn = await deliver(overdrawnContext);
    expect(overdrawn.result?.status).toBe("denied");
    expect(overdrawn.denied?.reasonCode).toBe("tool_unavailable");
    expect(traceFor(overdrawnContext.traceId).map((decision) => decision.reasonCode)).toContain(
      "grant_exhausted",
    );
  }, 30_000);

  it("refuses a purchase of nothing", () => {
    const zero = sellCredits({
      contractId: "ct_zero",
      buyerId: "buyer-zero",
      capabilityFamily: "creative",
      credits: 0,
      deadlineSeconds: 60,
    });
    expect(zero.ok).toBe(false);
  });

  it("does not let one buyer spend another buyer's contract", async () => {
    const contractId = `ct_isolation_${Date.now()}`;
    const sale = sellCredits({
      contractId,
      buyerId: `buyer-owner-${Date.now()}`,
      capabilityFamily: "research",
      credits: 2,
      deadlineSeconds: 300,
    });
    expect(sale.ok).toBe(true);

    const outcome = await callTool(
      buildContext({ buyerId: `buyer-stranger-${Date.now()}`, purpose: PURPOSES.deliver }),
      "market.deliver",
      { contractId, capabilityFamily: "research" },
      { path: ["market", "research"], action: "deliver" },
    );

    expect(outcome.result?.status).toBe("denied");
  }, 30_000);
});
