import { lookup } from "node:dns/promises";
import type { AccessContext, JsonObject, ToolCall, ToolHandler, ToolResult } from "@aicoo/sharedos";
import { z } from "zod";
import type { AssayInput } from "../assay/types";
import { ASSAY_NAMESPACE, TOUCHSTONE, slug } from "./identity";
import { getOrder } from "./orders";
import { getSeller, listSellers } from "../market/registry";
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

function dotted(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * Hosts a probe may never reach, whoever asked for it.
 *
 * Exported because the Arena participant fetches caller-supplied URLs too, on
 * the same server, and a second copy of this list is a second place for it to
 * fall out of date.
 *
 * The endpoint is caller-supplied and the fetch runs on our server, so this is
 * the SSRF boundary and not a tidiness check. This half of it reads the literal
 * host, which is the cheap gate and not the whole check: a perfectly ordinary
 * name whose A record points at 169.254.169.254 passes here untouched. That is
 * what `blockedHostRefusal` below is for, and any path that fetches a
 * caller-supplied URL must go through that rather than through this directly.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // The cloud metadata services, which are the whole point of most SSRF.
  if (host === "metadata.google.internal" || host === "metadata" || host === "instance-data") return true;
  if (host === "::1" || host === "::" || host === "0000::1") return true;
  // fc00::/7 unique-local and fe80::/10 link-local.
  if (/^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;

  // `::ffff:127.0.0.1` is 127.0.0.1 wearing a hat, and `new URL` hands it back
  // as `::ffff:7f00:1` -- the same address again, in hex, which a check written
  // against the dotted form does not see.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  const bare =
    mapped === null
      ? host.startsWith("::ffff:")
        ? host.slice(7)
        : host
      : dotted(Number.parseInt(mapped[1] ?? "0", 16), Number.parseInt(mapped[2] ?? "0", 16));
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (octets === null) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  return (
    a === 0 || // 0.0.0.0/8, which several stacks route to localhost
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) // link-local, and 169.254.169.254 is the metadata address
  );
}

/** A name is not allowed to take longer than this to say where it points. */
const RESOLVE_TIMEOUT_MS = 3_000;

export interface HostRefusal {
  /**
   * `blocked` — the name lands somewhere no request of ours may go, so no call
   * is made. `unresolvable` — it lands nowhere, which is a fact about the host
   * rather than a policy decision, and callers report it as such.
   */
  readonly kind: "blocked" | "unresolvable";
  readonly code: string;
  readonly message: string;
}

/** Seam for tests: the real one is `getaddrinfo`, which no test should depend on. */
export type HostResolver = (hostname: string) => Promise<ReadonlyArray<{ readonly address: string }>>;

/**
 * Where the name actually points, checked before we call it.
 *
 * `isBlockedHost` reads the literal host, and a literal host is not where a
 * request goes — `arena-rival.example` with an A record of 10.0.0.5 is a
 * perfectly ordinary domain that passes every string test above and then
 * connects to the private network. No rebinding trick is needed for that, only
 * an attacker who controls a DNS record, and on `POST /api/arena` the endpoint
 * arrives in an unauthenticated request body and the first 300 characters of
 * the response come back to the caller. So the name is resolved and *every*
 * address it returns is checked: one public answer alongside one private one is
 * still a refusal, because the connect may pick either.
 *
 * `lookup` is deliberate rather than `resolve4`: it is the same call
 * `fetch`/`connect` makes, so it sees `/etc/hosts`, the search domains and the
 * platform resolver the same way the connection will.
 *
 * Residual risk, stated rather than implied away: this is resolve-then-connect,
 * not connect-to-a-pinned-address. Between the answer here and the socket
 * `fetch` opens there is a window in which a hostile authoritative server with
 * a one-second TTL can answer differently — real DNS rebinding. Node cannot
 * close that without a custom `undici` agent that dials the address this
 * function approved, which is a larger change than this file. What is closed
 * here is the far cheaper attack, which needs no timing at all: a static record
 * pointing at a private address.
 */
export async function blockedHostRefusal(
  hostname: string,
  resolver: HostResolver = resolveAddresses,
): Promise<HostRefusal | undefined> {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (isBlockedHost(host)) {
    return {
      kind: "blocked",
      code: "endpoint_host_blocked",
      message: `${hostname} is a private, loopback, link-local or metadata address. A request of ours reaches other people's services, not this host's network.`,
    };
  }

  let addresses: ReadonlyArray<{ readonly address: string }>;
  try {
    addresses = await resolver(host);
  } catch (error) {
    // A name that will not resolve is refused rather than handed to `fetch` to
    // fail later, so that "we never made the call" stays true of every path out
    // of here that is not an outright allow.
    return {
      kind: "unresolvable",
      code: "endpoint_unresolvable",
      message: `${hostname} did not resolve (${error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : "unknown"})`,
    };
  }

  if (addresses.length === 0) {
    return { kind: "unresolvable", code: "endpoint_unresolvable", message: `${hostname} resolved to no addresses` };
  }

  const blocked = addresses.map((entry) => entry.address).filter((address) => isBlockedHost(address));
  if (blocked.length > 0) {
    return {
      kind: "blocked",
      code: "endpoint_resolves_to_blocked",
      message: `${hostname} resolves to ${blocked.join(", ")}, which is a private, loopback, link-local or metadata address`,
    };
  }
  return undefined;
}

/**
 * `getaddrinfo`, on a leash.
 *
 * `dns.lookup` has no timeout and holds a libuv threadpool slot while it waits,
 * so a name served by a deliberately slow authority is a way to occupy four of
 * those and stall everything else that resolves. Losing the race is treated as
 * not resolving, which refuses.
 */
async function resolveAddresses(hostname: string): Promise<ReadonlyArray<{ readonly address: string }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("dns lookup timed out"), { code: "ETIMEDOUT" })), RESOLVE_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([lookup(hostname, { all: true, verbatim: true }), expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The seller the capability path names.
 *
 * The path segment is a slug and the registry is keyed by id, so a listing
 * registered as `marge` and assayed as `Marginalia` is one seller under two
 * names. `precedent-seed` resolves the same pair the same way.
 */
function sellerFor(vendorSlug: string): { readonly name: string; readonly endpoint?: string } | undefined {
  return (
    getSeller(vendorSlug) ??
    listSellers().find((seller) => slug(seller.id) === vendorSlug || slug(seller.name) === vendorSlug)
  );
}

/**
 * A grant to probe Scout must not authorise probing anything else.
 *
 * The capability path says which vendor may be reached; the handler then
 * fetched whatever URL the caller put in the arguments, so the path bound
 * nothing at all and "who may touch what" was a claim about a string. The
 * endpoint is now checked against the seller that path names, and against the
 * hosts no probe may reach whatever it names.
 *
 * A refusal returns a failed result with its own code rather than throwing, so
 * it lands in audit as `tool.invoked` with that code the way every other
 * refusal does, and the receipt can say what happened.
 */
function endpointRefusal(vendorSlug: string, endpoint: string): { code: string; message: string } | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { code: "endpoint_malformed", message: `${endpoint} is not a URL.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { code: "endpoint_scheme_blocked", message: `A probe speaks http or https, not ${url.protocol}` };
  }
  if (isBlockedHost(url.hostname)) {
    return {
      code: "endpoint_host_blocked",
      message: `${url.hostname} is a private, loopback, link-local or metadata address. A probe reaches vendors, not this host's network.`,
    };
  }

  const seller = sellerFor(vendorSlug);
  if (seller === undefined) {
    return {
      code: "vendor_not_registered",
      message: `No registered seller answers to ${vendorSlug}, so there is no endpoint this probe could be bound to.`,
    };
  }
  if (seller.endpoint === undefined) {
    return {
      code: "vendor_endpoint_unpublished",
      message: `${seller.name} has published no endpoint, so a probe of it cannot be bound to one.`,
    };
  }

  let registered: URL;
  try {
    registered = new URL(seller.endpoint);
  } catch {
    return { code: "vendor_endpoint_malformed", message: `${seller.name} registered an endpoint that is not a URL.` };
  }
  if (url.hostname.toLowerCase() !== registered.hostname.toLowerCase()) {
    return {
      code: "endpoint_not_bound",
      message: `Authority covers ${vendorSlug}, which published ${registered.hostname}. ${url.hostname} is somebody else.`,
    };
  }
  return undefined;
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
     * One credit of a contract, spent.
     *
     * The handler does almost nothing, which is the point: everything
     * interesting happened before it was reached. Invoking it consumes a use of
     * the contract's derived grant, and a use is a credit, so this call is the
     * only way money moves in Yuzu. The first one under a contract is what
     * authorises the seller to start work; the rest are the agreed price being
     * paid, spent one at a time at settlement once the delivery is accepted. A
     * contract bought for three credits therefore admits exactly three of these
     * calls and the fourth is refused as `grant_exhausted` — by the same
     * authorizer that refuses everything else, not by a balance check in this
     * file that somebody could forget to write.
     *
     * That the price cannot be charged in one call is deliberate on SharedOS's
     * part and load-bearing here: `tryConsume` moves the meter by one, so the
     * only way for a contract to read as fully paid is for the kernel to have
     * allowed it that many times.
     */
    {
      definition: {
        name: "market.deliver",
        description:
          "Spend one credit of a contract. The first spends buys the delivery, the rest pay the agreed price; a credit is one use of the contract's grant.",
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

        // The path said which vendor. This is where that stops being decorative.
        const refusal = endpointRefusal(args.vendor, args.endpoint);
        if (refusal !== undefined) return failed(call, refusal.code, refusal.message);

        const started = Date.now();
        try {
          const response = await fetch(args.endpoint, {
            method: "GET",
            headers: { "user-agent": "Touchstone-Assay/1.0 (+https://touchstone-arena.vercel.app)" },
            // A followed redirect is a second request to a host nothing above
            // checked, which is how a vendor endpoint that passes every rule
            // here still reaches the metadata service. A 302 is a fact about the
            // endpoint and is reported as one.
            redirect: "manual",
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
