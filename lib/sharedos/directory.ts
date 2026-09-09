import type { AccessContext, AgentCardRead, AgentCardView, Address, ReachSummary } from "@aicoo/sharedos";
import { AGENT_CARD_VIEWS, summarizeReach } from "@aicoo/sharedos";
import { buildContext, host } from "./host";
import { depositGrant, withdrawGrant } from "./authority";
import { mintDirectoryGrant } from "./grants";
import { buyerAddress, type Purpose } from "./identity";

/**
 * Who this agent is, answered by the kernel rather than by us.
 *
 * Yuzu is a market of agents and published no agent card, which meant the one
 * question a counterparty actually has — who is this and what may it be asked
 * for — was answered by whatever prose we wrote about ourselves. `readAgentCard`
 * is the kernel's own answer, and it has two properties nothing hand-built here
 * could have had:
 *
 *   Reach is derived at read time, from the grants in force at that instant. A
 *   card we composed would be a stored description of authority, and a stored
 *   one keeps advertising a permission after it is revoked.
 *
 *   Reading one is itself authorized. A directory that answers for free is an
 *   enumeration oracle — it lists the membership of the market and, through
 *   reach, what each member can touch. So the read goes through the same
 *   authorizer as everything else, and a reader that holds nothing is refused
 *   exactly as it would be for an agent that does not exist. An absent agent and
 *   a private one are indistinguishable from outside, which is the point.
 *
 * Authority for the read is minted here and withdrawn in the same call, because
 * a directory grant that outlived the read would be standing authority over the
 * membership list. `mintDirectoryGrant` decides how wide it is; the kernel
 * decides whether the view asked for fits inside it.
 */

export interface DirectoryRead {
  readonly reader: Address;
  readonly subject: Address;
  /** The view asked for, which is not always the view served. */
  readonly requestedView: AgentCardView;
  /** `self` reads every view; a stranger reads `identity` and is refused the rest. */
  readonly relation: "self" | "stranger";
  readonly read: AgentCardRead;
}

export const CARD_VIEWS: readonly AgentCardView[] = AGENT_CARD_VIEWS;

export function isCardView(candidate: string | null | undefined): candidate is AgentCardView {
  return candidate !== null && candidate !== undefined && (AGENT_CARD_VIEWS as readonly string[]).includes(candidate);
}

/**
 * Read one agent's card as another agent.
 *
 * `purpose` is the caller's, not a directory-specific one, and that matters
 * rather than being tidy: the kernel derives the subject's reach under the
 * *reader's* purpose, so a card read under `yuzu.broker` describes what the
 * subject may do while brokering and says nothing about any other intent. Read
 * it under a purpose nothing was granted for and the card is honestly empty.
 *
 * Not to be called inside an open turn. `openTurnAuthority` freezes authority at
 * the turn boundary on purpose, so a grant deposited after it opened is not
 * loaded — which is correct for the turn and wrong for this, whose whole
 * mechanism is a grant minted mid-flight. Every caller here reads outside one.
 */
export async function readAgentCard(input: {
  readonly readerId: string;
  readonly subjectId: string;
  readonly purpose: Purpose;
  readonly view?: AgentCardView;
  readonly traceId?: string;
}): Promise<DirectoryRead> {
  const reader = buyerAddress(input.readerId);
  const subject = buyerAddress(input.subjectId);
  const self = input.readerId === input.subjectId;
  const view = input.view ?? "reach";

  const grant = mintDirectoryGrant({ reader, subject, self, purpose: input.purpose, now: new Date() });
  depositGrant(grant, { record: false });
  try {
    const context = buildContext({ buyerId: input.readerId, purpose: input.purpose, traceId: input.traceId });
    const read = await host().kernel.readAgentCard(context, subject, { view });
    return { reader, subject, requestedView: view, relation: self ? "self" : "stranger", read };
  } finally {
    // The grant covered one read. It does not outlive it.
    withdrawGrant(grant.id);
  }
}

/**
 * The card's reach, collapsed to namespaces and counts.
 *
 * `summarizeReach` is what the kernel's own `namespaces` view is built from, so
 * using it here rather than counting by hand keeps the coarse answer a reader
 * gets from the `namespaces` view and the coarse answer this service prints
 * beside a `reach` card identical. `entries` counts reach entries and not
 * resources, because collapsing a `descendants` entry into a resource count
 * would mean asking a provider what exists — the lookup a card must never
 * become.
 */
export function cardNamespaces(read: AgentCardRead): readonly ReachSummary[] {
  if (read.status !== "served") return [];
  // The coarse view already is this, computed by the kernel from the same
  // function. Recomputing it would be a second answer to a question that has one.
  if (read.card.view === "namespaces") return read.card.namespaces;
  return read.card.view === "reach" ? summarizeReach(read.card.reach) : [];
}

/** The context a card read is decided under. Exported so a caller can audit it. */
export function directoryContext(readerId: string, purpose: Purpose): AccessContext {
  return buildContext({ buyerId: readerId, purpose });
}
