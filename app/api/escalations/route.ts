import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { decideEscalation, listEscalations } from "../../../lib/sharedos/escalation";
import { json } from "../../../lib/api";

import { drainAudit } from "../../../lib/sharedos/host";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return json({
    escalations: listEscalations().map((escalation) => ({
      id: escalation.id,
      buyerId: escalation.buyerId,
      resource: `assay/${escalation.resourcePath.join("/")}`,
      action: escalation.action,
      reason: escalation.reason,
      state: escalation.state,
      requestedAt: escalation.requestedAt,
      decidedAt: escalation.decidedAt,
      grantId: escalation.grant?.id,
    })),
  });
}

/**
 * Who is allowed to be the human.
 *
 * The ticket id is handed back to whoever asked for the probe, so without this
 * the "human decision" is a curl the requesting party makes on its own request
 * — and approval mints a grant for the path and action the ticket names. An
 * operator secret is therefore separate from everything a buyer ever sees, and
 * an unset secret refuses rather than waves through: a deployment that forgot
 * to configure the operator is a deployment with no operator, not an open one.
 */
function isOperator(request: Request): boolean {
  const expected = process.env.TOUCHSTONE_OPERATOR_KEY;
  if (expected === undefined || expected.length === 0) return false;
  const presented = request.headers.get("x-operator-key") ?? "";
  // Digest both sides so the comparison is fixed-width, and therefore constant
  // time over the secret's length as well as its bytes.
  return timingSafeEqual(digest(expected), digest(presented));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The human decision.
 *
 * Approval does not widen the grant that was denied. It mints a new one, one
 * action wide and sixty seconds long, and returns it so the shape can be read
 * rather than described.
 */
export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());
  if (!isOperator(request)) {
    return json(
      {
        error: "operator_key_required",
        message:
          "Deciding an escalation is an operator action. Send the operator secret in x-operator-key. If TOUCHSTONE_OPERATOR_KEY is unset on this deployment, no decision can be made here and pending requests expire on their own.",
      },
      403,
    );
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string; approve?: boolean };
  if (typeof body.id !== "string") return json({ error: "missing_id" }, 400);

  const escalation = decideEscalation(body.id, body.approve === true);
  if (escalation === undefined) return json({ error: "unknown_escalation" }, 404);

  return json({
    id: escalation.id,
    state: escalation.state,
    decidedAt: escalation.decidedAt,
    mintedGrant: escalation.grant
      ? {
          id: escalation.grant.id,
          scope: escalation.grant.capabilities[0]?.scope,
          actions: escalation.grant.capabilities[0]?.actions,
          maxUses: escalation.grant.constraints.maxUses,
          expiresAt: escalation.grant.constraints.expiresAt,
        }
      : null,
  });
}
