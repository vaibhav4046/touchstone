import type { AccessContext, AllowedDecision, AuthorizationRequest, HostCeiling, HostCeilingVerdict } from "@aicoo/sharedos";
import { slug } from "./identity";

/**
 * Policy the grant language cannot state.
 *
 * A grant says what a principal may reach. It cannot say "not this vendor, not
 * this minute, not more than six times a minute" — those are properties of the
 * host, not of the delegation. From alpha.5 the kernel has a slot for exactly
 * this, so the ceiling is installed on the authorizer rather than bolted on
 * beside it: it now runs inside the decision instead of second-guessing one
 * that already happened.
 *
 * It is handed an `AllowedDecision` and can only refuse. It never widens a
 * denial, and it is synchronous by construction, because nothing on the
 * authorization path gets to make a network call.
 */
export class TouchstoneCeiling implements HostCeiling {
  readonly #frozenVendors: ReadonlySet<string>;
  readonly #probeBudget = new Map<string, { count: number; windowStart: number }>();
  readonly #probesPerMinute: number;

  /**
   * `frozenVendors` is normalised here rather than at each call site.
   *
   * The set is compared against a resource path segment, and those are slugs.
   * An operator writes "CinematicAgent"; a caller that had to remember to write
   * "cinematicagent" would eventually not, and a freeze that silently matches
   * nothing is worse than no freeze at all.
   */
  constructor(options: { frozenVendors?: readonly string[]; probesPerMinute?: number } = {}) {
    this.#frozenVendors = new Set((options.frozenVendors ?? []).map((vendor) => slug(vendor)));
    this.#probesPerMinute = options.probesPerMinute ?? 6;
  }

  narrow(
    decision: AllowedDecision,
    request: AuthorizationRequest,
    context: AccessContext,
  ): HostCeilingVerdict {
    const path = request.resource.path;

    if (path[0] === "vendors" && this.#frozenVendors.has(path[1] ?? "")) {
      return { allowed: false, reasonCode: "host_policy_denied", metadata: { rule: "vendor_frozen" } };
    }

    // Live probing reaches a third party. It is rate-limited per buyer even
    // when a grant permits it, because a grant bounds authority, not volume.
    if (request.action === "probe" && !this.#withinProbeBudget(context)) {
      return { allowed: false, reasonCode: "host_policy_denied", metadata: { rule: "probe_rate_limited" } };
    }

    return decision;
  }

  #withinProbeBudget(context: AccessContext): boolean {
    const key = principalKey(context);
    const now = Date.now();
    const bucket = this.#probeBudget.get(key);
    if (bucket === undefined || now - bucket.windowStart > 60_000) {
      this.#probeBudget.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= this.#probesPerMinute) return false;
    bucket.count += 1;
    return true;
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
