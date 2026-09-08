import { host } from "../../../lib/sharedos/host";
import { subscribeEscalations } from "../../../lib/sharedos/escalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The console's view of the kernel.
 *
 * Decisions are pushed as they happen rather than polled, because the point of
 * watching a permission system is seeing the refusal land at the moment the
 * call is made.
 */
export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client vanished mid-write. Nothing to recover.
        }
      };

      for (const event of host().memoryAudit.recent(40)) send("decision", event);

      const unsubscribeAudit = host().memoryAudit.subscribe((event) => send("decision", event));
      const unsubscribeEscalation = subscribeEscalations((escalation) =>
        send("escalation", {
          id: escalation.id,
          state: escalation.state,
          action: escalation.action,
          resource: `assay/${escalation.resourcePath.join("/")}`,
          reason: escalation.reason,
          buyerId: escalation.buyerId,
        }),
      );

      const heartbeat = setInterval(() => send("ping", { at: new Date().toISOString() }), 20_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribeAudit();
        unsubscribeEscalation();
        try {
          controller.close();
        } catch {
          // Already closed.
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
