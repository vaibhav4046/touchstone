import { NextResponse } from "next/server";
import { globalSubagentDispatcher } from "@/lib/subagents/dispatcher";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const capability = searchParams.get("capability") ?? undefined;
  const maxPrice = searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined;

  const result = await globalSubagentDispatcher.dispatch({
    role: "ProductLister",
    action: "search",
    payload: { capability, maxPrice },
    heldCapabilities: ["market.registry:read"],
  });

  return NextResponse.json({
    status: result.status,
    role: result.role,
    data: result.output,
    turnsUsed: result.turnsUsed,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const result = await globalSubagentDispatcher.dispatch({
      role: "ProductLister",
      action: "list",
      payload: body,
      heldCapabilities: ["market.registry:write"],
    });

    if (result.status === "denied") {
      return NextResponse.json(
        { error: result.reason, role: result.role },
        { status: 403 }
      );
    }

    return NextResponse.json(result.output, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
