import { AgentMemory } from "../memory";
import type { SubagentConfig, SubagentTurnResult } from "../types";

export const PRICE_NEGOTIATOR_CONFIG: SubagentConfig = {
  role: "PriceNegotiator",
  name: "Yuzu Arithmetic Price Negotiator",
  description: "Settles agent-to-agent contracts through bounded arithmetic bargaining. Strictly forbidden from accessing payment credentials or grant minting.",
  allowedCapabilities: [
    "broker.assay:evaluate",
    "broker.quote:compute",
  ],
  maxTurns: 3, // Bounded at 3 rounds max
};

export interface NegotiationBargainStep {
  readonly round: number;
  readonly buyerOffer: number;
  readonly sellerCounter: number;
  readonly spread: number;
}

export class PriceNegotiatorAgent {
  public readonly config = PRICE_NEGOTIATOR_CONFIG;
  public readonly memory: AgentMemory;

  constructor() {
    this.memory = new AgentMemory(this.config.role);
  }

  async execute(params: {
    readonly action: "negotiate" | "quote" | "unauthorized_payment";
    readonly payload: Record<string, unknown>;
    readonly heldCapabilities: readonly string[];
  }): Promise<SubagentTurnResult> {
    const { action, payload, heldCapabilities } = params;

    // Gate 1: Check if action is outside role bounds
    if (action === "unauthorized_payment") {
      this.memory.log("warn", "Blocked attempt to invoke payment from PriceNegotiator");
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: "capability_denied: PriceNegotiator is strictly forbidden from financial minting or payment disbursement",
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 2: Enforce capability grant check
    const requiredCap = action === "negotiate" ? "broker.quote:compute" : "broker.assay:evaluate";
    if (!heldCapabilities.includes(requiredCap)) {
      this.memory.log("warn", `Missing capability ${requiredCap}`);
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: `permission_denied: capability '${requiredCap}' not held by PriceNegotiator`,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 3: Bounded arithmetic execution
    try {
      if (action === "negotiate") {
        const buyerBudget = Math.max(1, Number(payload.buyerBudget ?? 10));
        const sellerAsking = Math.max(1, Number(payload.sellerAsking ?? 15));
        const sellerFloor = Math.max(1, Number(payload.sellerFloor ?? Math.min(sellerAsking * 0.7, buyerBudget)));

        // If seller asks less than or equal to budget, immediate deal at ask
        if (sellerAsking <= buyerBudget) {
          this.memory.log("info", `Immediate settlement: asking price ${sellerAsking} <= budget ${buyerBudget}`);
          return {
            status: "completed",
            role: this.config.role,
            action,
            output: {
              settled: true,
              finalPrice: sellerAsking,
              rounds: 1,
              savings: 0,
              history: [{ round: 1, buyerOffer: sellerAsking, sellerCounter: sellerAsking, spread: 0 }],
            },
            turnsUsed: 1,
            maxTurns: this.config.maxTurns,
          };
        }

        // Bounded multi-turn arithmetic convergence
        const history: NegotiationBargainStep[] = [];
        let currentOffer = Math.min(buyerBudget, sellerFloor);
        let currentCounter = sellerAsking;
        let settledPrice = 0;
        let settled = false;

        const maxRounds = Math.min(3, this.config.maxTurns);
        for (let round = 1; round <= maxRounds; round++) {
          const spread = currentCounter - currentOffer;
          history.push({ round, buyerOffer: Math.round(currentOffer * 10) / 10, sellerCounter: Math.round(currentCounter * 10) / 10, spread: Math.round(spread * 10) / 10 });

          if (spread <= 1.0 || currentCounter <= buyerBudget) {
            settledPrice = Math.min(buyerBudget, currentCounter);
            settled = true;
            break;
          }

          // Step towards middle
          const concession = spread * 0.5;
          currentCounter = Math.max(sellerFloor, currentCounter - concession);
          currentOffer = Math.min(buyerBudget, currentOffer + concession * 0.5);

          // On final round, if seller floor allows meeting the budget, close the gap
          if (round === maxRounds && currentCounter > buyerBudget && sellerFloor <= buyerBudget) {
            currentCounter = buyerBudget;
          }

          if (currentCounter <= buyerBudget) {
            settledPrice = Math.round(currentCounter * 10) / 10;
            settled = true;
            break;
          }
        }

        if (!settled) {
          // If seller cannot reach buyer budget, fail closed
          if (currentCounter > buyerBudget) {
            this.memory.log("warn", `Negotiation unfilled: seller counter ${currentCounter} exceeds budget ${buyerBudget}`);
            return {
              status: "completed",
              role: this.config.role,
              action,
              output: {
                settled: false,
                reason: "budget_exceeded: seller floor exceeds buyer maximum budget",
                rounds: maxRounds,
                history,
              },
              turnsUsed: maxRounds,
              maxTurns: this.config.maxTurns,
            };
          }
          settledPrice = Math.min(buyerBudget, Math.max(sellerFloor, Math.round(currentCounter * 10) / 10));
          settled = true;
        }

        this.memory.log("info", `Negotiation completed at ${settledPrice} credits over ${history.length} rounds`);

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: {
            settled: true,
            finalPrice: settledPrice,
            rounds: history.length,
            buyerBudget,
            sellerAsking,
            sellerFloor,
            history,
          },
          turnsUsed: history.length,
          maxTurns: this.config.maxTurns,
        };
      }

      if (action === "quote") {
        const baseRate = Number(payload.baseRate ?? 5);
        const complexity = String(payload.complexity ?? "standard");
        const multiplier = complexity === "complex" ? 1.8 : complexity === "simple" ? 0.8 : 1.0;
        const quote = Math.round(baseRate * multiplier);

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: { quote, baseRate, multiplier },
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
