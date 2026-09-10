import { NextResponse } from "next/server";
import { globalSubagentDispatcher } from "@/lib/subagents/dispatcher";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { buyerBudget, sellerAsking, sellerFloor } = body;

    if (!buyerBudget || !sellerAsking) {
      return NextResponse.json(
        { error: "buyerBudget and sellerAsking are required fields" },
        { status: 400 }
      );
    }

    const result = await globalSubagentDispatcher.dispatch({
      role: "PriceNegotiator",
      action: "negotiate",
      payload: { buyerBudget, sellerAsking, sellerFloor },
      heldCapabilities: ["broker.quote:compute"],
    });

    if (result.status === "denied") {
      return NextResponse.json({ error: result.reason }, { status: 403 });
    }

    return NextResponse.json(result.output);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
