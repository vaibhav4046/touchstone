import type { Address, ReachResult } from "@aicoo/sharedos";
import { host, buildContext, usageStore } from "./host";
import { grantHistory, heldGrants, type GrantRecord } from "./authority";
import { ownerDecisions, seedPrecedents } from "./precedent-seed";
import { NAMESPACE, PURPOSES, TOUCHSTONE, buyerAddress } from "./identity";

/**
 * The grant map: who may touch what.
 *
 * Everything here is non-consuming. `reach` is the kernel's own answer to
 * "where may this actor operate", with the authority deliberately stripped out
 * — namespace, path, actions and scope, and nothing about who granted them or
 * how many uses remain. That is what makes it safe to serve to anybody: reading
 * that a door exists is not opening it.
 *
 * Three layers, because they answer three different questions and a reader who
 * cannot tell them apart cannot audit anything.
 *
 *   policy   what the owner decided before the room opened, allow and refuse
 *   reach    where this actor can operate right now, resolved through delegation
 *   held     the grants behind that reach, with the part of each budget spent
 *
 * A refusal in `policy` has no capabilities at all. That absence is load-bearing
 * rather than tidy: it is why a later request cannot read a permission off the
 * back of a "no".
 *
 * One function so the JSON and the page cannot drift. A dashboard that showed
 * something the API did not would be worse than no dashboard.
 */

export interface MappedCapability {
  readonly resource: string;
  readonly actions: readonly string[];
  readonly scope: "exact" | "descendants";
}

export interface MappedGrant {
  readonly id: string;
  readonly issuer: Address;
  readonly parentGrantId?: string;
  readonly delegationDepth?: number;
  readonly purposes: readonly string[];
  readonly expiresAt?: string;
  readonly capabilities: readonly MappedCapability[];
  readonly budget:
    | { readonly bounded: false; readonly spent: number }
    | { readonly bounded: true; readonly purchased: number; readonly spent: number; readonly remaining: number };
}

export interface MappedPolicy {
  readonly label: string;
  readonly purpose: string;
  readonly decision: "allow" | "refuse";
  readonly asked: readonly string[];
  readonly approved?: {
    readonly capabilities: readonly MappedCapability[];
    readonly maxUses?: number;
    readonly purposes?: readonly string[];
    readonly delegationDepth?: number;
  };
}

export interface CeilingRule {
  readonly rule: string;
  readonly statement: string;
}

export interface GrantMap {
  readonly namespace: string;
  readonly owner: Address;
  readonly subject: Address;
  readonly reach: ReachResult;
  readonly held: readonly MappedGrant[];
  readonly policy: readonly MappedPolicy[];
  /** Grants that existed and no longer do. The record outlives the authority. */
  readonly history: readonly GrantRecord[];
  readonly ceiling: readonly CeilingRule[];
  readonly note?: string;
}

/** Rules the grant language cannot state, which is why they live on the host. */
const CEILING: readonly CeilingRule[] = [
  {
    rule: "probe_rate_limited",
    statement: "Six live probes a minute per buyer, whatever the grant says. A grant bounds authority, not volume.",
  },
  {
    rule: "vendor_frozen",
    statement: "A frozen vendor is refused inside the decision, before its grant is ever consulted.",
  },
];

function path(capability: { resource: { namespace: string; path: readonly string[] } }): string {
  return `${capability.resource.namespace}/${capability.resource.path.join("/")}`;
}

function mapCapability(capability: {
  resource: { namespace: string; path: readonly string[] };
  actions: readonly string[];
  scope: "exact" | "descendants";
}): MappedCapability {
  return { resource: path(capability), actions: capability.actions, scope: capability.scope };
}

export async function grantMap(subjectId: string): Promise<GrantMap> {
  const subject = buyerAddress(subjectId);

  // The owner's table, recorded for this buyer if it has not been already.
  // Idempotent, and it mints nothing: it is a record of decisions, not of
  // permissions.
  await seedPrecedents(subjectId);

  const reach = await host().kernel.reach(buildContext({ buyerId: subjectId, purpose: PURPOSES.broker }));
  const store = usageStore();

  const held = await Promise.all(
    heldGrants(NAMESPACE, subject).map(async (grant): Promise<MappedGrant> => {
      const purchased = grant.constraints.maxUses;
      // A credit is a use, so the balance is a question asked of the kernel's
      // meter rather than a number this service keeps.
      const spent = await store.getUsage(grant.namespaceId, grant.id);
      return {
        id: grant.id,
        issuer: grant.issuer,
        parentGrantId: grant.parentGrantId,
        delegationDepth: grant.constraints.delegationDepth,
        purposes: grant.constraints.purposes ?? [],
        expiresAt: grant.constraints.expiresAt,
        capabilities: grant.capabilities.map(mapCapability),
        budget:
          purchased === undefined
            ? { bounded: false, spent }
            : { bounded: true, purchased, spent, remaining: Math.max(0, purchased - spent) },
      };
    }),
  );

  const policy = ownerDecisions(subjectId).map((decision): MappedPolicy => ({
    label: decision.label,
    purpose: decision.question.purpose,
    decision: decision.approved === undefined ? "refuse" : "allow",
    asked: decision.question.capabilities.map(path),
    approved:
      decision.approved === undefined
        ? undefined
        : {
            capabilities: decision.approved.capabilities.map(mapCapability),
            maxUses: decision.approved.constraints.maxUses,
            purposes: decision.approved.constraints.purposes,
            delegationDepth: decision.approved.constraints.delegationDepth,
          },
  }));

  return {
    namespace: NAMESPACE,
    owner: TOUCHSTONE,
    subject,
    // The kernel's word, not ours. `unavailable` is a real answer and is passed
    // through rather than smoothed into an empty list, because a reach that
    // quietly omitted a live grant would be indistinguishable from a true one.
    reach,
    held,
    policy,
    history: grantHistory(),
    ceiling: CEILING,
    note:
      held.length === 0
        ? "No live grants on this instance. A contract grant exists only while its order runs, so an idle process holds none. Run a deal and this fills."
        : undefined,
  };
}
