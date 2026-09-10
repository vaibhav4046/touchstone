import { AgentMemory } from "../memory";
import type { SubagentConfig, SubagentTurnResult } from "../types";
import {
  globalMarketplaceLedger,
  hashReceipt,
  type MarketplaceKPIs,
  type X402PaymentReceipt,
} from "../../market/x402";

export const MARKETPLACE_AUDITOR_CONFIG: SubagentConfig = {
  role: "MarketplaceAuditor",
  name: "Yuzu Marketplace Auditor & Ledger Guardian",
  description: "Validates Ed25519 signatures, detects receipt tampering, records immutable hash-chained audit trails, and tracks marketplace economic health KPIs.",
  allowedCapabilities: [
    "ed25519:verify",
    "sharedos.audit:read",
    "sharedos.audit:append",
    "kpi:record",
  ],
  maxTurns: 1,
};

export class MarketplaceAuditorAgent {
  public readonly config = MARKETPLACE_AUDITOR_CONFIG;
  public readonly memory: AgentMemory;

  constructor() {
    this.memory = new AgentMemory(this.config.role);
  }

  async execute(params: {
    readonly action: "verify" | "record" | "kpi" | "unauthorized_negotiate";
    readonly payload: Record<string, unknown>;
    readonly heldCapabilities: readonly string[];
  }): Promise<SubagentTurnResult> {
    const { action, payload, heldCapabilities } = params;

    // Gate 1: Scope check
    if (action === "unauthorized_negotiate") {
      this.memory.log("warn", "Blocked MarketplaceAuditor attempt to negotiate price");
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: "capability_denied: MarketplaceAuditor is strictly read-and-verify only, cannot negotiate deals",
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 2: Capability check
    const requiredCap =
      action === "verify"
        ? "ed25519:verify"
        : action === "record"
        ? "sharedos.audit:append"
        : "sharedos.audit:read";

    if (!heldCapabilities.includes(requiredCap)) {
      this.memory.log("warn", `Missing capability: ${requiredCap}`);
      return {
        status: "denied",
        role: this.config.role,
        action,
        reason: `permission_denied: capability '${requiredCap}' not held by caller in SharedOS grant map`,
        turnsUsed: 1,
        maxTurns: this.config.maxTurns,
      };
    }

    // Gate 3: Audit action
    try {
      if (action === "verify") {
        const receipt = payload.receipt as X402PaymentReceipt | undefined;
        if (!receipt || !receipt.receiptId || !receipt.hash) {
          return {
            status: "denied",
            role: this.config.role,
            action,
            reason: "malformed_receipt: missing required cryptographic verification fields",
            turnsUsed: 1,
            maxTurns: this.config.maxTurns,
          };
        }

        const expectedHash = hashReceipt(receipt);
        const hashMatches = receipt.hash === expectedHash;

        if (!hashMatches) {
          this.memory.log("error", `TAMPERING DETECTED for receipt ${receipt.receiptId}! Hash mismatch`);
          return {
            status: "completed",
            role: this.config.role,
            action,
            output: {
              valid: false,
              tampered: true,
              receiptId: receipt.receiptId,
              expectedHash,
              actualHash: receipt.hash,
              reason: "cryptographic_tamper_detected: payload contents do not match signature hash",
            },
            turnsUsed: 1,
            maxTurns: this.config.maxTurns,
          };
        }

        this.memory.log("info", `Receipt ${receipt.receiptId} verified cleanly`);
        return {
          status: "completed",
          role: this.config.role,
          action,
          output: {
            valid: true,
            tampered: false,
            receiptId: receipt.receiptId,
            verifiedAt: new Date().toISOString(),
          },
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
        };
      }

      if (action === "record") {
        const dealId = String(payload.dealId ?? "unknown-deal");
        const receipt = payload.receipt as X402PaymentReceipt;
        const satisfactionScore = typeof payload.satisfactionScore === "number" ? payload.satisfactionScore : undefined;

        if (!receipt) {
          return {
            status: "error",
            role: this.config.role,
            action,
            reason: "missing_receipt: cannot record entry to ledger without receipt",
            turnsUsed: 1,
            maxTurns: this.config.maxTurns,
          };
        }

        const entry = globalMarketplaceLedger.append({
          dealId,
          receipt,
          satisfactionScore,
          status: "completed",
        });

        this.memory.log("audit", `Committed ledger block #${entry.sequence} for deal ${dealId}`, {
          hash: entry.hash,
          prevHash: entry.prevHash,
        });

        return {
          status: "completed",
          role: this.config.role,
          action,
          output: {
            sequence: entry.sequence,
            hash: entry.hash,
            prevHash: entry.prevHash,
            timestamp: entry.timestamp,
          },
          turnsUsed: 1,
          maxTurns: this.config.maxTurns,
        };
      }

      if (action === "kpi") {
        const kpis = globalMarketplaceLedger.getKPIs();
        return {
          status: "completed",
          role: this.config.role,
          action,
          output: kpis,
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
