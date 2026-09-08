import {
  InMemoryPrecedentLookup,
  admitAutoDecision,
  precedentKey,
  type Precedent,
  type PrecedentAdmission,
} from "@aicoo/sharedos-precedent";
import { mintCapabilityRequest, type AccessContext, type Capability, type CapabilityRequest } from "@aicoo/sharedos";

/**
 * Escalation that does not wake anybody up.
 *
 * The Arena rules forbid a human in the loop for the two hours it runs, and
 * `sharedos.escalate` puts a turn into `escalation_pending` — a bridge that has
 * escalated stops answering until a person resolves it. So the obvious design
 * is also the losing one: a product whose safety story is "it asks a human"
 * disqualifies itself the moment it works.
 *
 * The way out is not to escalate less. It is to have already answered.
 *
 * Before the Arena opens, the owner decides the questions the market will ask —
 * may a broker read a seller's listing, may it run a bounded proof challenge,
 * may it spend a contract's own budget — and those answers are recorded as
 * precedents. During the Arena the same question arrives and is resolved
 * against that record under ADR 0022: an allow may only ever narrow, the
 * capability must be contained by what was approved, the constraints take the
 * tightest envelope across every precedent cited, and the resulting grant is
 * stamped so an operator can select everything one matcher produced.
 *
 * A question with no precedent is not guessed at. It does not happen, it is
 * named in the receipt, and it waits for a person after the room closes.
 */

declare global {
  // eslint-disable-next-line no-var
  var __yuzuPrecedents: InMemoryPrecedentLookup | undefined;
  // eslint-disable-next-line no-var
  var __yuzuPrecedentIndex: Map<string, string[]> | undefined;
}

function lookup(): InMemoryPrecedentLookup {
  globalThis.__yuzuPrecedents ??= new InMemoryPrecedentLookup();
  return globalThis.__yuzuPrecedents;
}

/** Digest of a key's decidable dimensions, used only to find candidates to cite. */
function indexKey(request: CapabilityRequest): string {
  const key = precedentKey(request);
  const caps = key.capabilities
    .map((capability) => `${capability.resource.namespace}/${capability.resource.path.join("/")}#${[...capability.actions].sort().join(",")}@${capability.scope}`)
    .sort()
    .join("|");
  return `${key.namespaceId}::${key.purpose}::${caps}`;
}

function index(): Map<string, string[]> {
  globalThis.__yuzuPrecedentIndex ??= new Map();
  return globalThis.__yuzuPrecedentIndex;
}

/**
 * Record what the owner decided, once, while there is still time to think.
 *
 * This is the human in the loop — before the loop starts, which is the only
 * place the rules leave for one.
 */
export function recordPrecedent(precedent: Precedent, request: CapabilityRequest): void {
  lookup().record(precedent);
  const key = indexKey(request);
  const held = index().get(key) ?? [];
  if (!held.includes(precedent.requestId)) index().set(key, [...held, precedent.requestId]);
}

export interface AutoDecision {
  readonly asked: string;
  readonly allowed: boolean;
  readonly admitted: boolean;
  /** Why it could not be decided from precedent, when it could not. */
  readonly reason?: string;
  readonly citedRequestIds: readonly string[];
  readonly match?: string;
  readonly narrowed?: boolean;
  readonly capabilities?: readonly Capability[];
  readonly constraints?: CapabilityRequest["constraints"];
  readonly metadata?: Record<string, unknown>;
  readonly requestId?: string;
}

/**
 * Ask for authority the running grant does not carry, and answer it from record.
 *
 * The matcher lives here, host-side, exactly where ADR 0022 wants it: the
 * kernel is handed the ids this host chose to cite and re-reads those rows
 * itself, so a proposal cannot smuggle in a precedent that does not exist.
 */
export async function decideFromPrecedent(
  context: AccessContext,
  payload: Parameters<typeof mintCapabilityRequest>[1],
  matcher: string,
): Promise<AutoDecision> {
  const request = await mintCapabilityRequest(context, payload);
  if (request === undefined) {
    return { asked: matcher, allowed: false, admitted: false, reason: "request_unmintable", citedRequestIds: [] };
  }

  const cited = index().get(indexKey(request)) ?? [];
  if (cited.length === 0) {
    return {
      asked: matcher,
      allowed: false,
      admitted: false,
      reason: "no_precedent_cited",
      citedRequestIds: [],
      requestId: request.id,
    };
  }

  const admission: PrecedentAdmission = await admitAutoDecision(
    {
      request,
      citedRequestIds: cited,
      // Propose exactly what was asked for. R1 lets an allow narrow and never
      // widen, so proposing the ask is proposing the ceiling, not a wish.
      proposed: { allowed: true, capabilities: [...request.capabilities] },
      marker: { matcher },
    },
    lookup(),
  );

  if (!admission.admitted) {
    return {
      asked: matcher,
      allowed: false,
      admitted: false,
      reason: admission.reason,
      citedRequestIds: cited,
      requestId: request.id,
    };
  }

  const decision = admission.decision;
  return {
    asked: matcher,
    allowed: decision.allowed,
    admitted: true,
    citedRequestIds: decision.citedRequestIds,
    match: decision.match,
    narrowed: decision.allowed ? decision.narrowed : undefined,
    capabilities: decision.allowed ? decision.capabilities : undefined,
    constraints: decision.allowed ? decision.constraints : undefined,
    metadata: decision.metadata as Record<string, unknown>,
    requestId: request.id,
  };
}
