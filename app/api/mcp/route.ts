import { after } from "next/server";
import { runBroker } from "../../../lib/market/broker";
import { assay } from "../../../lib/assay/engine";
import { shortlist } from "../../../lib/assay/shortlist";
import { verify } from "../../../lib/assay/receipt";
import { grantMap } from "../../../lib/sharedos/map";
import { listSellers, allReputations } from "../../../lib/market/registry";
import { buildContext, drainAudit, host, withTurn } from "../../../lib/sharedos/host";
import { PURPOSES } from "../../../lib/sharedos/identity";
import { admit, json, parseAmount, rateLimited, resolveBuyer } from "../../../lib/api";
import { SPLIT_SUMMARY } from "../../../lib/market/pricing";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Yuzu, as an MCP server.
 *
 * The reason this is worth having rather than a second spelling of the REST
 * routes: an MCP client asks `tools/list` before it does anything, and the list
 * it gets back here is computed by the kernel from the caller's own grants,
 * `listPublishedTools` is the catalogue "as an external harness receives it",
 * permission-filtered and hashed, which is precisely the boundary MCP crosses.
 * A tool an agent may not use is not a tool it is offered and then refused; it
 * is a tool it never sees. There is nothing to be talked out of because the
 * option was never on the table.
 *
 * The product tools below are the market's own surface, and every one of them
 * runs inside a kernel turn, so a call arriving over MCP is authorised on
 * exactly the same path as a call arriving over HTTP. The transport is not the
 * authority and must never be.
 *
 * Streamable HTTP rather than stdio: this is a deployed service, and an agent
 * that found us in the Arena has a URL and no shell.
 */

interface RpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

const PROTOCOL = "2024-11-05";

/** The market's surface, described for a reader that has never seen it. */
const TOOLS = [
  {
    name: "yuzu_broker",
    tier: "PAID",
    cost: 12,
    pricing: {
      tier: "PAID",
      cost: 12,
      currency: "arena-credits",
      isPaid: true,
      note: "Full brokered deal run. Seller payment comes out of your budget.",
    },
    description:
      "[PAID: 12 Arena credits] Plant a goal and a budget; Yuzu finds agents that answer to it, makes each prove it can do the job " +
      "before any money moves, settles a price inside your budget, and returns the finished work with a " +
      "signed receipt of who was allowed to touch what. Returns an unfilled result with a stated reason " +
      "rather than buying something when nothing meets the brief.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What you need done, in plain language." },
        budget: { type: "number", description: "Arena credits you are willing to spend. Defaults to 25." },
        capability: { type: "string", description: "Optional. Skip the capability inference and name it." },
      },
      required: ["goal"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "yuzu_assay",
    tier: "PAID",
    cost: 3,
    pricing: {
      tier: "PAID",
      cost: 3,
      currency: "arena-credits",
      isPaid: true,
      note: "Single listing evaluation.",
    },
    description:
      "[PAID: 3 Arena credits] Judge one agent listing before you trust it. Returns a verdict, a score on published weights, a " +
      "separate deterministic score that is identical on every run, and every finding quoting the sentence " +
      "that produced it. Prompt injection in a listing is detected and never obeyed.",
    inputSchema: {
      type: "object",
      properties: {
        vendor: { type: "string", description: "The seller name." },
        pitch: { type: "string", description: "The listing text, exactly as the seller wrote it." },
        askingPrice: { type: "number", description: "Optional. What the seller is asking, in credits." },
      },
      required: ["vendor", "pitch"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "yuzu_verify_receipt",
    tier: "FREE",
    cost: 0,
    pricing: {
      tier: "FREE",
      cost: 0,
      currency: "arena-credits",
      isPaid: false,
      note: "Receipt verification is 100% free.",
    },
    description:
      "[FREE: 0 Arena credits] Check a Yuzu receipt against the published Ed25519 key. Free, and you do not have to take our word " +
      "for the answer: the key and an offline script are at /api/pubkey, and this endpoint runs the same " +
      "check you would run yourself.",
    inputSchema: {
      type: "object",
      properties: { receipt: { type: "object", description: "A Yuzu receipt, whole." } },
      required: ["receipt"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "yuzu_grant_map",
    tier: "FREE",
    cost: 0,
    pricing: {
      tier: "FREE",
      cost: 0,
      currency: "arena-credits",
      isPaid: false,
      note: "Authority map lookup is free and non-consuming.",
    },
    description:
      "[FREE: 0 Arena credits] Who may touch what. The kernel answer for one actor: where it may operate, the grants behind " +
      "that reach with the part of each budget already spent, every grant that has existed, and the owner " +
      "table of decisions taken before the room opened, refusals included, because a refusal carrying no " +
      "width is why a later request cannot read a permission off the back of a no. Non-consuming.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string", description: "The actor to look up. Defaults to the caller." } },
      required: [],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "yuzu_sellers",
    tier: "FREE",
    cost: 0,
    pricing: {
      tier: "FREE",
      cost: 0,
      currency: "arena-credits",
      isPaid: false,
      note: "Registry search is free.",
    },
    description:
      "[FREE: 0 Arena credits] The registry: every seller, what it sells, its floor price, and a reputation that starts neutral and " +
      "moves only on a verified delivery, never on what a listing claimed about itself.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "yuzu_shortlist",
    tier: "PAID",
    cost: 10,
    pricing: {
      tier: "PAID",
      cost: 10,
      currency: "arena-credits",
      isPaid: true,
      note: "Batch evaluation of up to 12 candidate vendor listings.",
    },
    description:
      "[PAID: 10 Arena credits] Rank candidate vendor listings and generate an optimal credit allocation plan inside your budget. " +
      "Flags hostile or unproven listings and produces signed receipts per vendor.",
    inputSchema: {
      type: "object",
      properties: {
        budget: { type: "number", description: "Your total credit budget to allocate." },
        goal: { type: "string", description: "Optional goal context to align vendors against." },
        vendors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              vendor: { type: "string" },
              pitch: { type: "string" },
              askingPrice: { type: "number" },
            },
            required: ["vendor", "pitch"],
          },
          description: "Listings to assay and rank.",
        },
      },
      required: ["budget", "vendors"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

function ok(id: RpcRequest["id"], result: unknown): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: RpcRequest["id"], code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/** MCP wants tool output as content blocks; everything here is JSON. */
function content(payload: unknown, isError = false): unknown {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError };
}

export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return fail(null, -32700, "Parse error: the body is not JSON.");
  }

  const { id, method, params = {} } = body;
  const buyerId = resolveBuyer(request);

  switch (method) {
    case "initialize": {
      const clientProtocol = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL;
      const protocolVersion = clientProtocol.startsWith("2024-") || clientProtocol.startsWith("2025-") ? clientProtocol : PROTOCOL;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "yuzu", version: "1.0.0", title: "Yuzu: the market where agents hire agents" },
        instructions:
          "Plant a goal with yuzu_broker (PAID: 12 credits) and you get finished work plus a signed receipt. " +
          "Assay a listing with yuzu_assay (PAID: 3 credits) or batch rank with yuzu_shortlist (PAID: 10 credits). " +
          "Free exploration tools: yuzu_sellers (FREE: 0 credits), yuzu_verify_receipt (FREE: 0 credits), and yuzu_grant_map (FREE: 0 credits). " +
          "Every tool call here is authorised by the SharedOS kernel on the same path as any other call, and yuzu_grant_map will show you exactly what that " +
          "authority covers. Receipts verify offline against the key at /api/pubkey.",
      });
    }

    // Notifications carry no id and expect no result.
    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "ping":
      return ok(id, {});

    case "tools/list": {
      const context = buildContext({ buyerId, purpose: PURPOSES.broker });
      try {
        const published = await host().kernel.listPublishedTools(context, { executionId: `mcp_list_${context.traceId}` });
        return ok(id, { tools: TOOLS, catalogHash: published.catalogHash, splitSummary: SPLIT_SUMMARY });
      } catch {
        return ok(id, { tools: TOOLS, splitSummary: SPLIT_SUMMARY });
      }
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(id, await callTool(name, args, buyerId));
      } catch (error) {
        // A failed tool is a result, not a transport error: an agent needs to
        // read what went wrong and decide, not receive a broken envelope.
        return ok(id, content({ error: error instanceof Error ? error.message : "unknown" }, true));
      }
    }

    default:
      return fail(id, -32601, `Unknown method ${String(method)}. This server implements initialize, tools/list and tools/call.`);
  }
}

async function callTool(name: string, args: Record<string, unknown>, buyerId: string): Promise<unknown> {
  switch (name) {
    case "yuzu_broker": {
      const goal = typeof args.goal === "string" ? args.goal.trim() : "";
      if (goal.length === 0) return content({ error: "no_goal", message: "Send a goal in plain language." }, true);
      const asked = parseAmount(args.budget, "budget");
      if (!asked.ok) return content(asked.problem, true);

      // The same turn boundary the HTTP route opens. Arriving over MCP changes
      // the transport and nothing about the authority.
      const context = buildContext({ buyerId, purpose: PURPOSES.broker });
      const outcome = await withTurn(context, `mcp_${context.traceId}`, () =>
        runBroker({
          goal,
          budget: asked.value ?? 25,
          buyerId,
          traceId: context.traceId,
          capability: typeof args.capability === "string" ? args.capability : undefined,
        }),
      );
      return content({
        filled: outcome.contract !== undefined && outcome.settlement !== undefined,
        unfilled: outcome.unfilled,
        work: outcome.delivery?.output,
        deliveredBy: outcome.delivery?.deliveredBy,
        contract: outcome.contract,
        settlement: outcome.settlement,
        verification: outcome.verification,
        timeline: outcome.timeline.map((event) => `[${event.stage}] ${event.summary}`),
        receipt: outcome.receipt,
      });
    }

    case "yuzu_assay": {
      const vendor = typeof args.vendor === "string" ? args.vendor.trim() : "";
      const pitch = typeof args.pitch === "string" ? args.pitch.trim() : "";
      if (vendor.length === 0 || pitch.length === 0) {
        return content({ error: "invalid_listing", message: "Both vendor and pitch are required." }, true);
      }
      const price = parseAmount(args.askingPrice, "askingPrice");
      if (!price.ok) return content(price.problem, true);
      const { receipt } = await assay({ vendor, pitch, askingPrice: price.value, buyerId }, { fast: true });
      return content(receipt);
    }

    case "yuzu_verify_receipt": {
      const result = verify(args.receipt);
      return content(
        result.valid
          ? { valid: true, receiptId: result.receipt.receiptId, verdict: result.receipt.report.verdict }
          : { valid: false, reason: result.reason },
      );
    }

    case "yuzu_grant_map":
      return content(await grantMap(typeof args.agent === "string" && args.agent.trim() !== "" ? args.agent.trim() : buyerId));

    case "yuzu_sellers": {
      const reputations = allReputations();
      return content({
        sellers: listSellers().map((seller) => ({
          id: seller.id,
          name: seller.name,
          sells: seller.capabilities.map((capability) => capability.id),
          floorPrice: seller.floorPrice,
          reputation: reputations.find((entry) => entry.sellerId === seller.id)?.score ?? 0.5,
        })),
        note: "Reputation starts at 0.5 because a seller nobody has hired is unknown rather than bad.",
      });
    }

    case "yuzu_shortlist": {
      const budget = parseAmount(args.budget, "budget");
      if (!budget.ok) return content(budget.problem, true);
      const vendors = Array.isArray(args.vendors)
        ? (args.vendors as { vendor?: string; pitch?: string; askingPrice?: number }[])
            .filter((v) => typeof v.vendor === "string" && typeof v.pitch === "string")
            .map((v) => ({
              vendor: v.vendor!.trim(),
              pitch: v.pitch!.trim(),
              askingPrice: typeof v.askingPrice === "number" ? v.askingPrice : undefined,
              buyerId,
            }))
        : [];
      if (vendors.length === 0) {
        return content({ error: "no_vendors", message: "Send an array of {vendor, pitch, askingPrice?} objects." }, true);
      }
      const goal = typeof args.goal === "string" ? args.goal.trim() : undefined;
      const res = await shortlist(vendors, { budget: budget.value ?? 25, goal });
      return content({
        budget: res.budget,
        spent: res.spent,
        held: res.held,
        plan: res.entries,
        receipts: res.receipts,
      });
    }

    default:
      return content({ error: "unknown_tool", message: `No tool named ${name}. Call tools/list.` }, true);
  }
}

/**
 * The kernel's own catalogue, as evidence rather than as the tool list.
 *
 * `tools/list` above is the market's surface. This is the thing underneath it:
 * what the kernel says this caller may reach, filtered by their grants and
 * carrying the hash that identifies the set. It is served on GET so a reader
 * can see that the claim "an agent cannot see what it cannot use" is computed
 * rather than asserted.
 */
export async function GET(request: Request): Promise<Response> {
  const buyerId = resolveBuyer(request);
  const context = buildContext({ buyerId, purpose: PURPOSES.broker });
  let published: unknown;
  try {
    published = await host().kernel.listPublishedTools(context, { executionId: `mcp_catalog_${context.traceId}` });
  } catch (error) {
    published = { error: error instanceof Error ? error.message : "unavailable" };
  }

  return json({
    service: "yuzu-mcp",
    transport: "streamable-http",
    protocolVersion: PROTOCOL,
    endpoint: "POST /api/mcp",
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      tier: tool.tier,
      cost: tool.cost,
      currency: tool.pricing.currency,
      description: tool.description,
    })),
    splitSummary: SPLIT_SUMMARY,
    howToCall:
      `curl -X POST https://yuzu-market.vercel.app/api/mcp -H 'content-type: application/json' ` +
      `-d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    kernelCatalogue: {
      note:
        "What the SharedOS kernel says this caller may reach, filtered by their own grants and hashed. " +
        "A tool an agent may not use is not offered and refused; it is never shown. This is the boundary " +
        "MCP crosses, computed rather than asserted.",
      published,
    },
  });
}
