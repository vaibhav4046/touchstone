import { randomUUID } from "node:crypto";
import { AgentMemory } from "../memory";
import type { SubagentConfig, SubagentTurnResult } from "../types";
import {
  createPaymentChallenge,
  mintPaymentReceipt,
  type FeeConfig,
  type X402PaymentChallenge,
  type X402PaymentReceipt,
} from "../../market/x402";

export const PAYMENT_MANAGER_CONFIG: SubagentConfig = {
  role: "PaymentManager",
  name: "Yuzu x402 Micropayment & Grant Settlement Manager",
  description: "Enforces financial limits, validates x402 payment tokens, mints capability-scoped job grants, and collects marketplace platform fees.",
  allowedCapabilities: [
    "sharedos.grants:mint",
    "sharedos.grants:consume",
    "x402:settle",
  ],
  maxTurns: 1,
};

export class PaymentManagerAgent {
  public readonly config = PAYMENT_MANAGER_CONFIG;
  public readonly memory: AgentMemory;

  constructor() {
    this.memory = new AgentMemory(this.config.role);
  }

  async execute(params: {
    readonly action: "challenge" | "settle" | "unauthorized_listing";
    readonly payload: Record<string, unknown>;
    readonly heldCapabilities: readonly string[];
    readonly feeConfig?: FeeConfig;
  }): Promise<SubagentTurnResult> {
    const { action, payload, heldCapabilities, feeConfig } = params;

    // Gate 1: Scope check
    if (action === "unauthorized_listing") {
      this.memory.log("warn", "Blocked PaymentManager attempt to modify catalog");
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: "capability_denied: PaymentManager cannot alter catalog listings or modify registry",
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 2: Grant check
    const requiredCap = action === "challenge" ? "sharedos.grants:consume" : "x402:settle";
    if (!heldCapabilities.includes(requiredCap)) {
      this.memory.log("warn", `Missing capability grant: ${requiredCap}`);
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: `permission_denied: caller does not hold '${requiredCap}' in SharedOS grant map`,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 3: Payment action
    try {
      if (action === "challenge") {
        const dealId = String(payload.dealId ?? `deal_${randomUUID().slice(0, 8)}`);
        const payee = String(payload.payee ?? "agent-seller");
        const amount = Math.max(1, Number(payload.amount ?? 5));

        const challenge = createPaymentChallenge({
          dealId,
          payee,
          amount,
          feeConfig,
        });

        this.memory.log("info", `Issued x402 challenge for deal ${dealId}`, { amount, fee: challenge.platformFee });

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: challenge,
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
        };
      }

      if (action === "settle") {
        const dealId = String(payload.dealId ?? `deal_${randomUUID().slice(0, 8)}`);
        const payer = String(payload.payer ?? "agent-buyer");
        const payee = String(payload.payee ?? "agent-seller");
        const amount = Math.max(1, Number(payload.amount ?? 5));
        const paymentToken = String(payload.paymentToken ?? "");

        if (!paymentToken.startsWith("x402_")) {
          return {
            status: "denied",
            role: this.config.role,
            action,
            reason: "invalid_token: paymentToken format invalid or expired",
            turnsUsed: 1,
            maxTurns: this.config.maxTurns,
          };
        }

        const grantId = `grant_${dealId}`;
        const receipt = mintPaymentReceipt({
          dealId,
          payer,
          payee,
          grossAmount: amount,
          grantId,
          feeConfig,
        });

        this.memory.setFact(`payment:${dealId}`, JSON.stringify({ amount, receiptId: receipt.receiptId }), "settlement");
        this.memory.log("audit", `Payment settled for deal ${dealId}: net=${receipt.netAmount}, fee=${receipt.platformFee}`);

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: receipt,
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
          auditReceipt: {
            id: receipt.receiptId,
            timestamp: receipt.settledAt,
            hash: receipt.hash,
          },
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
