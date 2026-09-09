import { after } from "next/server";
import { runBroker } from "../../../../lib/market/broker";
import { buildContext, drainAudit, withTurn } from "../../../../lib/sharedos/host";
import { PURPOSES } from "../../../../lib/sharedos/identity";
import { admit, json, parseAmount, rateLimited, resolveBuyer } from "../../../../lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The same deal, watched rather than waited for.
 *
 * `POST /api/broker` answers with one object when the whole thing is done,
 * which is the right shape for an agent and the wrong one for a person: a deal
 * takes twenty to sixty seconds, and the argument this market makes — eight
 * stages, each one attributable — was invisible for all of it behind a spinner.
 * Same broker, same authorisation, same turn; the stages just leave as they
 * land.
 *
 * Server-sent events rather than a websocket, because this is one-way and SSE
 * survives a proxy that would eat an upgrade. `x-accel-buffering: no` because a
 * buffering CDN turns a live stream back into the thing it replaced.
 */
export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

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
    return json({ error: "no_goal", message: 'Send {"goal":"launch my coffee brand","budget":25}.' }, 400);
  }

  // A budget the caller did not authorise must never be invented. "twenty",
  // -40 and 0 were all silently becoming 25 and then being spent against.
  const asked = parseAmount(body.budget, "budget");
  if (!asked.ok) return json(asked.problem, 400);
  const budget = asked.value ?? 25;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client vanished mid-write. Stop trying, let the deal finish.
          open = false;
        }
      };

      // Something has to go down the wire before the first model call, or a
      // proxy holds the connection open with nothing in it and the page cannot
      // tell "starting" from "hung".
      send("open", { goal, budget, buyerId, at: new Date().toISOString() });

      const context = buildContext({ buyerId, purpose: PURPOSES.broker });
      try {
        const outcome = await withTurn(context, `broker_${context.traceId}`, () =>
          runBroker({
            goal,
            budget,
            buyerId,
            traceId: context.traceId,
            capability: typeof body.capability === "string" ? body.capability : undefined,
            onStage: (event) => send("stage", event),
          }),
        );

        send("done", {
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
        // A failed deal is still a result. The page has been showing stages for
        // half a minute and must not simply stop.
        send("failed", {
          error: "broker_failed",
          message: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by the client hanging up.
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
