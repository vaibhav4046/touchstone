import { llmAvailable } from "../../../lib/assay/llm";
import { host } from "../../../lib/sharedos/host";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const events = host().memoryAudit.recent(1);
  return json({
    ok: true,
    service: "touchstone",
    version: "1.0.0",
    kernel: "@aicoo/sharedos 0.1.0-alpha.5",
    analysis: llmAvailable() ? "deterministic+classifier+model" : "deterministic",
    // The whole bench, in the order it is asked. Naming only the last one made
    // a three-supplier chain look like a single point of failure.
    analystSuppliers: [
      process.env.GROQ_API_KEY ? "groq/gpt-oss-120b" : undefined,
      process.env.OPENROUTER_API_KEY ? "openrouter/gpt-oss-120b" : undefined,
      process.env.GEMINI_API_KEY ? "gemini-3.6-flash" : undefined,
    ].filter((name) => name !== undefined),
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
