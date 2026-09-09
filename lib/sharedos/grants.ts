import { createHash, randomUUID } from "node:crypto";
import type { Address, Capability, CapabilityConstraints, CapabilityGrant, JsonObject } from "@aicoo/sharedos";
import {
  DIRECTORY_NAMESPACE,
  DIRECTORY_READ_ACTION,
  agentCardCapability,
  agentCardPath,
} from "@aicoo/sharedos";
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

/**
 * A grant the record issued, rather than a person.
 *
 * Nothing here decides anything. `admitAutoDecision` already bounded the width
 * by every precedent cited (R2) and took the tightest envelope across them
 * (R3); this only puts the result somewhere the kernel will load it on the next
 * turn, exactly as an approved escalation does. The marker rides through
 * untouched, because R4's whole value is that an operator can select every
 * grant one matcher produced and revoke that generation in one action.
 */
export function mintAutoDecidedGrant(input: {
  readonly requestId: string;
  readonly buyerId: string;
  readonly capabilities: readonly Capability[];
  readonly constraints: CapabilityConstraints;
  readonly metadata: JsonObject;
  readonly now: Date;
}): CapabilityGrant {
  // The request id is a SHA-256 of the ask and too long to read in a receipt.
  // Fingerprint it, as the escalation grant does with its ticket.
  //
  // A nonce goes on the end because the request id is deliberately
  // time-invariant: the same ask keeps one identifier across turns, which is
  // right for correlating a question and wrong for naming a grant. The uses
  // meter is keyed on grant id, so reusing one would have the second identical
  // probe refused as `grant_exhausted` by a budget the first one spent. What
  // groups a generation for revocation is the marker, not the id.
  const fingerprint = createHash("sha256").update(input.requestId).digest("hex").slice(0, 10);

  return {
    id: `grant_auto_${fingerprint}_${randomUUID().slice(0, 8)}`,
    namespaceId: NAMESPACE,
    subject: buyerAddress(input.buyerId),
    issuer: TOUCHSTONE,
    capabilities: input.capabilities.map((capability) => ({
      ...capability,
      actions: [...capability.actions],
      resource: { ...capability.resource, path: [...capability.resource.path] },
    })),
    constraints: input.constraints,
    issuedAt: new Date(input.now.getTime() - ISSUE_BACKDATE_MS).toISOString(),
    metadata: { ...input.metadata, buyerId: input.buyerId, tier: "auto" },
  };
}

/**
 * Authority to read one agent's card, and no wider than the reader is owed.
 *
 * Reading a card is gated by SharedOS for a reason worth restating, because it
 * is the reason this grant is narrow rather than standing: without the gate the
 * directory answers "does this agent exist" and, through reach, "what may it
 * touch", for every agent in the world, in one call. Yuzu is a marketplace of
 * agents, so it is exactly the service that would leak its whole membership
 * list through a convenience.
 *
 * The host's decision is therefore expressed as width, not as an `if`:
 *
 *   self      `descendants` over the subject's own directory path, which the
 *             kernel documents as covering every view of it. An agent may see
 *             its own identity and its own reach.
 *   stranger  the `identity` view alone, and it is `agentCardCapability`'s own
 *             exact capability rather than one written here. Another agent may
 *             learn that this one exists and is addressable. What it holds is
 *             not theirs to read, and the refusal for the wider view is made by
 *             the kernel — which then names `identity` in `servableViews`, so
 *             the reader learns what it may still ask for rather than
 *             concluding the subject is unreachable.
 *
 * Unbounded on uses, deliberately. Reading a card consumes nothing in SharedOS,
 * so a `maxUses` here would be a budget that never moves — a number that looks
 * like a limit and is not one. The clock is the bound: thirty seconds, which is
 * longer than a card read and shorter than anything else.
 */
export function mintDirectoryGrant(input: {
  readonly reader: Address;
  readonly subject: Address;
  readonly self: boolean;
  readonly purpose: string;
  readonly now: Date;
}): CapabilityGrant {
  const capability: Capability = input.self
    ? {
        resource: { namespace: DIRECTORY_NAMESPACE, path: agentCardPath(input.subject), owner: TOUCHSTONE },
        actions: [DIRECTORY_READ_ACTION],
        scope: "descendants",
      }
    : agentCardCapability(input.subject, TOUCHSTONE, "identity");

  return {
    // Random rather than derived from the pair: two card reads can overlap, and
    // a shared id would have the first one's withdrawal cancel the second's
    // authority mid-read.
    id: `grant_dir_${randomUUID().slice(0, 8)}`,
    namespaceId: NAMESPACE,
    subject: input.reader,
    issuer: TOUCHSTONE,
    capabilities: [capability],
    constraints: {
      purposes: [input.purpose],
      expiresAt: new Date(input.now.getTime() + 30_000).toISOString(),
    },
    issuedAt: new Date(input.now.getTime() - ISSUE_BACKDATE_MS).toISOString(),
    metadata: { tier: "directory", view: input.self ? "reach" : "identity" },
  };
}
