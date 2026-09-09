import { describe, expect, it } from "vitest";
import { grantHistory, heldGrants, withdrawGrant } from "../lib/sharedos/authority";
import { grantMap } from "../lib/sharedos/map";
import { sellCredits, balanceOf } from "../lib/market/settlement";
import { NAMESPACE, buyerAddress } from "../lib/sharedos/identity";

/**
 * The grant map is the thing an outsider audits us with, so the properties that
 * make it worth auditing get tests: that it never leaks authority, that the
 * record of a grant outlives the grant, and that a withdrawn permission cannot
 * come back through the door the record opened.
 */
describe("the grant map", () => {
  it("records a grant when it is deposited and marks it withdrawn when it is taken away", () => {
    const sale = sellCredits({
      contractId: "ct_history",
      buyerId: "buyer-history",
      capabilityFamily: "creative",
      credits: 4,
      deadlineSeconds: 300,
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    const opened = grantHistory(200).find((row) => row.id === sale.purchase.grant.id);
    expect(opened).toBeDefined();
    expect(opened?.maxUses).toBe(4);
    expect(opened?.closedAt).toBeUndefined();
    // The record names the parent, so a reader can walk the delegation without
    // being handed either grant.
    expect(opened?.parentGrantId).toBeDefined();

    withdrawGrant(sale.purchase.grant.id);

    const closed = grantHistory(200).find((row) => row.id === sale.purchase.grant.id);
    expect(closed?.closedAt).toBeDefined();
    expect(closed?.ending).toBe("withdrawn");
    // The authority is gone even though the record is not. This is the whole
    // point of keeping them in separate stores.
    expect(heldGrants(NAMESPACE, buyerAddress("buyer-history")).some((g) => g.id === sale.purchase.grant.id)).toBe(false);
  });

  it("reports a balance the kernel owns rather than a number the map keeps", async () => {
    const sale = sellCredits({
      contractId: "ct_balance",
      buyerId: "buyer-balance",
      capabilityFamily: "research",
      credits: 3,
      deadlineSeconds: 300,
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    const map = await grantMap("buyer-balance");
    const mapped = map.held.find((grant) => grant.id === sale.purchase.grant.id);
    expect(mapped).toBeDefined();
    expect(mapped?.budget.bounded).toBe(true);

    const direct = await balanceOf(sale.purchase.grant);
    if (mapped?.budget.bounded === true) {
      expect(mapped.budget.purchased).toBe(direct.purchased);
      expect(mapped.budget.remaining).toBe(direct.remaining);
    }

    withdrawGrant(sale.purchase.grant.id);
  });

  it("never puts a secret, a signature or a raw grant on the map", async () => {
    const sale = sellCredits({
      contractId: "ct_leak",
      buyerId: "buyer-leak",
      capabilityFamily: "creative",
      credits: 2,
      deadlineSeconds: 300,
    });
    if (!sale.ok) return;

    const serialised = JSON.stringify(await grantMap("buyer-leak"));
    // `reach` is the kernel's derivation with the authority stripped out, and
    // the mapped grants are projections. Neither may carry the fields that would
    // let a reader replay or forge one.
    for (const forbidden of ["signature", "secret", "signingKey", "\"proof\"", "TOUCHSTONE_SIGNING_KEY"]) {
      expect(serialised).not.toContain(forbidden);
    }
    withdrawGrant(sale.purchase.grant.id);
  });

  it("keeps the owner's refusals on the map, with no width attached to them", async () => {
    const map = await grantMap("buyer-policy");
    const refusals = map.policy.filter((row) => row.decision === "refuse");

    expect(refusals.length).toBeGreaterThan(0);
    // A refusal that carried an approved shape would be a permission a later
    // request could read off the back of a no.
    for (const refusal of refusals) expect(refusal.approved).toBeUndefined();
    expect(map.policy.some((row) => row.decision === "allow")).toBe(true);
  });

  it("keeps a withdrawn grant in the record and out of the store", () => {
    const sale = sellCredits({
      contractId: "ct_ghost",
      buyerId: "buyer-ghost",
      capabilityFamily: "creative",
      credits: 1,
      deadlineSeconds: 300,
    });
    if (!sale.ok) return;
    const id = sale.purchase.grant.id;

    expect(heldGrants(NAMESPACE, buyerAddress("buyer-ghost")).some((grant) => grant.id === id)).toBe(true);
    withdrawGrant(id);

    // Still in the history, still not loadable. Nothing reads authority back
    // out of the record, which is why the two are separate stores at all.
    expect(grantHistory(200).some((row) => row.id === id)).toBe(true);
    expect(heldGrants(NAMESPACE, buyerAddress("buyer-ghost")).some((grant) => grant.id === id)).toBe(false);
  });
});
