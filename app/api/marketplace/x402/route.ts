import { NextResponse } from "next/server";
import { globalSubagentDispatcher } from "@/lib/subagents/dispatcher";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/x402
 * Returns HTTP 402 Payment Required with machine-readable challenge headers.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId") ?? `deal_${Date.now()}`;
  const amount = Number(searchParams.get("amount") ?? 10);
  const payee = searchParams.get("payee") ?? "yuzu-platform";

  const result = await globalSubagentDispatcher.dispatch({
    role: "PaymentManager",
    action: "challenge",
    payload: { dealId, amount, payee },
    heldCapabilities: ["sharedos.grants:consume"],
  });

  const challenge = result.output as any;

  return new NextResponse(JSON.stringify(challenge), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `X402 realm="Yuzu Agent Marketplace", token="${challenge.paymentToken}", amount="${challenge.grossAmount}", fee="${challenge.platformFee}"`,
      "X-Payment-Required": "true",
      "X-Payment-Token": challenge.paymentToken,
      "X-Platform-Fee-Rate": "0.025",
    },
  });
}

/**
 * POST /api/marketplace/x402
 * Settles an x402 payment token and mints the scoped capability grant.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { dealId, payer, payee, amount, paymentToken } = body;

    const result = await globalSubagentDispatcher.dispatch({
      role: "PaymentManager",
      action: "settle",
      payload: { dealId, payer, payee, amount, paymentToken },
      heldCapabilities: ["x402:settle"],
    });

    if (result.status === "denied") {
      return NextResponse.json(
        { error: result.reason, role: result.role },
        { status: 403 }
      );
    }

    return NextResponse.json(result.output, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
