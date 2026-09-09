import { after } from "next/server";
import { runBroker } from "../../../lib/market/broker";
import { listSellers, allReputations } from "../../../lib/market/registry";
import { buildContext, drainAudit, withTurn } from "../../../lib/sharedos/host";
import { PURPOSES } from "../../../lib/sharedos/identity";
import { json, resolveBuyer } from "../../../lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Plant a goal and a budget. Get the finished work and the receipt.
 *
 * One call runs the whole protocol — discover, bid, prove, negotiate, contract,
 * execute, verify, settle — and the timeline it returns is the story of the
 * deal, not a progress bar. An unfilled goal is a normal outcome and comes back
 * with the reason, because a market that always finds a seller is one that is
 * not really choosing.
 */
export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  const buyerId = resolveBuyer(request);
  const raw = await request.text();

  let body: { goal?: unknown; budget?: unknown; capability?: unknown } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = { goal: raw.trim() };
  }

  const goal = typeof body.goal === "string" && body.goal.trim().length > 0 ? body.goal.trim() : undefined;
  if (goal === undefined) {
    return json(
      {
        error: "no_goal",
        message: 'Send {"goal":"launch my coffee brand","budget":25} — or just the sentence as text/plain.',
      },
      400,
    );
  }

  const budget = typeof body.budget === "number" && Number.isFinite(body.budget) ? body.budget : 25;

  // One deal is one turn, bounded at both ends.
  //
  // Authority is frozen once at the boundary instead of being re-resolved on
  // every one of the eight stages, so a store that goes down between the proof
  // and the contract cannot change its mind halfway through a deal. And the
  // audit stream gets a terminal: without it a reader sees a run of
  // `tool.invoked` rows and has nothing but a shared traceId to say where the
  // turn stopped or whether it stopped well.
  const context = buildContext({ buyerId, purpose: PURPOSES.broker });
  const outcome = await withTurn(context, `broker_${context.traceId}`, () =>
    runBroker({
      goal,
      budget,
      buyerId,
      traceId: context.traceId,
      capability: typeof body.capability === "string" ? body.capability : undefined,
    }),
  );

  return json({
    goal,
    budget,
    filled: outcome.contract !== undefined && outcome.settlement !== undefined,
    unfilled: outcome.unfilled,
    rfp: outcome.rfp,
    bids: outcome.bids,
    proofs: outcome.proofs.map((proof) => ({ ...proof, sample: proof.sample.slice(0, 320) })),
    negotiation: outcome.negotiation,
    contract: outcome.contract,
    delivery: outcome.delivery,
    verification: outcome.verification,
    settlement: outcome.settlement,
    timeline: outcome.timeline,
    receipt: outcome.receipt,
    meta: { elapsedMs: outcome.elapsedMs, buyerId },
  });
}

export async function GET(): Promise<Response> {
  return json({
    service: "broker",
    method: "POST",
    price: { amount: 12, currency: "arena-credits", note: "Covers the whole run. What the seller charges comes out of the budget you set." },
    body: { goal: "string", budget: "number, Arena credits", capability: "string, optional" },
    returns:
      "The whole deal: bids, proof-of-capability samples, the negotiation, the contract and the grant that paid for it, the delivered work, the verification, and a signed receipt.",
    sellers: listSellers().map((seller) => ({
      id: seller.id,
      name: seller.name,
      capabilities: seller.capabilities.map((capability) => capability.id),
      ask: seller.askPrice,
    })),
    reputations: allReputations(),
  });
}
