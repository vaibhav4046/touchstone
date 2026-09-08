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
    auditShipping: process.env.SHAREDOS_KEY ? "enabled" : "local-only",
    lastDecisionAt: events[0]?.at ?? null,
    now: new Date().toISOString(),
  });
}
