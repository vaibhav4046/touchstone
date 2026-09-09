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
  type TurnEndRecord,
} from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, NAMESPACE, TOUCHSTONE, buyerAddress, type Purpose } from "./identity";
import { CloudAuditSink, MemoryAuditSink } from "./audit";
import { TouchstoneCeiling } from "./ceiling";
import { createDelegationResolver, createGrantSource } from "./authority";
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
  readonly cloudAudit: CloudAuditSink;
  readonly usage: InMemoryGrantUsageStore;
}

declare global {
  // eslint-disable-next-line no-var
  var __touchstoneHost: Host | undefined;
}

function build(): Host {
  const memoryAudit = new MemoryAuditSink();
  const cloudAudit = new CloudAuditSink();
  // One store for the whole process: a credit is a grant use, and a meter that
  // is rebuilt per request is not a meter.
  const usage = new InMemoryGrantUsageStore();
  const kernel = new SharedOSKernel({
    // Authority is loaded by the kernel, from a store the caller cannot reach.
    grantSource: createGrantSource(),
    authorizer: new CapabilityAuthorizer({
      usageStore: usage,
      hostCeiling: new TouchstoneCeiling({ probesPerMinute: 6 }),
      delegationResolver: createDelegationResolver(),
    }),
    audit: new CompositeAuditSink([memoryAudit, cloudAudit]),
    onAuditError: () => {
      // A side effect already happened. Losing its record is worth knowing
      // about but is not worth failing the caller's turn over.
    },
  });

  kernel.registerResourceProvider(createAssayProvider());
  for (const handler of createAssayTools()) kernel.registerTool(handler);

  return { kernel, memoryAudit, cloudAudit, usage };
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

/**
 * One turn, bounded at both ends.
 *
 * Two things were missing without this. Authority was re-resolved on every
 * single call, so a store that went down between the third stage and the fourth
 * could change its mind mid-deal; a turn lease freezes it once and keeps a turn
 * that could not establish authority fail-closed for its whole length. And the
 * audit stream had no terminal at all — a reader could see eight `tool.invoked`
 * rows and had nothing but a shared `traceId` to tell them where the turn
 * stopped or whether it stopped well. `turn.ended` is that terminal.
 *
 * `close` runs on every exit path including the throwing one, because an
 * unclosed lease leaves a stale authority answering for whatever presents the
 * same turn identity next.
 */
export async function withTurn<T>(
  context: AccessContext,
  executionId: string,
  body: () => Promise<T>,
): Promise<T> {
  const scope = await host().kernel.openTurnAuthority(context);
  let status: TurnEndRecord["status"] = "succeeded";
  let reasonCode: string | undefined = scope.status === "unavailable" ? scope.code : undefined;

  // A turn that could not load authority is not run. Every call inside it would
  // be refused one at a time anyway; refusing once at the boundary is the same
  // answer with a record of why.
  if (scope.status === "unavailable") {
    try {
      await host().kernel.recordTurnEnd(context, { executionId, status: "denied", reasonCode, endedBy: "envelope" });
    } finally {
      scope.close();
    }
    throw new Error(`authority_unavailable:${reasonCode ?? "unknown"}`);
  }

  try {
    return await body();
  } catch (error) {
    status = "failed";
    reasonCode = error instanceof Error ? error.message.slice(0, 120) : "unknown";
    throw error;
  } finally {
    try {
      await host().kernel.recordTurnEnd(context, {
        executionId,
        status,
        reasonCode,
        endedBy: status === "failed" ? "runtime" : undefined,
      });
    } catch {
      // The work already happened. Losing its terminal is worth knowing about
      // and is not worth failing the caller's turn over, which is the same
      // judgement `onAuditError` makes above.
    }
    scope.close();
  }
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

/**
 * Flush the shipped copy of the audit trail.
 *
 * Called from routes through Next's after(). The organisers verify a build by its
 * audit trail, so an event that was recorded correctly and never left the
 * instance is the same as one that was never recorded.
 */
export function usageStore(): InMemoryGrantUsageStore {
  return host().usage;
}

export async function drainAudit(): Promise<void> {
  await host().cloudAudit.drain();
}
