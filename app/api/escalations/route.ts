import { decideEscalation, listEscalations } from "../../../lib/sharedos/escalation";
import { json } from "../../../lib/api";

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
 * The human decision.
 *
 * Approval does not widen the grant that was denied. It mints a new one, one
 * action wide and sixty seconds long, and returns it so the shape can be read
 * rather than described.
 */
export async function POST(request: Request): Promise<Response> {
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
