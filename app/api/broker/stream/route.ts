import { after } from "next/server";
import {
  type BrokerJob,
  createBrokerJob,
  getBrokerJob,
  recordJobStage,
  runBroker,
  subscribeToJob,
} from "../../../../lib/market/broker";
import { buildContext, drainAudit, withTurn } from "../../../../lib/sharedos/host";
import { PURPOSES } from "../../../../lib/sharedos/identity";
import { admit, json, parseAmount, rateLimited, resolveBuyer } from "../../../../lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The same deal, watched rather than waited for.
 *
 * POST /api/broker answers with one object when the whole thing is done,
 * which is the right shape for an agent and the wrong one for a person: a deal
 * takes twenty to sixty seconds, and the argument this market makes (eight
 * stages, each one attributable) was invisible for all of it behind a spinner.
 * Same broker, same authorisation, same turn; the stages just leave as they
 * land.
 *
 * Server-sent events rather than a websocket, because this is one-way and SSE
 * survives a proxy that would eat an upgrade. x-accel-buffering: no because a
 * buffering CDN turns a live stream back into the thing it replaced.
 *
 * Supports streaming an existing asynchronous job via GET or POST with jobId,
 * or running a new streamed deal directly.
 */

function streamJob(job: BrokerJob): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };

      send("open", {
        jobId: job.jobId,
        goal: job.goal,
        budget: job.budget,
        buyerId: job.buyerId,
        status: job.status,
        at: new Date().toISOString(),
      });

      for (const stage of job.stages) {
        send("stage", stage);
      }

      if (job.status === "completed" && job.outcome) {
        const outcome = job.outcome;
        send("done", {
          jobId: job.jobId,
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
        });
        open = false;
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
        return;
      }

      if (job.status === "failed") {
        send("failed", {
          jobId: job.jobId,
          error: "broker_failed",
          message: job.error ?? "unknown",
        });
        open = false;
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
        return;
      }

      const unsubscribe = subscribeToJob(job.jobId, (event) => {
        if (!open) return;
        if (event.type === "stage") {
          send("stage", event.stage);
        } else if (event.type === "done") {
          const outcome = event.outcome;
          send("done", {
            jobId: job.jobId,
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
          });
          open = false;
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Stream already closed.
          }
        } else if (event.type === "failed") {
          send("failed", {
            jobId: job.jobId,
            error: "broker_failed",
            message: event.error,
          });
          open = false;
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Stream already closed.
          }
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return json({
      service: "broker.stream",
      method: "GET / POST",
      usage: "Provide ?jobId=... to stream an asynchronous job, or POST to start a new stream.",
    });
  }

  const job = getBrokerJob(jobId);
  if (!job) {
    return json({ error: "job_not_found", message: `Job ${jobId} not found.` }, 404);
  }

  return streamJob(job);
}

export async function POST(request: Request): Promise<Response> {
  try {
    after(async () => drainAudit());
  } catch {
    // Outside Next.js request scope, e.g. hermetic unit tests.
  }

  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  const buyerId = resolveBuyer(request);
  const raw = await request.text();

  let body: { goal?: unknown; budget?: unknown; capability?: unknown; jobId?: unknown } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = { goal: raw.trim() };
  }

  // If a jobId was provided in the body, connect to that job's stream:
  if (typeof body.jobId === "string" && body.jobId.trim().length > 0) {
    const job = getBrokerJob(body.jobId.trim());
    if (!job) {
      return json({ error: "job_not_found", message: `Job ${body.jobId} not found.` }, 404);
    }
    return streamJob(job);
  }

  const goal = typeof body.goal === "string" && body.goal.trim().length > 0 ? body.goal.trim() : undefined;
  if (goal === undefined) {
    return json({ error: "no_goal", message: 'Send {"goal":"launch my coffee brand","budget":25}.' }, 400);
  }

  const asked = parseAmount(body.budget, "budget");
  if (!asked.ok) return json(asked.problem, 400);
  const budget = asked.value ?? 25;
  const encoder = new TextEncoder();

  // Create and track a job so it can also be polled or streamed concurrently:
  const job = createBrokerJob({
    goal,
    budget,
    buyerId,
    capability: typeof body.capability === "string" ? body.capability : undefined,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };

      send("open", { jobId: job.jobId, goal, budget, buyerId, at: new Date().toISOString() });

      const context = buildContext({ buyerId, purpose: PURPOSES.broker });
      try {
        const outcome = await withTurn(context, `broker_${context.traceId}`, () =>
          runBroker({
            goal,
            budget,
            buyerId,
            traceId: context.traceId,
            jobId: job.jobId,
            capability: typeof body.capability === "string" ? body.capability : undefined,
            onStage: (event) => {
              recordJobStage(job.jobId, event);
              send("stage", event);
            },
          }),
        );

        job.status = "completed";
        job.outcome = outcome;

        send("done", {
          jobId: job.jobId,
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
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "unknown";
        job.status = "failed";
        job.error = errorMsg;

        send("failed", {
          jobId: job.jobId,
          error: "broker_failed",
          message: errorMsg,
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
