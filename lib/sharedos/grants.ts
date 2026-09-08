import { createHash } from "node:crypto";
import type { CapabilityGrant } from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, NAMESPACE, TOUCHSTONE, buyerAddress, type Purpose } from "./identity";

/**
 * Every order mints exactly one grant, and it dies on its own.
 *
 * Three independent bounds, because any one of them alone is a promise rather
 * than a limit: a purpose it cannot leave, a clock it cannot outlive, and a
 * budget of invocations it cannot exceed. The buyer never holds standing
 * authority over Touchstone — only this.
 */
export interface OrderGrantInput {
  readonly orderId: string;
  readonly buyerId: string;
  readonly purpose: Purpose;
  readonly vendorSlugs: readonly string[];
  readonly maxUses: number;
  readonly ttlMs: number;
  readonly now: Date;
}

/** Issued a second in the past: a grant stamped in the future is not yet active. */
const ISSUE_BACKDATE_MS = 1_000;

export function mintOrderGrant(input: OrderGrantInput): CapabilityGrant {
  const issuedAt = new Date(input.now.getTime() - ISSUE_BACKDATE_MS).toISOString();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs).toISOString();

  return {
    id: `grant_${input.orderId}`,
    namespaceId: NAMESPACE,
    subject: buyerAddress(input.buyerId),
    issuer: TOUCHSTONE,
    capabilities: [
      // Read and analyse only the vendors this order actually named.
      ...input.vendorSlugs.map((vendor) => ({
        resource: { namespace: ASSAY_NAMESPACE, path: ["vendors", vendor], owner: TOUCHSTONE },
        actions: ["read", "classify", "analyze"],
        scope: "descendants" as const,
      })),
      // Write exactly one receipt, under this order.
      {
        resource: { namespace: ASSAY_NAMESPACE, path: ["receipts", input.orderId], owner: TOUCHSTONE },
        actions: ["create"],
        scope: "descendants" as const,
      },
      // The buyer may ASK for more. Asking is not receiving.
      {
        resource: { namespace: "sharedos", path: ["escalation"], owner: TOUCHSTONE },
        actions: ["request"],
        scope: "exact" as const,
      },
    ],
    constraints: {
      purposes: [input.purpose],
      expiresAt,
      maxUses: input.maxUses,
    },
    issuedAt,
    metadata: { orderId: input.orderId, buyerId: input.buyerId, tier: "order" },
  };
}

/**
 * Approving an escalation does not widen the order grant. It mints a second,
 * strictly smaller one: one action, one exact resource, one use, sixty seconds.
 */
export function mintEscalationGrant(input: {
  readonly escalationId: string;
  readonly buyerId: string;
  readonly purpose: Purpose;
  readonly resourcePath: readonly string[];
  readonly action: string;
  readonly now: Date;
}): CapabilityGrant {
  // The escalation id carries its whole signed ticket, which is right for a
  // thing that travels between instances and wrong for a label that shows up in
  // a receipt and a console row. Fingerprint it instead.
  const fingerprint = createHash("sha256").update(input.escalationId).digest("hex").slice(0, 10);

  return {
    id: `grant_esc_${fingerprint}`,
    namespaceId: NAMESPACE,
    subject: buyerAddress(input.buyerId),
    issuer: TOUCHSTONE,
    capabilities: [
      {
        resource: { namespace: ASSAY_NAMESPACE, path: [...input.resourcePath], owner: TOUCHSTONE },
        actions: [input.action],
        scope: "exact",
      },
    ],
    constraints: {
      purposes: [input.purpose],
      expiresAt: new Date(input.now.getTime() + 60_000).toISOString(),
      maxUses: 1,
    },
    issuedAt: new Date(input.now.getTime() - ISSUE_BACKDATE_MS).toISOString(),
    metadata: { escalationId: input.escalationId, tier: "escalation" },
  };
}
