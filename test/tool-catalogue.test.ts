import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@aicoo/sharedos";
import { TURN_CALL_BUDGET, buildContext, callTool, host, toolCatalogue, withTurn } from "../lib/sharedos/host";
import { sellCredits } from "../lib/market/settlement";
import { withdrawGrant } from "../lib/sharedos/authority";
import { PURPOSES } from "../lib/sharedos/identity";

/**
 * Two properties, both of which a marketplace is asked to prove rather than
 * assert: that an agent cannot see a tool it cannot use, and that a refusal the
 * envelope makes is in the same audit stream as the ones the kernel makes.
 */
describe("the published tool catalogue", () => {
  it("shrinks as authority narrows, and identifies the set it served", async () => {
    const buyer = `cat-buyer-${Date.now()}`;
    const stranger = `cat-stranger-${Date.now()}`;

    const empty = await toolCatalogue(buildContext({ buyerId: stranger, purpose: PURPOSES.deliver }));
    expect(empty.published).toEqual([]);

    const sale = sellCredits({
      contractId: `ct_cat_${Date.now()}`,
      buyerId: buyer,
      capabilityFamily: "creative",
      credits: 2,
      deadlineSeconds: 300,
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    try {
      const context = buildContext({ buyerId: buyer, purpose: PURPOSES.deliver });
      const held = await toolCatalogue(context);

      // A contract buys deliveries and nothing else, so the catalogue is one
      // tool long. The assay tools are registered on the same kernel and are
      // not withheld by a filter in this file — they are simply not discoverable
      // under this authority.
      expect(held.published.map((tool) => tool.name)).toEqual(["market.deliver"]);
      expect(held.hash).not.toBe(empty.hash);

      // Nothing authorization-bearing crosses the boundary. The requirement is
      // re-resolved from the arguments at invocation time anyway, so a harness
      // could not use it if it had it.
      for (const tool of held.published) expect("requiredCapability" in tool).toBe(false);

      // The same tools under the same authority hash the same, which is the
      // only reason the number is worth pinning to a receipt.
      const again = await toolCatalogue(buildContext({ buyerId: buyer, purpose: PURPOSES.deliver }));
      expect(again.hash).toBe(held.hash);
    } finally {
      withdrawGrant(sale.purchase.grant.id);
    }
  });
});

describe("a refusal the envelope makes", () => {
  it("stops the call before the kernel is asked, and lands in the audit trail as the envelope's", async () => {
    const buyer = `budget-${Date.now()}`;
    const context = buildContext({ buyerId: buyer, purpose: PURPOSES.deliver });

    const outcomes = await withTurn(context, `test_${context.traceId}`, async () => {
      const results = [];
      // The buyer holds nothing, so every one of these is refused — by the
      // kernel until the budget runs out, and by the envelope afterwards. That
      // is the distinction under test: the codes differ, and so does who said
      // them.
      for (let call = 0; call <= TURN_CALL_BUDGET; call += 1) {
        results.push(
          await callTool(
            context,
            "market.deliver",
            { contractId: `ct_${call}`, capabilityFamily: "creative" },
            { path: ["market", "creative"], action: "deliver" },
          ),
        );
      }
      return results;
    });

    const withinBudget = outcomes[TURN_CALL_BUDGET - 1];
    const overBudget = outcomes[TURN_CALL_BUDGET];
    expect(withinBudget?.denied?.reasonCode).not.toBe("turn_call_budget_spent");
    expect(overBudget?.denied?.reasonCode).toBe("turn_call_budget_spent");
    expect(overBudget?.result?.status).toBe("denied");

    const refusals = host()
      .memoryAudit.recent(400)
      .filter(
        (event: AuditEvent) =>
          event.traceId === context.traceId &&
          event.type === "tool.invoked" &&
          (event.metadata as { readonly source?: unknown } | undefined)?.source === "envelope",
      );

    // Exactly one: the budget refuses every call after the ceiling, and only one
    // was made after it here.
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.outcome).toBe("denied");
    expect(refusals[0]?.reason).toBe("turn_call_budget_spent");
    expect(refusals[0]?.tool).toBe("market.deliver");
    expect((refusals[0]?.metadata as { readonly cause?: unknown }).cause).toBe(`turn_call_budget:${TURN_CALL_BUDGET}`);

    // The kernel's own refusals are still there and are still distinguishable
    // from the envelope's, which is the whole reason `source` is recorded.
    const kernelRefusals = host()
      .memoryAudit.recent(400)
      .filter(
        (event: AuditEvent) =>
          event.traceId === context.traceId &&
          event.type === "tool.invoked" &&
          (event.metadata as { readonly source?: unknown } | undefined)?.source !== "envelope",
      );
    expect(kernelRefusals.length).toBeGreaterThan(0);
  });

  it("counts nothing outside a turn the envelope opened", async () => {
    const context = buildContext({ buyerId: `unbudgeted-${Date.now()}`, purpose: PURPOSES.deliver });
    // Same number of calls, no turn. The budget binds calls the envelope can
    // attribute to a turn it opened, and refusing on a trace it never leased
    // would be the envelope charging somebody else's meter.
    for (let call = 0; call <= TURN_CALL_BUDGET; call += 1) {
      const outcome = await callTool(
        context,
        "market.deliver",
        { contractId: `ct_${call}`, capabilityFamily: "creative" },
        { path: ["market", "creative"], action: "deliver" },
      );
      expect(outcome.denied?.reasonCode).not.toBe("turn_call_budget_spent");
    }
  });
});
