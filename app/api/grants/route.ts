import { grantMap } from "../../../lib/sharedos/map";
import { resolveBuyer } from "../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The grant map, machine-readable.
 *
 * The same object the dashboard renders, so the two cannot disagree. Nothing
 * here is consuming and nothing here is authority: `reach` has the grants
 * stripped out of it by the kernel before we ever see it.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const subject = url.searchParams.get("agent") ?? resolveBuyer(request);
  return Response.json(await grantMap(subject), { headers: { "cache-control": "no-store" } });
}
