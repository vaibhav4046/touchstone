import type { AccessContext, AuthorizationDecision } from "@aicoo/sharedos";

export interface CeilingRequest {
  readonly namespace: string;
  readonly path: readonly string[];
  readonly action: string;
}

export interface CeilingDecision extends AuthorizationDecision {
  readonly ceilingRule?: string;
}

/**
 * Policy the grant language cannot state.
 *
 * A grant says what a principal may reach. It cannot say "not this vendor, not
 * this minute, not more than twice a second" — those are properties of the
 * host, not of the delegation. This narrows an ALLOW and never widens a DENY,
 * and it is synchronous by construction: nothing on the authorization path
 * gets to make a network call.
 */
export class HostCeiling {
  readonly #frozenVendors: ReadonlySet<string>;
  readonly #probeBudget = new Map<string, { count: number; windowStart: number }>();
  readonly #probesPerMinute: number;

  constructor(options: { frozenVendors?: readonly string[]; probesPerMinute?: number } = {}) {
    this.#frozenVendors = new Set(options.frozenVendors ?? []);
    this.#probesPerMinute = options.probesPerMinute ?? 6;
  }

  narrow(decision: AuthorizationDecision, request: CeilingRequest, context: AccessContext): CeilingDecision {
    if (!decision.allowed) return decision;

    if (request.path[0] === "vendors" && this.#frozenVendors.has(request.path[1] ?? "")) {
      return { allowed: false, reasonCode: "no_matching_grant", ceilingRule: "vendor_frozen" };
    }

    // Live probing reaches a third party. It is rate-limited per buyer even
    // when a grant permits it, because a grant bounds authority, not volume.
    if (request.action === "probe") {
      const key = principalKey(context);
      const now = Date.now();
      const bucket = this.#probeBudget.get(key);
      if (bucket === undefined || now - bucket.windowStart > 60_000) {
        this.#probeBudget.set(key, { count: 1, windowStart: now });
      } else if (bucket.count >= this.#probesPerMinute) {
        return { allowed: false, reasonCode: "no_matching_grant", ceilingRule: "probe_rate_limited" };
      } else {
        bucket.count += 1;
      }
    }

    return decision;
  }
}

function principalKey(context: AccessContext): string {
  const actor = context.actor;
  switch (actor.kind) {
    case "agent":
      return `agent:${actor.agentId}`;
    case "human":
      return `human:${actor.userId}`;
    case "service":
      return `service:${actor.serviceId}`;
    case "group":
      return `group:${actor.conversationId}`;
  }
}
