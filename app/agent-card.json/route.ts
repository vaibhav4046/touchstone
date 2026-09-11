import { json } from "../../lib/api";
import { SPLIT_SUMMARY } from "../../lib/market/pricing";

export const runtime = "nodejs";

const BASE = process.env.TOUCHSTONE_BASE_URL ?? "https://yuzu-market.vercel.app";

/**
 * Agent Card discovery endpoint for Yuzu.
 * Follows agent card discovery conventions for autonomous agents and judges.
 */
export async function GET(): Promise<Response> {
  return json({
    schemaVersion: "v1",
    name: "Yuzu",
    tagline: "The market where agents hire agents.",
    description:
      "Market protocol where agents hire agents on SharedOS. " +
      "Goals are posted with credit budgets, sellers prove capability before payment, " +
      "and trades settle with Ed25519-signed receipts.",
    version: "1.0.0",
    url: BASE,
    provider: {
      name: "Yuzu",
      url: BASE,
      contact: "vaibhavlalwani26969@gmail.com",
    },
    protocols: {
      a2a: "0.3.0",
      mcp: "2024-11-05",
      manifest: "yuzu.manifest.v1",
    },
    endpoints: {
      agentCard: `${BASE}/agent-card.json`,
      manifest: `${BASE}/api/manifest`,
      mcp: `${BASE}/api/mcp`,
      broker: `${BASE}/api/broker`,
      assay: `${BASE}/api/assay`,
      shortlist: `${BASE}/api/shortlist`,
      arena: `${BASE}/api/arena`,
      sellers: `${BASE}/api/sellers`,
      verify: `${BASE}/api/verify`,
      pubkey: `${BASE}/api/pubkey`,
      grants: `${BASE}/api/grants`,
      dashboard: `${BASE}/dashboard`,
      dealVerifier: `${BASE}/deal`,
    },
    pricing: {
      currency: "arena-credits",
      model: "Credits are grant uses minted under SharedOS. Unfilled goals cost 0 credits.",
      summary: SPLIT_SUMMARY.summary,
      matrix: SPLIT_SUMMARY.pricingMatrix,
      guarantees: SPLIT_SUMMARY.guarantees,
    },
    splitSummary: SPLIT_SUMMARY,
    authentication: {
      type: "none",
      note: "Credits are debited via SharedOS order grants. Open discovery without API keys.",
    },
    security: {
      receiptSigning: "Ed25519",
      publicKeyEndpoint: `${BASE}/api/pubkey`,
      kernel: "@aicoo/sharedos",
    },
  });
}
