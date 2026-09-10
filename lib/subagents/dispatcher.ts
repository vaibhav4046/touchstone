import { randomUUID } from "node:crypto";
import type { Address } from "@aicoo/sharedos";
import { ProductListerAgent } from "./roles/product-lister";
import { PriceNegotiatorAgent } from "./roles/price-negotiator";
import { PaymentManagerAgent } from "./roles/payment-manager";
import { MarketplaceAuditorAgent } from "./roles/marketplace-auditor";
import type { AgentMessage, SubagentRole, SubagentTurnResult } from "./types";
import type { FeeConfig, X402PaymentReceipt } from "../market/x402";

export function subagentAddress(role: SubagentRole): Address {
  return {
    kind: "agent",
    agentId: `subagent-${role.toLowerCase()}`,
  };
}

export interface OrchestratedDealResult {
  readonly dealId: string;
  readonly listing: Record<string, unknown>;
  readonly negotiation: Record<string, unknown>;
  readonly payment: X402PaymentReceipt;
  readonly audit: Record<string, unknown>;
  readonly turnsTaken: number;
}

export class SubagentDispatcher {
  public readonly lister = new ProductListerAgent();
  public readonly negotiator = new PriceNegotiatorAgent();
  public readonly payment = new PaymentManagerAgent();
  public readonly auditor = new MarketplaceAuditorAgent();

  /**
   * Route an action to a specific subagent with SharedOS capability validation.
   */
  async dispatch(params: {
    readonly role: SubagentRole;
    readonly action: string;
    readonly payload: Record<string, unknown>;
    readonly heldCapabilities: readonly string[];
    readonly feeConfig?: FeeConfig;
  }): Promise<SubagentTurnResult> {
    const { role, action, payload, heldCapabilities, feeConfig } = params;

    switch (role) {
      case "ProductLister":
        return this.lister.execute({
          action: action as any,
          payload,
          heldCapabilities,
        });

      case "PriceNegotiator":
        return this.negotiator.execute({
          action: action as any,
          payload,
          heldCapabilities,
        });

      case "PaymentManager":
        return this.payment.execute({
          action: action as any,
          payload,
          heldCapabilities,
          feeConfig,
        });

      case "MarketplaceAuditor":
        return this.auditor.execute({
          action: action as any,
          payload,
          heldCapabilities,
        });

      default:
        return {
          status: "denied",
          role,
          action,
          reason: `unknown_role: subagent role '${role}' does not exist in Yuzu marketplace`,
          turnsUsed: 0,
          maxTurns: 1,
        };
    }
  }

  /**
   * Execute an end-to-end multi-agent deal lifecycle across all 4 subagents under SharedOS governance.
   */
  async runFullDealFlow(params: {
    readonly buyerId: string;
    readonly sellerSlug: string;
    readonly capability: string;
    readonly buyerBudget: number;
    readonly sellerAsking: number;
    readonly satisfactionScore?: number;
    readonly feeConfig?: FeeConfig;
  }): Promise<OrchestratedDealResult> {
    const dealId = `deal_${randomUUID().slice(0, 10)}`;
    let turnsTaken = 0;

    // Turn 1: ProductLister searches and verifies the catalog entry
    const listRes = await this.lister.execute({
      action: "search",
      payload: { capability: params.capability, maxPrice: params.buyerBudget * 1.5 },
      heldCapabilities: ["market.registry:read"],
    });
    turnsTaken += listRes.turnsUsed;

    // Turn 2: PriceNegotiator calculates arithmetic settlement
    const negRes = await this.negotiator.execute({
      action: "negotiate",
      payload: {
        buyerBudget: params.buyerBudget,
        sellerAsking: params.sellerAsking,
      },
      heldCapabilities: ["broker.quote:compute"],
    });
    turnsTaken += negRes.turnsUsed;

    const negOutput = negRes.output as any;
    const finalPrice = negOutput?.settled ? negOutput.finalPrice : params.buyerBudget;

    // Turn 3: PaymentManager mints x402 challenge & settles
    const challengeRes = await this.payment.execute({
      action: "challenge",
      payload: { dealId, payee: params.sellerSlug, amount: finalPrice },
      heldCapabilities: ["sharedos.grants:consume"],
      feeConfig: params.feeConfig,
    });
    turnsTaken += challengeRes.turnsUsed;

    const token = (challengeRes.output as any)?.paymentToken ?? "x402_dummy";
    const settleRes = await this.payment.execute({
      action: "settle",
      payload: {
        dealId,
        payer: params.buyerId,
        payee: params.sellerSlug,
        amount: finalPrice,
        paymentToken: token,
      },
      heldCapabilities: ["x402:settle"],
      feeConfig: params.feeConfig,
    });
    turnsTaken += settleRes.turnsUsed;
    const paymentReceipt = settleRes.output as X402PaymentReceipt;

    // Turn 4: MarketplaceAuditor verifies receipt and commits to immutable ledger
    const verifyRes = await this.auditor.execute({
      action: "verify",
      payload: { receipt: paymentReceipt },
      heldCapabilities: ["ed25519:verify"],
    });
    turnsTaken += verifyRes.turnsUsed;

    const auditRes = await this.auditor.execute({
      action: "record",
      payload: {
        dealId,
        receipt: paymentReceipt,
        satisfactionScore: params.satisfactionScore ?? 5,
      },
      heldCapabilities: ["sharedos.audit:append"],
    });
    turnsTaken += auditRes.turnsUsed;

    return {
      dealId,
      listing: listRes.output as Record<string, unknown>,
      negotiation: negRes.output as Record<string, unknown>,
      payment: paymentReceipt,
      audit: auditRes.output as Record<string, unknown>,
      turnsTaken,
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __touchstoneSubagentDispatcher: SubagentDispatcher | undefined;
}

export const globalSubagentDispatcher: SubagentDispatcher =
  (globalThis.__touchstoneSubagentDispatcher ??= new SubagentDispatcher());
