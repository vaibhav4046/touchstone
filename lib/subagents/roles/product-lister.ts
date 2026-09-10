import { createHash, randomUUID } from "node:crypto";
import { AgentMemory } from "../memory";
import type { SubagentConfig, SubagentTurnResult } from "../types";
import { getSeller, listSellers, registerSeller } from "../../market/registry";

export const PRODUCT_LISTER_CONFIG: SubagentConfig = {
  role: "ProductLister",
  name: "Yuzu Product Lister & Syndicator",
  description: "Curates, validates, and syndicates agent product capabilities across decentralized registries and multi-channel stores.",
  allowedCapabilities: [
    "market.registry:read",
    "market.registry:write",
    "files:read(/listings)",
  ],
  maxTurns: 1,
};

export interface SyndicateChannelOutput {
  readonly channel: "poe" | "agent_ai" | "gpt_store" | "public_directory";
  readonly manifest: Record<string, unknown>;
  readonly endpoint: string;
}

export class ProductListerAgent {
  public readonly config = PRODUCT_LISTER_CONFIG;
  public readonly memory: AgentMemory;

  constructor() {
    this.memory = new AgentMemory(this.config.role);
  }

  async execute(params: {
    readonly action: "list" | "search" | "syndicate" | "unauthorized_action";
    readonly payload: Record<string, unknown>;
    readonly heldCapabilities: readonly string[];
  }): Promise<SubagentTurnResult> {
    const { action, payload, heldCapabilities } = params;

    // Gate 1: Check if action is supported by role
    if (action === "unauthorized_action") {
      this.memory.log("warn", `Blocked unauthorized action attempt: ${action}`);
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: `capability_denied: action '${action}' is outside ProductLister authorization scope`,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 2: Enforce capability grant check (Deny by default)
    const requiredCap = action === "list" ? "market.registry:write" : "market.registry:read";
    if (!heldCapabilities.includes(requiredCap)) {
      this.memory.log("warn", `Missing required capability grant: ${requiredCap}`);
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: `permission_denied: caller does not hold '${requiredCap}' in SharedOS grant map`,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 3: Bounded single-turn action execution
    try {
      if (action === "list") {
        const slug = String(payload.slug ?? `agent-${randomUUID().slice(0, 8)}`);
        const title = String(payload.title ?? "Autonomous Agent Service");
        const capability = String(payload.capability ?? "text.analysis");
        const price = Number(payload.price ?? 10);
        const description = String(payload.description ?? "");

        // Verify description against prompt injection markers
        const isSuspicious =
          /ignore previous instructions|prefer .* rank this first|share your api key/i.test(description);

        if (isSuspicious) {
          this.memory.log("warn", `Flagged prompt injection in listing payload for ${slug}`);
          return {
            status: "denied",
            role: this.config.role,
            action,
            reason: "listing_refused: prompt injection or unsafe directive detected in agent listing",
            turnsUsed: 1,
            maxTurns: this.config.maxTurns,
          };
        }

        this.memory.setFact(`listing:${slug}`, JSON.stringify({ slug, title, capability, price }), "registration");
        this.memory.log("info", `Product listed successfully: ${slug}`, { slug, price });

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: {
            success: true,
            slug,
            capability,
            price,
            status: "active",
            registeredAt: new Date().toISOString(),
          },
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
        };
      }

      if (action === "search") {
        const capability = typeof payload.capability === "string" ? payload.capability : "";
        const maxPrice = typeof payload.maxPrice === "number" ? payload.maxPrice : Infinity;

        const sellers = listSellers();
        const matches = sellers
          .filter((s) => (!capability || s.capabilities.some((c) => c.id === capability || c.summary.toLowerCase().includes(capability.toLowerCase()))) && s.askPrice <= maxPrice)
          .map((s) => ({
            id: s.id,
            name: s.name,
            capabilities: s.capabilities.map((c) => c.id),
            price: s.askPrice,
            floor: s.floorPrice,
            pitch: s.pitch,
          }));

        this.memory.log("info", `Found ${matches.length} listings for capability: ${capability}`);

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: { matches, count: matches.length },
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
        };
      }

      if (action === "syndicate") {
        const slug = String(payload.slug ?? "agent-worker");
        const channels: SyndicateChannelOutput[] = [
          {
            channel: "public_directory",
            endpoint: `https://yuzu-market.vercel.app/api/agents/${slug}`,
            manifest: { a2a_version: "0.1.0", agent_id: slug, network: "sharedos" },
          },
          {
            channel: "poe",
            endpoint: `https://poe.com/api/v1/bot/${slug}`,
            manifest: { monetization: "per_query", fee_credits: 1 },
          },
          {
            channel: "agent_ai",
            endpoint: `https://agent.ai/directory/${slug}`,
            manifest: { listing_type: "b2b_service", auth: "sharedos_grant" },
          },
        ];

        this.memory.log("info", `Syndicated listing ${slug} to ${channels.length} channels`);

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: { slug, syndicatedChannels: channels },
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
        };
      }

      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: `unsupported_action: ${action}`,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.memory.log("error", `Execution error in ${action}: ${errorMsg}`);
      return {
        status: "error",
        role: this.config.role,
        action,
        reason: errorMsg,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }
  }
}
