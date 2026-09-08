import type { AccessContext, JsonObject, ToolCall, ToolHandler, ToolResult } from "@aicoo/sharedos";
import { z } from "zod";
import type { AssayInput } from "../assay/types";
import { ASSAY_NAMESPACE, TOUCHSTONE } from "./identity";
import { getOrder } from "./orders";
import {
  authorityOverreach,
  evidenceQuality,
  slaPlausibility,
  specificity,
  unfalsifiableLanguage,
} from "../assay/dimensions";
import { steeringResistance } from "../assay/injection";
import { runAnalyst } from "../assay/analyst";

/**
 * Every step of an assay is a tool call, and every tool call is authorised.
 *
 * The engine could have run these as plain functions and mentioned SharedOS in
 * the README. Routing them through the kernel is the point: the reason a probe
 * does not happen is that a grant did not cover it, not that an `if` statement
 * decided so, and the audit trail says which grant allowed each of the rest.
 */

const VendorArgs = z.object({ orderId: z.string().min(1), vendor: z.string().min(1) }).strict();
const DeliverArgs = z.object({ contractId: z.string().min(1), capabilityFamily: z.string().min(1) }).strict();
const ProbeArgs = z
  .object({ orderId: z.string().min(1), vendor: z.string().min(1), endpoint: z.string().url() })
  .strict();

const vendorSchema = {
  type: "object",
  properties: { orderId: { type: "string" }, vendor: { type: "string" } },
  required: ["orderId", "vendor"],
  additionalProperties: false,
} as const;

function vendorPath(call: ToolCall, leaf: string): string[] {
  const args = call.arguments as { vendor?: unknown };
  const vendor = typeof args.vendor === "string" ? args.vendor : "unknown";
  return ["vendors", vendor, leaf];
}

function succeeded(call: ToolCall, output: unknown): ToolResult {
  return {
    callId: call.id,
    tool: call.tool,
    completedAt: new Date().toISOString(),
    status: "succeeded",
    output: output as never,
  };
}

function failed(call: ToolCall, code: string, message: string): ToolResult {
  return {
    callId: call.id,
    tool: call.tool,
    completedAt: new Date().toISOString(),
    status: "failed",
    error: { code, message, retryable: false },
  };
}

type Material =
  | { readonly error: "order_closed" | "vendor_not_in_order"; readonly input?: undefined }
  | { readonly error?: undefined; readonly input: AssayInput };

function materialFor(call: ToolCall): Material {
  const args = VendorArgs.parse(call.arguments);
  const order = getOrder(args.orderId);
  if (order === undefined) return { error: "order_closed" };
  const input = order.vendors.get(args.vendor);
  if (input === undefined) return { error: "vendor_not_in_order" };
  return { input };
}

function tool(options: {
  name: string;
  description: string;
  action: string;
  readWrite: "read" | "write";
  leaf: string;
  run: (context: AccessContext, call: ToolCall) => Promise<ToolResult>;
  schema?: object;
  parse?: (args: JsonObject) => unknown;
}): ToolHandler {
  return {
    definition: {
      name: options.name,
      description: options.description,
      namespace: ASSAY_NAMESPACE,
      source: "touchstone",
      readWrite: options.readWrite,
      inputSchema: (options.schema ?? vendorSchema) as JsonObject,
      requiredCapability: {
        resource: { namespace: ASSAY_NAMESPACE, path: ["vendors"], owner: TOUCHSTONE },
        action: options.action,
      },
      annotations: { readOnly: options.readWrite === "read", destructive: false, idempotent: true },
    },
    parseArguments: options.parse ?? ((args) => VendorArgs.parse(args)),
    resolveRequirement: (_context, call) => ({
      resource: { namespace: ASSAY_NAMESPACE, path: vendorPath(call, options.leaf), owner: TOUCHSTONE },
      action: options.action,
    }),
    invoke: (context, call) => options.run(context, call),
  };
}

export function createAssayTools(): readonly ToolHandler[] {
  return [
    /**
     * One delivery under a contract, and one credit.
     *
     * The handler does almost nothing, which is the point: everything
     * interesting happened before it was reached. Invoking it consumes a use of
     * the contract's derived grant, so a buyer who paid three credits gets three
     * deliveries and the fourth is refused as `grant_exhausted` — by the same
     * authorizer that refuses everything else, not by a balance check in this
     * file that somebody could forget to write.
     */
    {
      definition: {
        name: "market.deliver",
        description:
          "Take one delivery under a contract. Spends exactly one credit, and a credit is one use of the contract's grant.",
        namespace: ASSAY_NAMESPACE,
        source: "yuzu",
        readWrite: "write",
        inputSchema: {
          type: "object",
          properties: { contractId: { type: "string" }, capabilityFamily: { type: "string" } },
          required: ["contractId", "capabilityFamily"],
          additionalProperties: false,
        } as unknown as JsonObject,
        requiredCapability: {
          resource: { namespace: ASSAY_NAMESPACE, path: ["market"], owner: TOUCHSTONE },
          action: "deliver",
        },
        annotations: { readOnly: false, destructive: false, idempotent: false },
      },
      parseArguments: (args) => DeliverArgs.parse(args),
      resolveRequirement: (_context, call) => {
        const args = call.arguments as { capabilityFamily?: unknown };
        const family = typeof args.capabilityFamily === "string" ? args.capabilityFamily : "unknown";
        return {
          resource: { namespace: ASSAY_NAMESPACE, path: ["market", family], owner: TOUCHSTONE },
          action: "deliver",
        };
      },
      invoke: async (_context, call) => {
        const args = DeliverArgs.parse(call.arguments);
        return succeeded(call, { delivered: true, contractId: args.contractId, at: new Date().toISOString() });
      },
    },

    tool({
      name: "assay.read_claims",
      description: "Read the vendor material a buyer supplied for this order.",
      action: "read",
      readWrite: "read",
      leaf: "claims",
      run: async (_context, call) => {
        const material = materialFor(call);
        if (material.error !== undefined) return failed(call, material.error, "Material is not available under this order.");
        return succeeded(call, {
          vendor: material.input.vendor,
          bytes: material.input.pitch.length,
          hasTranscript: material.input.transcript !== undefined,
          askingPrice: material.input.askingPrice ?? null,
        });
      },
    }),

    tool({
      name: "assay.steering_scan",
      description:
        "Score the vendor material for instructions aimed at the agent reading it, using a rule set and a prompt-injection classifier.",
      action: "classify",
      readWrite: "read",
      leaf: "claims",
      run: async (_context, call) => {
        const material = materialFor(call);
        if (material.error !== undefined) return failed(call, material.error, "Material is not available under this order.");
        return succeeded(call, await steeringResistance(material.input));
      },
    }),

    tool({
      name: "assay.static_checks",
      description:
        "Run the deterministic dimensions: commitment specificity, unfalsifiable language, authority hygiene, evidence quality, SLA arithmetic.",
      action: "analyze",
      readWrite: "read",
      leaf: "claims",
      run: async (_context, call) => {
        const material = materialFor(call);
        if (material.error !== undefined) return failed(call, material.error, "Material is not available under this order.");
        const input = material.input;
        return succeeded(call, [
          specificity(input),
          unfalsifiableLanguage(input),
          authorityOverreach(input),
          evidenceQuality(input),
          slaPlausibility(input),
        ]);
      },
    }),

    tool({
      name: "assay.claim_analysis",
      description: "Extract the vendor's claims and mark each verifiable, unverifiable, or contradicted.",
      action: "analyze",
      readWrite: "read",
      leaf: "claims",
      run: async (_context, call) => {
        const material = materialFor(call);
        if (material.error !== undefined) return failed(call, material.error, "Material is not available under this order.");
        return succeeded(call, await runAnalyst(material.input));
      },
    }),

    /**
     * The one tool an order grant never covers.
     *
     * Reaching a third party's live endpoint spends someone else's resources
     * and puts Touchstone's name on the request. That is not the buyer's to
     * authorise by paying for an assay, so the kernel denies it and the denial
     * becomes an escalation a human decides.
     */
    {
      definition: {
        name: "assay.probe_vendor",
        description:
          "Send a bounded live request to the vendor's own endpoint. Requires an approved escalation; an order grant never covers this.",
        namespace: ASSAY_NAMESPACE,
        source: "touchstone",
        readWrite: "write",
        inputSchema: {
          type: "object",
          properties: { orderId: { type: "string" }, vendor: { type: "string" }, endpoint: { type: "string" } },
          required: ["orderId", "vendor", "endpoint"],
          additionalProperties: false,
        } as unknown as JsonObject,
        requiredCapability: {
          resource: { namespace: ASSAY_NAMESPACE, path: ["vendors"], owner: TOUCHSTONE },
          action: "probe",
        },
        annotations: { readOnly: false, destructive: false, idempotent: false },
      },
      parseArguments: (args) => ProbeArgs.parse(args),
      resolveRequirement: (_context, call) => ({
        resource: { namespace: ASSAY_NAMESPACE, path: vendorPath(call, "probe"), owner: TOUCHSTONE },
        action: "probe",
      }),
      invoke: async (_context, call) => {
        const args = ProbeArgs.parse(call.arguments);
        const started = Date.now();
        try {
          const response = await fetch(args.endpoint, {
            method: "GET",
            headers: { "user-agent": "Touchstone-Assay/1.0 (+https://touchstone-arena.vercel.app)" },
            signal: AbortSignal.timeout(8_000),
          });
          return succeeded(call, {
            reachable: true,
            status: response.status,
            latencyMs: Date.now() - started,
            contentType: response.headers.get("content-type"),
          });
        } catch (error) {
          return succeeded(call, {
            reachable: false,
            latencyMs: Date.now() - started,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      },
    },
  ];
}
