import { randomUUID } from "node:crypto";
import {
  CapabilityAuthorizer,
  CompositeAuditSink,
  InMemoryGrantUsageStore,
  SharedOSKernel,
  type AccessContext,
  type AuditEvent,
  type ToolCall,
  type ToolResult,
} from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, NAMESPACE, TOUCHSTONE, buyerAddress, type Purpose } from "./identity";
import { CloudAuditSink, MemoryAuditSink } from "./audit";
import { TouchstoneCeiling } from "./ceiling";
import { createGrantSource } from "./authority";
import { createAssayProvider } from "./provider";
import { createAssayTools } from "./tools";
import type { DecisionTrace } from "../assay/receipt";

/**
 * One kernel per process, built once.
 *
 * A bounded grant is only bounded if the thing counting its uses outlives the
 * request that spent one, so the usage store lives here rather than being
 * rebuilt per call. Serverless recycles processes and that is fine: a lost
 * counter fails closed against the grant's clock, not open.
 */

interface Host {
  readonly kernel: SharedOSKernel;
  readonly memoryAudit: MemoryAuditSink;
}

declare global {
  // eslint-disable-next-line no-var
  var __touchstoneHost: Host | undefined;
}

function build(): Host {
  const memoryAudit = new MemoryAuditSink();
  const kernel = new SharedOSKernel({
    // Authority is loaded by the kernel, from a store the caller cannot reach.
    grantSource: createGrantSource(),
    authorizer: new CapabilityAuthorizer({
      usageStore: new InMemoryGrantUsageStore(),
      hostCeiling: new TouchstoneCeiling({ probesPerMinute: 6 }),
    }),
    audit: new CompositeAuditSink([memoryAudit, new CloudAuditSink()]),
    onAuditError: () => {
      // A side effect already happened. Losing its record is worth knowing
      // about but is not worth failing the caller's turn over.
    },
  });

  kernel.registerResourceProvider(createAssayProvider());
  for (const handler of createAssayTools()) kernel.registerTool(handler);

  return { kernel, memoryAudit };
}

export function host(): Host {
  globalThis.__touchstoneHost ??= build();
  return globalThis.__touchstoneHost;
}

/**
 * The trusted boundary.
 *
 * Nothing a caller sends becomes part of this. The buyer's id is read from a
 * verified header by the route and passed in; the authority, the owner and the
 * namespace are Touchstone's alone. A request body claiming to be an admin is
 * just a request body — and since alpha.5 there is no `grants` field on this
 * object at all, so authority cannot ride in on one even by mistake.
 */
export function buildContext(input: {
  readonly buyerId: string;
  readonly purpose: Purpose;
  readonly traceId?: string;
}): AccessContext {
  return {
    namespaceId: NAMESPACE,
    actor: buyerAddress(input.buyerId),
    authority: TOUCHSTONE,
    owner: TOUCHSTONE,
    purpose: input.purpose,
    traceId: input.traceId ?? randomUUID(),
    enabledToolNamespaces: [ASSAY_NAMESPACE],
    now: new Date().toISOString(),
  };
}

export interface CallOutcome {
  readonly result?: ToolResult;
  readonly denied?: DecisionTrace;
}

/**
 * Invoke one tool under the kernel.
 *
 * The ceiling used to be applied here, by the host, before the kernel saw the
 * call. It now sits on the authorizer where alpha.5 puts it, so this function
 * does nothing but call the kernel and read what came back — which is the right
 * amount of enforcement for a caller to be doing.
 */
export async function callTool(
  context: AccessContext,
  tool: string,
  args: Record<string, unknown>,
  requirement: { readonly path: string[]; readonly action: string },
): Promise<CallOutcome> {
  const call: ToolCall = {
    id: randomUUID(),
    tool,
    arguments: args as never,
    traceId: context.traceId,
    requestedAt: new Date().toISOString(),
  };

  const result = await host().kernel.invokeTool(context, call);
  if (result.status === "denied") {
    return {
      result,
      denied: {
        action: requirement.action,
        resource: `${ASSAY_NAMESPACE}/${requirement.path.join("/")}`,
        outcome: "denied",
        reasonCode: result.error.code,
      },
    };
  }
  return { result };
}

/**
 * The decision trace is not reconstructed — it is the audit stream, filtered.
 *
 * Anything that says what the kernel decided has to come from the kernel, or
 * the receipt is a description of intent rather than a record of enforcement.
 * Escalations belong in it for the same reason: alpha.5 made `escalated` its
 * own outcome precisely so a request for help is not filed as a refusal.
 */
export function traceFor(traceId: string): readonly DecisionTrace[] {
  return host()
    .memoryAudit.recent(400)
    .filter(
      (event: AuditEvent) =>
        event.traceId === traceId &&
        (event.type === "authorization.checked" || event.type === "escalation.requested"),
    )
    .map((event) => ({
      action: event.action ?? (event.type === "escalation.requested" ? "escalate" : "unknown"),
      resource: event.resource ? `${event.resource.namespace}/${event.resource.path.join("/")}` : "unknown",
      outcome:
        event.outcome === "allowed"
          ? ("allowed" as const)
          : event.outcome === "escalated"
            ? ("escalated" as const)
            : ("denied" as const),
      reasonCode: event.reason ?? String(event.outcome),
      grantId: event.grantId,
    }))
    .reverse();
}
