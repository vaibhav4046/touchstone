import { deriveGrant, type CapabilityGrant } from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, NAMESPACE, TOUCHSTONE, buyerAddress } from "../sharedos/identity";
import { depositGrant, withdrawGrant } from "../sharedos/authority";
import { usageStore } from "../sharedos/host";

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

/** Close a contract by taking its grant off the shelf. Nothing lingers. */
export function closeContract(grantId: string): void {
  withdrawGrant(grantId);
}
