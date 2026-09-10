import { NextResponse } from "next/server";
import { globalSubagentDispatcher } from "@/lib/subagents/dispatcher";
import { globalMarketplaceLedger } from "@/lib/market/x402";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") ?? "summary";

  const kpis = globalMarketplaceLedger.getKPIs();
  const integrity = globalMarketplaceLedger.verifyIntegrity();

  if (mode === "entries") {
    const entries = globalMarketplaceLedger.getEntries(50);
    return NextResponse.json({ kpis, integrity, entries });
  }

  return NextResponse.json({
    kpis,
    integrity,
    latestEntries: globalMarketplaceLedger.getEntries(5),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { receipt, satisfactionScore } = body;

    // Verify receipt first via MarketplaceAuditor
    const verifyResult = await globalSubagentDispatcher.dispatch({
      role: "MarketplaceAuditor",
      action: "verify",
      payload: { receipt },
      heldCapabilities: ["ed25519:verify"],
    });

    if (verifyResult.output && !(verifyResult.output as any).valid) {
      return NextResponse.json(
        { error: "tampering_detected", details: verifyResult.output },
        { status: 400 }
      );
    }

    // Commit to immutable ledger
    const recordResult = await globalSubagentDispatcher.dispatch({
      role: "MarketplaceAuditor",
      action: "record",
      payload: {
        dealId: receipt.dealId,
        receipt,
        satisfactionScore,
      },
      heldCapabilities: ["sharedos.audit:append"],
    });

    return NextResponse.json({
      verified: true,
      ledgerEntry: recordResult.output,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
