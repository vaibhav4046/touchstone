import { deriveGrant, type CapabilityGrant } from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, NAMESPACE, PURPOSES, TOUCHSTONE, buyerAddress } from "../sharedos/identity";
import { depositGrant, withdrawGrant } from "../sharedos/authority";
import { buildContext, callTool, usageStore } from "../sharedos/host";

/**
 * Credits are grant uses. That is the whole billing system.
 *
 * The Arena prices services in credits and gives the kernel nothing to record
 * them with — there is no invoice type, no ledger, no payment primitive
 * anywhere in SharedOS. Most entries will therefore keep a number in a table
 * and call it money, which means the payment and the permission are two
 * separate stories that can disagree.
 *
 * They do not have to be. A grant already carries a bounded, atomically
 * consumed budget: `maxUses`, spent by the kernel at invocation and never at
 * discovery, backed by a compare-and-set store. So buying five credits of a
 * seller's capability *is* deriving a five-use grant over it. Spending a credit
 * is the kernel consuming a use. Running out of credits is `grant_exhausted`,
 * refused by the same code path that refuses everything else.
 *
 * Which means paying the price has to be spending the price. Minting five uses
 * and then charging five while the kernel's meter reads one would be the
 * database number this file exists to avoid, wearing a grant as a costume. So
 * `chargeContract` below spends the agreed price down to zero through the
 * authorizer, one authorised call per credit, and what was paid is then read
 * off the meter rather than restated from the agreement.
 *
 * Nothing here can drift from the permission model, because there is nothing
 * here: the balance is a question asked of the usage store, not a number this
 * file keeps.
 */

/**
 * The shelf.
 *
 * Yuzu holds one broad grant per capability family, issued to itself. Every
 * purchase is derived from it, so no buyer ever holds authority Yuzu did not
 * already have, and revoking the parent stops every contract beneath it at
 * once — which is the property a market needs on the night something goes wrong.
 */
function shelfGrant(capabilityFamily: string, now: Date): CapabilityGrant {
  return {
    id: `grant_shelf_${capabilityFamily}`,
    namespaceId: NAMESPACE,
    subject: TOUCHSTONE,
    issuer: TOUCHSTONE,
    capabilities: [
      {
        resource: { namespace: ASSAY_NAMESPACE, path: ["market", capabilityFamily], owner: TOUCHSTONE },
        actions: ["deliver", "read"],
        scope: "descendants",
      },
    ],
    constraints: {
      purposes: ["yuzu.contract", "yuzu.deliver"],
      expiresAt: new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
      delegationDepth: 1,
    },
    issuedAt: new Date(now.getTime() - 1_000).toISOString(),
    metadata: { tier: "shelf", capabilityFamily },
  };
}

export interface PurchasedGrant {
  readonly grant: CapabilityGrant;
  readonly credits: number;
  readonly capabilityFamily: string;
}

export type PurchaseResult =
  | { readonly ok: true; readonly purchase: PurchasedGrant }
  | { readonly ok: false; readonly reason: string };

/**
 * Sell `credits` uses of one capability to one buyer.
 *
 * The derived grant is narrower than the shelf on every axis the buyer does not
 * need: one capability family, one purpose, one deadline, and exactly as many
 * invocations as were paid for.
 */
export function sellCredits(input: {
  readonly contractId: string;
  readonly buyerId: string;
  readonly capabilityFamily: string;
  readonly credits: number;
  readonly deadlineSeconds: number;
  readonly now?: Date;
}): PurchaseResult {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.credits) || input.credits < 1) {
    return { ok: false, reason: "credits_must_be_a_positive_whole_number" };
  }

  const parent = shelfGrant(input.capabilityFamily, now);
  depositGrant(parent);

  const derived = deriveGrant(parent, {
    id: `grant_${input.contractId}`,
    subject: buyerAddress(input.buyerId),
    capabilities: [
      {
        resource: { namespace: ASSAY_NAMESPACE, path: ["market", input.capabilityFamily], owner: TOUCHSTONE },
        actions: ["deliver"],
        scope: "descendants",
      },
    ],
    constraints: {
      purposes: ["yuzu.deliver"],
      expiresAt: new Date(now.getTime() + input.deadlineSeconds * 1000).toISOString(),
      // The paid credits, and not one invocation more.
      maxUses: input.credits,
    },
    issuedAt: new Date(now.getTime() - 500).toISOString(),
    metadata: { tier: "contract", contractId: input.contractId, creditsPaid: input.credits },
  });

  if (!derived.ok) return { ok: false, reason: derived.reason };

  depositGrant(derived.grant);
  return {
    ok: true,
    purchase: { grant: derived.grant, credits: input.credits, capabilityFamily: input.capabilityFamily },
  };
}

export interface Balance {
  readonly grantId: string;
  readonly purchased: number;
  readonly spent: number;
  readonly remaining: number;
}

/** What is left, asked of the thing that actually enforces it. */
export async function balanceOf(grant: CapabilityGrant): Promise<Balance> {
  const purchased = grant.constraints.maxUses ?? 0;
  const spent = await usageStore().getUsage(grant.namespaceId, grant.id);
  return { grantId: grant.id, purchased, spent, remaining: Math.max(0, purchased - spent) };
}

/**
 * Charge a contract its price, by spending it.
 *
 * The kernel consumes exactly one use per authorised invocation and offers no
 * way to consume several at once — `GrantUsageStore.tryConsume` is a
 * compare-and-set of `current + 1` against `maxUses`, and the authorizer calls
 * it once per allowed call. So a price of five credits is five authorised
 * calls. That is the cost of the claim rather than an accident of it: the only
 * route to a meter reading five is the authorizer having said yes five times,
 * which is precisely what makes the total unfakeable from here.
 *
 * It is affordable because none of it leaves the process. `market.deliver`
 * resolves a grant already in memory, consumes a use, and writes an audit event
 * to a ring buffer; the cloud sink queues and never blocks. The prices this
 * market settles at are single-digit credits, so the whole charge is a handful
 * of in-memory authorizations against a route budget measured in tens of
 * seconds.
 *
 * Returns the meter, not a receipt. A charge that stopped early — an expired
 * deadline, a withdrawn grant — returns the smaller number rather than
 * pretending, and the caller reports what was actually spent.
 */
export async function chargeContract(input: {
  readonly grant: CapabilityGrant;
  readonly contractId: string;
  readonly buyerId: string;
  readonly capabilityFamily: string;
  readonly traceId?: string;
}): Promise<Balance> {
  const context = buildContext({ buyerId: input.buyerId, purpose: PURPOSES.deliver, traceId: input.traceId });
  let balance = await balanceOf(input.grant);

  while (balance.remaining > 0) {
    const outcome = await callTool(
      context,
      "market.deliver",
      { contractId: input.contractId, capabilityFamily: input.capabilityFamily },
      { path: ["market", input.capabilityFamily], action: "deliver" },
    );
    if (outcome.result?.status !== "succeeded") break;

    const next = await balanceOf(input.grant);
    // Allowed but not metered. It should not happen, and a loop that spins on
    // it inside a 120-second route is a worse answer than an honest short
    // charge, so stop and let the caller report the number the meter has.
    if (next.spent === balance.spent) break;
    balance = next;
  }

  return balance;
}

/** Close a contract by taking its grant off the shelf. Nothing lingers. */
export function closeContract(grantId: string): void {
  withdrawGrant(grantId);
}
