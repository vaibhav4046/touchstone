import { createHmac, timingSafeEqual } from "node:crypto";
import type { CapabilityGrant } from "@aicoo/sharedos";
import type { AccessContext } from "@aicoo/sharedos";
import { ASSAY_NAMESPACE, PURPOSES, TOUCHSTONE, type Purpose } from "./identity";
import { mintEscalationGrant } from "./grants";
import { host } from "./host";
import { depositGrant } from "./authority";
// One key, one guard. A second copy of the fallback is a second way to ship it.
import { signingKey } from "../assay/receipt";

/**
 * What a denial turns into.
 *
 * A kernel that only ever says no is a wall, not a permission system. When
 * Touchstone needs authority the buyer's order grant does not carry — reaching
 * out to a third party's live endpoint is the real case — the denial opens an
 * escalation instead of failing the call. A human approves it, and approval
 * mints a *narrower* grant: one action, one exact resource, one use, sixty
 * seconds. The order grant is never widened.
 */
export type EscalationState = "pending" | "approved" | "denied" | "expired";

export interface Escalation {
  readonly id: string;
  readonly buyerId: string;
  readonly purpose: Purpose;
  readonly resourcePath: readonly string[];
  readonly action: string;
  readonly reason: string;
  readonly requestedAt: string;
  state: EscalationState;
  decidedAt?: string;
  grant?: CapabilityGrant;
}

const ESCALATION_TTL_MS = 10 * 60_000;

/**
 * Also pinned to the process, and for a sharper reason than convenience.
 *
 * The route that opens an escalation, the console stream that displays it, and
 * the route that approves it are three different module graphs. Split them
 * across three maps and an approval lands somewhere nobody is reading — the
 * pending request stays pending, which for a permission system is the failure
 * mode that looks most like working.
 */
declare global {
  // eslint-disable-next-line no-var
  var __touchstoneEscalations: Map<string, Escalation> | undefined;
  // eslint-disable-next-line no-var
  var __touchstoneEscalationListeners: Set<(escalation: Escalation) => void> | undefined;
}

const escalations: Map<string, Escalation> = (globalThis.__touchstoneEscalations ??= new Map());
const listeners: Set<(escalation: Escalation) => void> = (globalThis.__touchstoneEscalationListeners ??= new Set());

/**
 * The ticket is the request, signed.
 *
 * Escalations were held only in memory, which works until the instance that
 * created one is not the instance that receives the approval — and on
 * serverless that is the normal case, not the edge case. A pending request that
 * silently cannot be approved is the worst failure a permission system has,
 * because it looks exactly like a careful refusal.
 *
 * So the id carries its own contents: what was asked for, by whom, when, and a
 * signature over all of it. Any instance can verify one and mint the grant it
 * describes. The in-memory map stays, but only so the console has a list to
 * show — approval no longer depends on it.
 */
interface Ticket {
  readonly b: string;
  readonly p: readonly string[];
  readonly a: string;
  readonly r: string;
  readonly t: number;
}

function seal(ticket: Ticket): string {
  const body = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const mac = createHmac("sha256", signingKey()).update(body).digest("base64url").slice(0, 22);
  return `esc_${body}.${mac}`;
}

function unseal(id: string): Ticket | undefined {
  if (!id.startsWith("esc_")) return undefined;
  const [body, mac] = id.slice(4).split(".");
  if (body === undefined || mac === undefined) return undefined;
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url").slice(0, 22);
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) {
    return undefined;
  }
  try {
    const ticket = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
    if (Date.now() - ticket.t > ESCALATION_TTL_MS) return undefined;
    return ticket;
  } catch {
    return undefined;
  }
}

/**
 * Opening one is a kernel event, not just a row in our own table.
 *
 * `recordEscalation` mints nothing and unblocks nothing — it writes a single
 * audit event with outcome `escalated` and hands back the stub the turn ends
 * on. That matters because alpha.5 made `escalated` a distinct outcome rather
 * than a flavour of denial: a denial is a decision SharedOS made, an escalation
 * is one it declined to make, and filing them together would inflate the
 * refusal rate with every case where the system correctly asked for help.
 */
export async function requestEscalation(input: {
  readonly buyerId: string;
  readonly resourcePath: readonly string[];
  readonly action: string;
  readonly reason: string;
  readonly context?: AccessContext;
}): Promise<Escalation> {
  expire();

  if (input.context !== undefined) {
    try {
      await host().kernel.recordEscalation(input.context, input.reason, {
        requestedAuthority: {
          capabilities: [
            {
              resource: { namespace: ASSAY_NAMESPACE, path: [...input.resourcePath], owner: TOUCHSTONE },
              actions: [input.action],
              scope: "exact",
            },
          ],
          purpose: PURPOSES.probe,
          constraints: { purposes: [PURPOSES.probe], maxUses: 1 },
        },
      });
    } catch {
      // The escalation still stands. Failing to record it is worth less than
      // losing the request that a human is about to be asked to decide.
    }
  }

  const escalation: Escalation = {
    id: seal({ b: input.buyerId, p: input.resourcePath, a: input.action, r: input.reason, t: Date.now() }),
    buyerId: input.buyerId,
    purpose: PURPOSES.probe,
    resourcePath: input.resourcePath,
    action: input.action,
    reason: input.reason,
    requestedAt: new Date().toISOString(),
    state: "pending",
  };
  escalations.set(escalation.id, escalation);
  emit(escalation);
  return escalation;
}

export function decideEscalation(id: string, approve: boolean): Escalation | undefined {
  expire();

  // Not in this instance's memory is not the same as not real. Rebuild it from
  // the signed ticket instead of refusing an approval that was properly issued.
  let escalation = escalations.get(id);
  if (escalation === undefined) {
    const ticket = unseal(id);
    if (ticket === undefined) return undefined;
    escalation = {
      id,
      buyerId: ticket.b,
      purpose: PURPOSES.probe,
      resourcePath: ticket.p,
      action: ticket.a,
      reason: ticket.r,
      requestedAt: new Date(ticket.t).toISOString(),
      state: "pending",
    };
    escalations.set(id, escalation);
  }

  if (escalation.state !== "pending") return escalation;

  escalation.state = approve ? "approved" : "denied";
  escalation.decidedAt = new Date().toISOString();
  if (approve) {
    escalation.grant = mintEscalationGrant({
      escalationId: escalation.id,
      buyerId: escalation.buyerId,
      purpose: escalation.purpose,
      resourcePath: escalation.resourcePath,
      action: escalation.action,
      now: new Date(),
    });
    // Approval is only real if the kernel can load it on the next turn.
    depositGrant(escalation.grant);
  }
  emit(escalation);
  return escalation;
}

export function listEscalations(limit = 30): readonly Escalation[] {
  expire();
  return [...escalations.values()].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)).slice(0, limit);
}

export function getEscalation(id: string): Escalation | undefined {
  expire();
  return escalations.get(id);
}

export function subscribeEscalations(listener: (escalation: Escalation) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(escalation: Escalation): void {
  for (const listener of listeners) {
    try {
      listener(escalation);
    } catch {
      // A console subscriber must not be able to break an approval.
    }
  }
}

/** Pending forever is a quiet yes. Escalations expire on their own. */
function expire(): void {
  const cutoff = Date.now() - ESCALATION_TTL_MS;
  for (const escalation of escalations.values()) {
    if (escalation.state === "pending" && Date.parse(escalation.requestedAt) < cutoff) {
      escalation.state = "expired";
      escalation.decidedAt = new Date().toISOString();
      emit(escalation);
    }
  }
}
