import { randomUUID } from "node:crypto";
import {
  CapabilityAuthorizer,
  CompositeAuditSink,
  InMemoryGrantUsageStore,
  SharedOSKernel,
  catalogHash,
  publishToolCatalog,
  type AccessContext,
  type AuditEvent,
  type PublishedToolDefinition,
  type ToolCall,
  type ToolDefinition,
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

/**
 * Vendors this deployment will not touch at all, read from the environment.
 *
 * `vendor_frozen` was a rule with no way to be true: the ceiling implemented it
 * and the only place that ever built a ceiling passed no list, so the branch was
 * unreachable and `/api/grants` advertised a rule that could not fire. A freeze
 * is an operator's judgement about one deployment -- a seller under
 * investigation, a name a legal team wants left alone -- so it belongs in the
 * environment rather than in this file. Comma-separated names or ids; the
 * ceiling slugs them to match the resource path.
 *
 * Empty by default on purpose. Seeding it with the hostile seller would refuse
 * every read of that listing, and reading the hostile listing is exactly how the
 * assay demonstrates it is hostile.
 */
function frozenVendors(): readonly string[] {
  return (process.env.TOUCHSTONE_FROZEN_VENDORS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
      hostCeiling: new TouchstoneCeiling({ frozenVendors: frozenVendors(), probesPerMinute: 6 }),
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
 * How many tool calls one turn may make, whatever its grants say.
 *
 * `TouchstoneCeiling` already states the principle for probes — a grant bounds
 * authority, not volume — and applies it per buyer per minute. Nothing applied
 * it per turn, and a turn is where the volume actually comes from: settlement
 * charges a contract by calling `market.deliver` once per credit in a `while`
 * loop, and the only thing stopping that loop is the meter moving. A meter that
 * stops moving for a reason nobody predicted, inside a route with
 * `maxDuration = 120`, is a spin.
 *
 * So the envelope carries its own budget. It is not a permission check and it is
 * not the kernel's job: the kernel decides whether a call is authorised, and the
 * boundary that opened the turn decides how many calls the turn gets to make.
 * Sixty-four is generous — the widest real turn is a broker run charging a
 * contract worth its whole budget, which is tens — and it is a bound rather than
 * an aspiration.
 */
export const TURN_CALL_BUDGET = 64;

declare global {
  // eslint-disable-next-line no-var
  var __touchstoneTurnCalls: Map<string, number> | undefined;
}

/**
 * Keyed on the trace, which is what a turn's calls actually share.
 *
 * `executionId` is the envelope's name for the turn and `callTool` never sees
 * one; `traceId` is on every context and is what the audit stream already joins
 * a turn's rows by. A call made under a fresh trace is therefore outside any
 * turn this function opened, and is deliberately not counted rather than being
 * counted against somebody else's budget.
 */
const turnCalls: Map<string, number> = (globalThis.__touchstoneTurnCalls ??= new Map());

/** Undefined when the call is within budget, or outside any turn we opened. */
function spendTurnCall(context: AccessContext): string | undefined {
  const spent = turnCalls.get(context.traceId);
  if (spent === undefined) return undefined;
  if (spent >= TURN_CALL_BUDGET) return "turn_call_budget_spent";
  turnCalls.set(context.traceId, spent + 1);
  return undefined;
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

  turnCalls.set(context.traceId, 0);
  try {
    return await body();
  } catch (error) {
    status = "failed";
    reasonCode = error instanceof Error ? error.message.slice(0, 120) : "unknown";
    throw error;
  } finally {
    turnCalls.delete(context.traceId);
    try {
      await host().kernel.recordTurnEnd(context, {
        executionId,
        status,
        reasonCode,
        endedBy: status === "failed" ? "runtime" : undefined,
      });
    } catch (error) {
      // The work already happened. Losing its terminal is worth knowing about
      // and is not worth failing the caller's turn over, which is the same
      // judgement `onAuditError` makes above -- but swallowing it in silence is
      // how a terminal that never fires looks exactly like one that does.
      process.stderr.write(
        `[withTurn] recordTurnEnd failed: ${error instanceof Error ? error.message : String(error)}
`,
      );
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

  // The one refusal made here rather than by the kernel, and therefore the one
  // that reached no sink at all until `recordRefusedCall` existed: a call over
  // the turn's own budget is never presented to the kernel, so there is nothing
  // for the kernel to audit. It lands as `tool.invoked` / denied with
  // `metadata.source: "envelope"`, which is the fact that stops being inferable
  // the moment the envelope starts refusing things — a reader counting refusals
  // can now tell "the authorizer said no" from "the boundary never asked".
  const overBudget = spendTurnCall(context);
  if (overBudget !== undefined) {
    const message = `This turn has already made ${TURN_CALL_BUDGET} tool calls, which is the envelope's own ceiling. No call was made.`;
    await host().kernel.recordRefusedCall(context, {
      callId: call.id,
      tool,
      reasonCode: overBudget,
      cause: `turn_call_budget:${TURN_CALL_BUDGET}`,
    });
    return {
      result: {
        callId: call.id,
        tool,
        completedAt: new Date().toISOString(),
        status: "denied",
        error: { code: overBudget, message, retryable: false },
      },
      denied: {
        action: requirement.action,
        resource: `${ASSAY_NAMESPACE}/${requirement.path.join("/")}`,
        outcome: "denied",
        reasonCode: overBudget,
      },
    };
  }

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
      ceilingRule: ceilingRule(event),
    }))
    .reverse();
}

/**
 * Which host rule refused it, when a host rule was what refused it.
 *
 * `host_policy_denied` says a ceiling said no and nothing about which one. The
 * kernel carries the ceiling's own `metadata` onto the audit record, so the rule
 * name is already there; it was simply never read, which left every receipt
 * unable to distinguish "your grant does not cover this" from "this deployment
 * refuses it for everyone". Those are different answers to the buyer and only
 * one of them is worth appealing.
 */
function ceilingRule(event: AuditEvent): string | undefined {
  const rule = (event.metadata as { readonly rule?: unknown } | undefined)?.rule;
  return typeof rule === "string" ? rule : undefined;
}

export interface ToolCatalogue {
  /**
   * SHA-256 over the canonical JSON of the published tools.
   *
   * What participates is `CATALOG_HASH_FIELDS` and nothing else — name,
   * description, schemas, hints — so two readers handed the same semantic tool
   * set hash identically even though their execution ids and transports differ.
   * That is what makes it usable as evidence: it answers "were these two given
   * the same tools" against schema drift, a missing tool, a renamed tool and a
   * stale discovery cache alike.
   */
  readonly hash: string;
  /** What a model is allowed to see. No `requiredCapability`, ever. */
  readonly published: readonly PublishedToolDefinition[];
  /**
   * The registrations, which carry the capability each tool would require.
   * Host-side only, and the input `reachThroughTools` needs — it keys on the
   * resource namespace a tool operates on, which the published projection has
   * deliberately dropped. Never serialise this.
   */
  readonly definitions: readonly ToolDefinition[];
}

/**
 * The effective tool surface for one context, and the hash that identifies it.
 *
 * `listTools` is permission-filtered, so this shrinks as authority narrows: an
 * actor holding nothing gets an empty catalogue and a hash over nothing, which
 * is fail-closed and still a well-formed answer.
 *
 * Not `kernel.listPublishedTools`, which is the same projection plus an
 * `executionId`. That method describes one delivery of a catalogue to one
 * harness, and the callers here — the grant map, and a receipt pinning the
 * surface it was produced against — want the set itself. `catalogHash`
 * deliberately excludes `executionId` for exactly that reason, so hashing the
 * set directly is the honest shape rather than minting a turn id to throw away.
 */
export async function toolCatalogue(context: AccessContext): Promise<ToolCatalogue> {
  const definitions = await host().kernel.listTools(context);
  const published = publishToolCatalog(definitions);
  return { hash: await catalogHash(published), published, definitions };
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
