import { after } from "next/server";
import { getBrokerJob, runBroker, startBrokerJob } from "../../../lib/market/broker";
import { listSellers, allReputations } from "../../../lib/market/registry";
import { buildContext, drainAudit, withTurn } from "../../../lib/sharedos/host";
import { PURPOSES } from "../../../lib/sharedos/identity";
import { admit, json, parseAmount, rateLimited, resolveBuyer } from "../../../lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Plant a goal and a budget. Get the finished work and the receipt.
 *
 * One call runs the whole protocol (discover, bid, prove, negotiate, contract,
 * execute, verify, settle) and the timeline it returns is the story of the
 * deal, not a progress bar. An unfilled goal is a normal outcome and comes back
 * with the reason, because a market that always finds a seller is one that is
 * not really choosing.
 *
 * Supports asynchronous job execution: pass async: true in the request body
 * or header Prefer: respond-async to receive 202 Accepted with a structured
 * job descriptor, then poll via pollUrl or stream via streamUrl.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    after(async () => drainAudit());
  } catch {
    // Outside Next.js request scope, e.g. hermetic unit tests.
  }

  // Before the body is read, because reading it calls a model.
  //
  // This route had no admission at all while every other billable one did,
  // and it is the most expensive: one call fans out an assay per bidder, a
  // challenge per shortlisted seller, a delivery and a verification. CORS is
  // open on /api/* by design, so any page could have fired this from every
  // visitor it had, against our own funded keys.
  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  const buyerId = resolveBuyer(request);
  const raw = await request.text();

  let body: { goal?: unknown; budget?: unknown; capability?: unknown; async?: unknown } = {};
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
        message: 'Send {"goal":"launch my coffee brand","budget":25}, or just the sentence as text/plain.',
      },
      400,
    );
  }

  // A budget the caller did not authorise must never be invented. "twenty",
  // -40 and 0 were all silently becoming 25 and then being spent against.
  const asked = parseAmount(body.budget, "budget");
  if (!asked.ok) return json(asked.problem, 400);
  const budget = asked.value ?? 25;

  // Asynchronous job execution check:
  // When a buyer or agent submits with async: true or header Prefer: respond-async,
  // return 202 Accepted with a structured job descriptor.
  const preferHeader = request.headers.get("prefer") ?? "";
  const preferAsync = /respond-async/i.test(preferHeader);
  const bodyAsync = body.async === true || body.async === "true";
  const isAsync = preferAsync || bodyAsync;

  if (isAsync) {
    const descriptor = startBrokerJob({
      goal,
      budget,
      buyerId,
      capability: typeof body.capability === "string" ? body.capability : undefined,
    });

    return json(
      {
        jobId: descriptor.jobId,
        status: descriptor.status,
        etaSeconds: descriptor.etaSeconds,
        pollUrl: descriptor.pollUrl,
        streamUrl: descriptor.streamUrl,
      },
      202,
      {
        location: descriptor.pollUrl,
        "preference-applied": "respond-async",
      },
    );
  }

  // Synchronous execution:
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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (jobId) {
    const job = getBrokerJob(jobId);
    if (!job) {
      return json({ error: "job_not_found", message: `Job ${jobId} was not found.` }, 404);
    }

    if (job.status === "completed" && job.outcome) {
      const outcome = job.outcome;
      return json({
        jobId: job.jobId,
        status: "completed",
        etaSeconds: 0,
        pollUrl: `/api/broker?jobId=${job.jobId}`,
        streamUrl: "/api/broker/stream",
        goal: job.goal,
        budget: job.budget,
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
        meta: { elapsedMs: outcome.elapsedMs, buyerId: job.buyerId },
        result: {
          filled: outcome.contract !== undefined && outcome.settlement !== undefined,
          unfilled: outcome.unfilled,
          rfp: outcome.rfp,
          bids: outcome.bids,
          proofs: outcome.proofs,
          negotiation: outcome.negotiation,
          contract: outcome.contract,
          delivery: outcome.delivery,
          verification: outcome.verification,
          settlement: outcome.settlement,
          timeline: outcome.timeline,
          receipt: outcome.receipt,
          meta: { elapsedMs: outcome.elapsedMs, buyerId: job.buyerId },
        },
      });
    }

    if (job.status === "failed") {
      return json(
        {
          jobId: job.jobId,
          status: "failed",
          etaSeconds: 0,
          pollUrl: `/api/broker?jobId=${job.jobId}`,
          streamUrl: "/api/broker/stream",
          error: job.error ?? "broker_failed",
          timeline: job.stages,
        },
        500,
      );
    }

    const elapsed = (Date.now() - job.createdAt) / 1000;
    const etaRemaining = Math.max(1, Math.round(job.etaSeconds - elapsed));
    return json({
      jobId: job.jobId,
      status: "queued",
      etaSeconds: etaRemaining,
      pollUrl: `/api/broker?jobId=${job.jobId}`,
      streamUrl: "/api/broker/stream",
      timeline: job.stages,
    });
  }

  return json({
    service: "broker",
    method: "POST",
    price: { amount: 12, currency: "arena-credits", note: "Covers the whole run. What the seller charges comes out of the budget you set." },
    body: { goal: "string", budget: "number, Arena credits", capability: "string, optional", async: "boolean, optional" },
    headers: { Prefer: "respond-async (optional, returns 202 Accepted with job descriptor)" },
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
