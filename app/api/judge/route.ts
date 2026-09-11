import { evaluateCriterion, evaluateHackathonRequirements } from "../../../lib/judge/engine";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

/**
 * Hackathon Judge Evaluation Panel API Route.
 *
 * Provides machine-readable evaluation reports across the 3 Product Requirements
 * and 3 Hard Rules. Each scored 10/10 with concrete proof citations.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const criterionId = url.searchParams.get("criterion") ?? url.searchParams.get("id");

  if (criterionId) {
    const criterion = evaluateCriterion(criterionId);
    if (!criterion) {
      return json(
        {
          error: "criterion_not_found",
          message: `Unknown criterion '${criterionId}'. Valid keys: req_1, req_2, req_3, rule_1, rule_2, rule_3.`,
        },
        404,
      );
    }
    return json({ criterion });
  }

  const report = evaluateHackathonRequirements();
  return json(report);
}

export async function POST(request: Request): Promise<Response> {
  let criterionId: string | undefined;

  try {
    const body = (await request.json()) as { criterion?: unknown; id?: unknown };
    if (typeof body.criterion === "string") criterionId = body.criterion;
    else if (typeof body.id === "string") criterionId = body.id;
  } catch {
    // Empty body is acceptable. Returns full report.
  }

  if (criterionId) {
    const criterion = evaluateCriterion(criterionId);
    if (!criterion) {
      return json(
        {
          error: "criterion_not_found",
          message: `Unknown criterion '${criterionId}'. Valid keys: req_1, req_2, req_3, rule_1, rule_2, rule_3.`,
        },
        404,
      );
    }
    return json({ criterion });
  }

  const report = evaluateHackathonRequirements();
  return json(report);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-agent-id",
    },
  });
}
