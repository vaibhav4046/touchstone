import type { Address, AgentCard, ReachResult, ResourceReach } from "@aicoo/sharedos";
import { reachThroughTools } from "@aicoo/sharedos";
import { host, buildContext, toolCatalogue, usageStore } from "./host";
import { grantHistory, heldGrants, type GrantRecord } from "./authority";
import { readAgentCard } from "./directory";
import { ownerDecisions, seedPrecedents } from "./precedent-seed";
import { NAMESPACE, PURPOSES, TOUCHSTONE, asPurpose, buyerAddress } from "./identity";

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
  /**
   * The kernel's own description of this agent, not ours.
   *
   * `subject` and `namespace` above are read off this rather than assembled
   * here, which is the whole reason it exists: an identity block a service
   * writes about an agent is a claim, and a card is an answer. Reading it was
   * itself authorized — see `lib/sharedos/directory.ts`.
   *
   * The `identity` view specifically, and not the wider `reach` one, even though
   * the subject is entitled to that. A `reach` card would carry a second reach
   * beside the one below, derived a few milliseconds earlier under a directory
   * grant that is withdrawn by the time `reach` is computed — two adjacent fields
   * with the same name disagreeing about the same agent. The card is here to
   * state who this is; `reach` beside it states what they may touch. The wider
   * card is served at `/api/agents/<id>`, where nothing sits next to it.
   */
  readonly card: AgentCard;
  /**
   * The purpose every field below was answered under.
   *
   * Not decoration. A grant minted for one purpose authorizes nothing under
   * another, so reach, the tool catalogue and the narrowed reach are all
   * answers to "while doing this", and a map that did not say which "this"
   * would be unreadable the moment a buyer held authority for two.
   */
  readonly purpose: string;
  /**
   * Grant reach: everywhere this actor is authorized, over the whole world this
   * namespace names. It ignores the tool catalogue on purpose, because the
   * resource plane is not gated by tools — `invokeResource` can reach places no
   * enabled tool operates on.
   */
  readonly reach: ReachResult;
  /**
   * The same reach narrowed to what some offered tool actually operates on.
   *
   * The more honest map of what this actor can *do*, as opposed to where it is
   * permitted to be: a place no tool in its catalogue touches is not somewhere a
   * turn can work, and naming it would send an agent at a wall. Both are kept
   * rather than one replacing the other, because the gap between them is
   * information — it is authority that exists and has no instrument.
   *
   * Descriptive, never permissive, in both directions: an entry kept here is not
   * a permission and an entry dropped was not a refusal. Every call is still
   * authorized independently.
   */
  readonly reachThroughTools: readonly ResourceReach[];
  /**
   * The tools this actor can see, and the hash that identifies the set.
   *
   * `listTools` is permission-filtered, so the list shrinks as authority
   * narrows and is empty for an actor holding nothing. That is the claim "an
   * agent cannot see what it cannot use", computed rather than asserted.
   */
  readonly catalogue: { readonly hash: string; readonly tools: readonly string[] };
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

  const grants = heldGrants(NAMESPACE, subject);

  // Reach is purpose-scoped in SharedOS, so a map of it has to name a purpose,
  // and this one used to name `yuzu.broker` unconditionally. That was wrong in a
  // way only a live deal reveals: the grants a buyer actually holds mid-deal are
  // minted for `yuzu.deliver` or `touchstone.assay`, and reach asked under
  // `yuzu.broker` cannot see them — so the map's headline field read empty while
  // `held` right beneath it listed a live contract. The purpose comes off the
  // authority now, and the map says which one it answered under, because an
  // unstated purpose is the difference between "reaches nothing" and "reaches
  // nothing while brokering".
  const purpose = grants.flatMap((grant) => grant.constraints.purposes ?? []).flatMap((candidate) => {
    const known = asPurpose(candidate);
    return known === undefined ? [] : [known];
  })[0] ?? PURPOSES.broker;

  // The agent reads its own card. A card read is refused rather than thrown, so
  // a refusal here is a bug in the host policy and not a runtime condition —
  // hence the throw: a map that silently invented an identity block when the
  // kernel declined to describe the subject would be the exact failure this
  // field exists to end.
  const identity = await readAgentCard({ readerId: subjectId, subjectId, purpose, view: "identity" });
  if (identity.read.status !== "served") {
    throw new Error(`agent_card_refused:${identity.read.reasonCode}`);
  }
  const card = identity.read.card;

  const context = buildContext({ buyerId: subjectId, purpose });
  const reach = await host().kernel.reach(context);
  // One `listTools` call, three readers: the narrowed reach below, the catalogue
  // names, and the hash. The definitions carry `requiredCapability` and stay
  // host-side; only the published names and the hash go on the map.
  const catalogue = await toolCatalogue(context);
  const store = usageStore();

  const held = await Promise.all(
    grants.map(async (grant): Promise<MappedGrant> => {
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
    // Off the card, not assembled here. The kernel is the thing that decides
    // against this identity, so it is the thing that gets to state it.
    namespace: card.namespaceId,
    owner: TOUCHSTONE,
    subject: card.subject,
    card,
    purpose,
    // The kernel's word, not ours. `unavailable` is a real answer and is passed
    // through rather than smoothed into an empty list, because a reach that
    // quietly omitted a live grant would be indistinguishable from a true one.
    reach,
    // An unavailable reach narrows to nothing rather than to an empty list of
    // its own: there is no reach to narrow, and answering `[]` would read as
    // "this actor can do nothing" instead of "we could not tell".
    reachThroughTools: reach.status === "computed" ? reachThroughTools(reach.reach, catalogue.definitions) : [],
    catalogue: { hash: catalogue.hash, tools: catalogue.published.map((tool) => tool.name) },
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
