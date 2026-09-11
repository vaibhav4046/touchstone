/**
 * Yuzu Pricing and Protocol Transparency.
 *
 * Defines explicit pricing tiers (PAID vs FREE), credit costs (3, 10, 12, 0),
 * and the splitSummary structure consumed across manifest, mcp, and agent-card.
 */

export type PricingTier = "FREE" | "PAID";

export interface ServicePricing {
  readonly tier: PricingTier;
  readonly cost: number;
  readonly amount: number;
  readonly currency: "arena-credits";
  readonly isPaid: boolean;
  readonly note: string;
}

export interface SplitItem {
  readonly name: string;
  readonly tier: PricingTier;
  readonly cost: number;
  readonly currency: "arena-credits";
  readonly endpoint?: string;
  readonly description: string;
}

export interface SplitSummary {
  readonly summary: string;
  readonly free: {
    readonly tier: "FREE";
    readonly creditCost: 0;
    readonly description: string;
    readonly services: readonly SplitItem[];
    readonly mcpTools: readonly SplitItem[];
  };
  readonly paid: {
    readonly tier: "PAID";
    readonly description: string;
    readonly services: readonly SplitItem[];
    readonly mcpTools: readonly SplitItem[];
  };
  readonly pricingMatrix: Record<string, { readonly tier: PricingTier; readonly cost: number; readonly currency: "arena-credits" }>;
  readonly guarantees: {
    readonly unfilledNoCharge: string;
    readonly sellerDeductedFromBudget: string;
    readonly freeAuditsAndVerifications: string;
  };
}

export const SPLIT_SUMMARY: SplitSummary = {
  summary:
    "Yuzu splits cleanly into zero-cost discovery and verification tools plus low-cost paid execution services. " +
    "Autonomous agents can browse, assay their own registration, inspect grants, and verify receipts for 0 credits. " +
    "Brokering, vendor shortlisting, and third-party assays consume whole Arena credits under strict SharedOS order grants.",
  free: {
    tier: "FREE",
    creditCost: 0,
    description:
      "Zero credits required. Unrestricted access for autonomous discovery, registry management, grant inspection, and cryptographic verification.",
    services: [
      {
        name: "arena",
        endpoint: "/api/arena",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Round 1 competitive trials, critiques, candidate rankings, and ledger inspection.",
      },
      {
        name: "sellers",
        endpoint: "/api/sellers",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Register seller profiles, free initial listing assay, and full registry queries.",
      },
      {
        name: "verify",
        endpoint: "/api/verify",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Verify any Ed25519-signed Yuzu receipt against its contents.",
      },
      {
        name: "pubkey",
        endpoint: "/api/pubkey",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Retrieve public key and offline verification script.",
      },
      {
        name: "grants",
        endpoint: "/api/grants",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Inspect SharedOS kernel authority, reach, active grants, and precedent tables.",
      },
    ],
    mcpTools: [
      {
        name: "yuzu_verify_receipt",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Verify any Yuzu receipt offline or online using published Ed25519 key.",
      },
      {
        name: "yuzu_grant_map",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Inspect who may touch what, active grants, and kernel reach without consuming credits.",
      },
      {
        name: "yuzu_sellers",
        tier: "FREE",
        cost: 0,
        currency: "arena-credits",
        description: "Query seller registry, capabilities, floor prices, and verified reputations.",
      },
    ],
  },
  paid: {
    tier: "PAID",
    description:
      "Consumes whole Arena credits via SharedOS order grants. What a seller charges comes out of the user budget.",
    services: [
      {
        name: "assay",
        endpoint: "/api/assay",
        tier: "PAID",
        cost: 3,
        currency: "arena-credits",
        description: "In-depth listing analysis: checkable claims, prompt injection detection, and quoted findings.",
      },
      {
        name: "shortlist",
        endpoint: "/api/shortlist",
        tier: "PAID",
        cost: 10,
        currency: "arena-credits",
        description: "Rank up to 12 vendor listings and produce an optimal credit allocation plan with signed receipts.",
      },
      {
        name: "broker",
        endpoint: "/api/broker",
        tier: "PAID",
        cost: 12,
        currency: "arena-credits",
        description: "Full deal brokerage: capability discovery, proof challenges, negotiation, execution grant, and verification.",
      },
    ],
    mcpTools: [
      {
        name: "yuzu_assay",
        tier: "PAID",
        cost: 3,
        currency: "arena-credits",
        description: "Evaluate one agent listing before trusting it (costs 3 credits).",
      },
      {
        name: "yuzu_shortlist",
        tier: "PAID",
        cost: 10,
        currency: "arena-credits",
        description: "Rank candidate vendor listings and generate an optimal credit allocation plan (costs 10 credits).",
      },
      {
        name: "yuzu_broker",
        tier: "PAID",
        cost: 12,
        currency: "arena-credits",
        description: "Broker end-to-end deal with verified delivery and signed receipt (costs 12 credits).",
      },
    ],
  },
  pricingMatrix: {
    "/api/broker": { tier: "PAID", cost: 12, currency: "arena-credits" },
    "/api/assay": { tier: "PAID", cost: 3, currency: "arena-credits" },
    "/api/shortlist": { tier: "PAID", cost: 10, currency: "arena-credits" },
    "/api/arena": { tier: "FREE", cost: 0, currency: "arena-credits" },
    "/api/sellers": { tier: "FREE", cost: 0, currency: "arena-credits" },
    "/api/verify": { tier: "FREE", cost: 0, currency: "arena-credits" },
    "/api/pubkey": { tier: "FREE", cost: 0, currency: "arena-credits" },
    "/api/grants": { tier: "FREE", cost: 0, currency: "arena-credits" },
    yuzu_broker: { tier: "PAID", cost: 12, currency: "arena-credits" },
    yuzu_assay: { tier: "PAID", cost: 3, currency: "arena-credits" },
    yuzu_shortlist: { tier: "PAID", cost: 10, currency: "arena-credits" },
    yuzu_verify_receipt: { tier: "FREE", cost: 0, currency: "arena-credits" },
    yuzu_grant_map: { tier: "FREE", cost: 0, currency: "arena-credits" },
    yuzu_sellers: { tier: "FREE", cost: 0, currency: "arena-credits" },
  },
  guarantees: {
    unfilledNoCharge: "If a goal cannot be filled, or sellers fail verification, 0 credits are spent.",
    sellerDeductedFromBudget: "What a seller charges comes strictly out of the budget you set, never on top of it.",
    freeAuditsAndVerifications: "Receipt verification is 100% free and runnable offline via /api/pubkey.",
  },
};
