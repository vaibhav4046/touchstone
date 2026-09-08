import { randomUUID } from "node:crypto";
import {
  CapabilityAuthorizer,
  CompositeAuditSink,
  InMemoryGrantUsageStore,
  SharedOSKernel,
  type AccessContext,
  type AuditEvent,
  type CapabilityGrant,
  type ToolCall,
  type ToolResult,
} from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, NAMESPACE, TOUCHSTONE, buyerAddress, type Purpose } from "./identity";
import { CloudAuditSink, MemoryAuditSink } from "./audit";
import { HostCeiling } from "./ceiling";
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
  readonly ceiling: HostCeiling;
}

declare global {
  // eslint-disable-next-line no-var
  var __touchstoneHost: Host | undefined;
}

function build(): Host {
  const memoryAudit = new MemoryAuditSink();
  const kernel = new SharedOSKernel({
    authorizer: new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() }),
    audit: new CompositeAuditSink([memoryAudit, new CloudAuditSink()]),
    onAuditError: () => {
      // A side effect already happened. Losing its record is worth knowing
      // about but is not worth failing the caller's turn over.
    },
  });

  kernel.registerResourceProvider(createAssayProvider());
  for (const handler of createAssayTools()) kernel.registerTool(handler);

  return { kernel, memoryAudit, ceiling: new HostCeiling({ probesPerMinute: 6 }) };
}

export function host(): Host {
  globalThis.__touchstoneHost ??= build();
  return globalThis.__touchstoneHost;
}

/**
 * The trusted boundary.
 *
 * Nothing a caller sends becomes part of this. The buyer's id is read from a
 * verified header by the route and passed in; the authority, the owner, the
 * namespace and the grants are Touchstone's alone. A request body that claims
 * to be an admin is just a request body.
 */
export function buildContext(input: {
  readonly buyerId: string;
  readonly purpose: Purpose;
  readonly grants: readonly CapabilityGrant[];
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
    grants: [...input.grants],
    now: new Date().toISOString(),
  };
}

export interface CallOutcome {
  readonly result?: ToolResult;
  readonly denied?: DecisionTrace;
}

/**
 * Invoke one tool under the kernel, with the host ceiling applied first.
 *
 * The ceiling can only refuse. Anything it lets through still has to satisfy a
 * grant, and the kernel is the thing that decides that.
 */
export async function callTool(
  context: AccessContext,
  tool: string,
  args: Record<string, unknown>,
  requirement: { readonly path: string[]; readonly action: string },
): Promise<CallOutcome> {
  const ceilingDecision = host().ceiling.narrow(
    { allowed: true, reasonCode: "allowed" },
    { namespace: ASSAY_NAMESPACE, path: requirement.path, action: requirement.action },
    context,
  );

  if (!ceilingDecision.allowed) {
    return {
      denied: {
        action: requirement.action,
        resource: `${ASSAY_NAMESPACE}/${requirement.path.join("/")}`,
        outcome: "denied",
        reasonCode: "host_policy_denied",
        ceilingRule: ceilingDecision.ceilingRule,
      },
    };
  }

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
 */
export function traceFor(traceId: string): readonly DecisionTrace[] {
  return host()
    .memoryAudit.recent(400)
    .filter((event: AuditEvent) => event.traceId === traceId && event.type === "authorization.checked")
    .map((event) => ({
      action: event.action ?? "unknown",
      resource: event.resource ? `${event.resource.namespace}/${event.resource.path.join("/")}` : "unknown",
      outcome: event.outcome === "allowed" ? ("allowed" as const) : ("denied" as const),
      reasonCode: event.reason ?? (event.outcome === "allowed" ? "allowed" : "no_matching_grant"),
      grantId: event.grantId,
    }))
    .reverse();
}
