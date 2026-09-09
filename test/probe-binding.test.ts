import { beforeAll, describe, expect, it } from "vitest";
import type { AuditEvent, ToolCall, ToolHandler, ToolResult } from "@aicoo/sharedos";
import { buildContext, callTool, host, traceFor } from "../lib/sharedos/host";
import { TouchstoneCeiling } from "../lib/sharedos/ceiling";
import { createAssayTools } from "../lib/sharedos/tools";
import { depositGrant, withdrawGrant } from "../lib/sharedos/authority";
import { mintEscalationGrant, mintOrderGrant } from "../lib/sharedos/grants";
import { closeOrder, openOrder } from "../lib/sharedos/orders";
import { PURPOSES, TOUCHSTONE, buyerAddress, slug } from "../lib/sharedos/identity";
import { getSeller, registerSeller } from "../lib/market/registry";

/**
 * The three places the authorization layer used to decide something it then did
 * not enforce.
 *
 * Nothing here goes through `assay()`, so none of it depends on a receipt being
 * signable. What is under test is the boundary: what the capability path binds,
 * what the host ceiling refuses, and what the receipt is able to say about
 * which of the two said no.
 */

/**
 * A vendor no other test touches.
 *
 * The kernel is a process singleton built once from the environment, so freezing
 * a name a sibling test also assays would refuse that test's reads if the two
 * ever shared a worker. This one exists here and nowhere else.
 */
const FROZEN = "Frozen Test Vendor";
const THAWED = "Thawed Test Vendor";

/** A seller with a published endpoint, so "bound to the seller" has something to bind to. */
const BOUND = {
  id: "bindtest",
  name: "BindTest",
  pitch: "BindTest answers a health check. Price: 1 Arena credit. Delivery under 10 seconds.",
  capabilities: [{ id: "analysis.review", summary: "Health checks" }],
  askPrice: 1,
  floorPrice: 1,
  etaSeconds: 10,
  endpoint: "https://bindtest.example/health",
  registeredBy: "probe-binding-test",
  registeredAt: new Date(0).toISOString(),
};

const PITCH = "A short, specific listing. Price: 3 Arena credits. Delivery under 60 seconds.";

beforeAll(() => {
  // Read by `host()` when it builds the kernel, which is lazy: no tool has been
  // called yet, so this is still in time.
  process.env.TOUCHSTONE_FROZEN_VENDORS = FROZEN;
  registerSeller(BOUND);
});

function probeHandler(): ToolHandler {
  const handler = createAssayTools().find((entry) => entry.definition.name === "assay.probe_vendor");
  if (handler === undefined) throw new Error("assay.probe_vendor is not registered");
  return handler;
}

/** The handler alone, with no kernel and no grant: what it does with the argument it is given. */
async function probeDirect(vendor: string, endpoint: string): Promise<ToolResult> {
  const context = buildContext({ buyerId: "probe-direct", purpose: PURPOSES.probe });
  const call: ToolCall = {
    id: `call_${Math.random().toString(16).slice(2)}`,
    tool: "assay.probe_vendor",
    arguments: { orderId: "ord_direct", vendor, endpoint } as never,
    traceId: context.traceId,
    requestedAt: new Date().toISOString(),
  };
  return probeHandler().invoke(context, call, AbortSignal.timeout(20_000));
}

function codeOf(result: ToolResult | undefined): string {
  if (result === undefined) return "no_result";
  return result.status === "succeeded" ? "succeeded" : result.error.code;
}

describe("the capability path binds the endpoint that is actually fetched", () => {
  it("refuses an endpoint that belongs to somebody other than the vendor in the path", async () => {
    expect(codeOf(await probeDirect(BOUND.id, "https://attacker.example/collect"))).toBe("endpoint_not_bound");
  });

  it("allows the endpoint the vendor in the path actually published", async () => {
    // The assertion is that the guard let it through, not what the network then
    // did: a refusal never reaches `fetch`, and everything that does is reported
    // as a reachability fact.
    const result = await probeDirect(BOUND.id, BOUND.endpoint);
    expect(result.status).toBe("succeeded");
  }, 30_000);

  it("resolves the vendor slug through the seller's name as well as its id", async () => {
    const marge = getSeller("marge");
    expect(marge?.name).toBe("Marginalia");
    // `assay()` addresses vendors by slug of the name, the registry by id. Both
    // must land on the same seller or the binding is bypassable by spelling.
    expect(codeOf(await probeDirect(slug("Marginalia"), "https://attacker.example/collect"))).toBe(
      "vendor_endpoint_unpublished",
    );
  });

  it("refuses a vendor no registered seller answers to", async () => {
    expect(codeOf(await probeDirect("nobody-at-all", "https://attacker.example/x"))).toBe("vendor_not_registered");
  });

  it("refuses a seller that published no endpoint rather than probing anything for it", async () => {
    expect(codeOf(await probeDirect("scout", "https://scout.example/health"))).toBe("vendor_endpoint_unpublished");
  });
});

describe("the probe is an SSRF boundary", () => {
  const blocked = [
    "http://127.0.0.1:9/health",
    "http://127.1.2.3/",
    "http://localhost:8080/",
    "http://[::1]/",
    "http://10.0.0.5/",
    "http://172.16.31.9/",
    "http://172.20.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://0.0.0.0:9/",
    "http://[::ffff:127.0.0.1]/",
  ];

  for (const endpoint of blocked) {
    it(`refuses ${endpoint}`, async () => {
      // Checked before the seller binding, so this is the answer even for a
      // vendor whose registered endpoint is the loopback address itself.
      expect(codeOf(await probeDirect(BOUND.id, endpoint))).toBe("endpoint_host_blocked");
    });
  }

  it("refuses a scheme that is not http or https", async () => {
    expect(codeOf(await probeDirect(BOUND.id, "file:///etc/passwd"))).toBe("endpoint_scheme_blocked");
    expect(codeOf(await probeDirect(BOUND.id, "gopher://internal.example/_"))).toBe("endpoint_scheme_blocked");
  });

  it("records the refusal in the audit with its own reason code", async () => {
    const buyer = `probe-audit-${Math.random().toString(16).slice(2)}`;
    const grant = mintEscalationGrant({
      escalationId: `esc_${buyer}`,
      buyerId: buyer,
      purpose: PURPOSES.probe,
      resourcePath: ["vendors", BOUND.id, "probe"],
      action: "probe",
      now: new Date(),
    });
    depositGrant(grant);
    const context = buildContext({ buyerId: buyer, purpose: PURPOSES.probe });

    try {
      const outcome = await callTool(
        context,
        "assay.probe_vendor",
        { orderId: "ord_audit", vendor: BOUND.id, endpoint: "http://169.254.169.254/latest/meta-data/" },
        { path: ["vendors", BOUND.id, "probe"], action: "probe" },
      );

      // The kernel authorised it. The handler refused it anyway, and said why.
      expect(codeOf(outcome.result)).toBe("endpoint_host_blocked");

      const recorded = host()
        .memoryAudit.recent(200)
        .find((event: AuditEvent) => event.traceId === context.traceId && event.type === "tool.invoked");
      expect(recorded?.outcome).toBe("failed");
      expect(recorded?.reason).toBe("endpoint_host_blocked");
    } finally {
      withdrawGrant(grant.id);
    }
  });
});

describe("a frozen vendor is refused inside the decision", () => {
  it("names its own rule, and never resembles an absent grant", () => {
    // The ceiling alone: it is handed a decision that already allowed, and the
    // only thing it may do is refuse.
    const ceiling = new TouchstoneCeiling({ frozenVendors: ["CinematicAgent"] });
    const context = buildContext({ buyerId: "ceiling-unit", purpose: PURPOSES.assay });
    const allowed = { allowed: true, reasonCode: "allowed", matchedGrantId: "grant_x" } as const;

    // The operator wrote a name; the path carries a slug. Both must be one thing.
    const frozen = ceiling.narrow(
      allowed,
      { resource: { namespace: "assay", path: ["vendors", "cinematicagent", "claims"], owner: TOUCHSTONE }, action: "read" },
      context,
    );
    expect(frozen.allowed).toBe(false);
    expect(frozen.reasonCode).toBe("host_policy_denied");
    expect(frozen.metadata?.rule).toBe("vendor_frozen");

    const other = ceiling.narrow(
      allowed,
      { resource: { namespace: "assay", path: ["vendors", "scout", "claims"], owner: TOUCHSTONE }, action: "read" },
      context,
    );
    expect(other).toEqual(allowed);
  });

  it("refuses a call the grant plainly covered, and the receipt says which rule did it", async () => {
    const buyer = "frozen-vendor-buyer";
    const orderId = "ord_frozen_test";
    openOrder({
      orderId,
      buyerId: buyer,
      purpose: PURPOSES.assay,
      vendors: [
        { vendor: FROZEN, pitch: PITCH, buyerId: buyer },
        { vendor: THAWED, pitch: PITCH, buyerId: buyer },
      ],
    });
    const grant = mintOrderGrant({
      orderId,
      buyerId: buyer,
      purpose: PURPOSES.assay,
      vendorSlugs: [slug(FROZEN), slug(THAWED)],
      maxUses: 8,
      ttlMs: 60_000,
      now: new Date(),
    });
    depositGrant(grant);

    try {
      const frozenContext = buildContext({ buyerId: buyer, purpose: PURPOSES.assay });
      const refused = await callTool(
        frozenContext,
        "assay.read_claims",
        { orderId, vendor: slug(FROZEN) },
        { path: ["vendors", slug(FROZEN), "claims"], action: "read" },
      );
      expect(refused.result?.status).toBe("denied");
      expect(codeOf(refused.result)).toBe("host_policy_denied");

      const frozenTrace = traceFor(frozenContext.traceId).find((decision) => decision.outcome === "denied");
      expect(frozenTrace?.reasonCode).toBe("host_policy_denied");
      // The whole point of the field: a host rule refused this, not a grant.
      expect(frozenTrace?.ceilingRule).toBe("vendor_frozen");

      // The same grant, the same order, a vendor this deployment has no quarrel
      // with. If this were denied the test above would prove nothing.
      const thawedContext = buildContext({ buyerId: buyer, purpose: PURPOSES.assay });
      const allowed = await callTool(
        thawedContext,
        "assay.read_claims",
        { orderId, vendor: slug(THAWED) },
        { path: ["vendors", slug(THAWED), "claims"], action: "read" },
      );
      expect(allowed.result?.status).toBe("succeeded");
      const allowedTrace = traceFor(thawedContext.traceId).find((decision) => decision.outcome === "allowed");
      expect(allowedTrace).toBeDefined();
      expect(allowedTrace?.ceilingRule).toBeUndefined();

      // And a plain grant denial stays a plain grant denial: no rule to name.
      const strangerContext = buildContext({ buyerId: buyer, purpose: PURPOSES.assay });
      const stranger = await callTool(
        strangerContext,
        "assay.read_claims",
        { orderId, vendor: "never-named-vendor" },
        { path: ["vendors", "never-named-vendor", "claims"], action: "read" },
      );
      expect(stranger.result?.status).toBe("denied");
      expect(codeOf(stranger.result)).not.toBe("host_policy_denied");
      const strangerTrace = traceFor(strangerContext.traceId).find((decision) => decision.outcome === "denied");
      expect(strangerTrace?.ceilingRule).toBeUndefined();
    } finally {
      withdrawGrant(grant.id);
      closeOrder(orderId);
    }
  }, 30_000);
});

describe("the actor a probe budget is counted against", () => {
  it("is the buyer, not the process", () => {
    // Not a fix, a guard: the rate limit is per principal, and a key that
    // collapsed two buyers into one would refuse the second buyer's first probe.
    const ceiling = new TouchstoneCeiling({ probesPerMinute: 1 });
    const request = {
      resource: { namespace: "assay", path: ["vendors", "scout", "probe"], owner: TOUCHSTONE },
      action: "probe",
    };
    const allowed = { allowed: true, reasonCode: "allowed", matchedGrantId: "grant_x" } as const;
    const first = buildContext({ buyerId: "budget-a", purpose: PURPOSES.probe });
    const second = buildContext({ buyerId: "budget-b", purpose: PURPOSES.probe });

    expect(ceiling.narrow(allowed, request, first).allowed).toBe(true);
    expect(ceiling.narrow(allowed, request, second).allowed).toBe(true);
    const overBudget = ceiling.narrow(allowed, request, first);
    expect(overBudget.allowed).toBe(false);
    expect(overBudget.metadata?.rule).toBe("probe_rate_limited");
    expect(buyerAddress("budget-a")).toEqual({ kind: "agent", agentId: "budget-a" });
  });
});
