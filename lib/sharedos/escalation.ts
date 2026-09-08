import { randomUUID } from "node:crypto";
import type { CapabilityGrant } from "@aicoo/sharedos";
import { PURPOSES, type Purpose } from "./identity";
import { mintEscalationGrant } from "./grants";

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

export function requestEscalation(input: {
  readonly buyerId: string;
  readonly resourcePath: readonly string[];
  readonly action: string;
  readonly reason: string;
}): Escalation {
  expire();
  const escalation: Escalation = {
    id: `esc_${randomUUID().slice(0, 8)}`,
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
  const escalation = escalations.get(id);
  if (escalation === undefined || escalation.state !== "pending") return escalation;

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
