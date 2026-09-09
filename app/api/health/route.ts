import { llmAvailable, supplierHealth } from "../../../lib/assay/llm";
import { host } from "../../../lib/sharedos/host";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

/**
 * Whether the market can actually trade, and on what.
 *
 * This used to answer `ok: true` off the presence of API keys while every one
 * of those keys was being refused — Groq rate limited, OpenRouter out of
 * credit, Gemini rate limited — so an agent could read a green light, spend
 * twelve credits, and get an apology. A health check that reports what was
 * configured rather than what answered is not a health check; it is a copy of
 * the environment file.
 *
 * So the supplier lines below are derived from what the last real calls did.
 * Tracked rather than probed on purpose: probing would spend a model call per
 * check against the very account whose exhaustion it is reporting, which turns
 * the monitor into one of the causes. The cost of tracking is that a cold
 * instance has seen nothing and says `untested` rather than inventing a green
 * light.
 *
 * `fulfilment` is the field an agent should actually branch on. It answers the
 * question a buyer has before spending: if I plant a goal right now, does a
 * seller do the work, or does the house template?
 */
export async function GET(): Promise<Response> {
  const events = host().memoryAudit.recent(1);
  const suppliers = supplierHealth();
  const configured = suppliers.filter((supplier) => supplier.configured);
  const answering = configured.filter((supplier) => supplier.state === "answering");
  const refusing = configured.filter((supplier) => supplier.state === "refusing");

  const status =
    configured.length === 0 || (refusing.length > 0 && refusing.length === configured.length)
      ? "down"
      : refusing.length > 0
        ? "degraded"
        : answering.length > 0
          ? "ok"
          : "untested";

  const down = status === "down";

  return json({
    // False when no supplier will answer. The whole point of the field is that
    // it can be false.
    ok: !down,
    status,
    service: "touchstone",
    version: "1.0.0",
    kernel: "@aicoo/sharedos 0.1.0-alpha.5",
    analysis: llmAvailable() && !down ? "deterministic+classifier+model" : "deterministic",
    suppliers,
    supplierSummary: {
      configured: configured.length,
      answering: answering.map((supplier) => supplier.supplier),
      refusing: refusing.map((supplier) => `${supplier.supplier} (${supplier.lastCode ?? "unknown"})`),
      untested: configured.filter((supplier) => supplier.state === "untested").map((supplier) => supplier.supplier),
    },
    /** What a deal placed right now would actually get. */
    fulfilment: down ? "house-template" : "seller",
    fulfilmentNote: down
      ? "No model supplier is answering, so a deal placed now is fulfilled by Yuzu's own deterministic template. You get a real, structured deliverable, a real verification and a signed receipt, all labelled as house-produced rather than seller-produced, no seller's reputation moves, and you are charged nothing."
      : status === "degraded"
        ? "At least one supplier is refusing and at least one is answering. Deals still go to sellers; expect the slower failover path."
        : status === "untested"
          ? "No call has gone through this instance yet, so nothing is known about the suppliers beyond their keys being present."
          : "Sellers are doing the work.",
    // Still reported for the same reason as before: naming only the last
    // supplier made a three-supplier chain look like a single point of failure.
    analystSuppliers: configured.map((supplier) => supplier.model),
    /** No substitute at any position: it is a measurement, not an opinion. */
    classifier: process.env.GROQ_API_KEY ? "groq/llama-prompt-guard-2-86m" : "unavailable",
    // Derived from what the last batch actually did, not from whether a key is
    // set. A key was set in production and every batch came back 401 with a
    // revoked project key, while this field cheerfully said "enabled".
    auditShipping: host().cloudAudit.state(),
    lastDecisionAt: events[0]?.at ?? null,
    now: new Date().toISOString(),
  });
}
