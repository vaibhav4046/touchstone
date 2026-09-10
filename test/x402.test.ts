import { describe, it, expect, beforeEach } from "vitest";
import {
  createPaymentChallenge,
  mintPaymentReceipt,
  hashReceipt,
  ImmutableLedger,
  DEFAULT_FEE_CONFIG,
} from "../lib/market/x402";

describe("x402 Token Micropayments & Immutable Ledger", () => {
  describe("x402 Micropayment Mechanics", () => {
    it("creates a payment challenge with default 2.5% platform fee", () => {
      const challenge = createPaymentChallenge({
        dealId: "deal_101",
        payee: "seller_alice",
        amount: 200,
      });

      expect(challenge.version).toBe("x402.v1");
      expect(challenge.grossAmount).toBe(200);
      expect(challenge.platformFee).toBe(5); // 200 * 0.025
      expect(challenge.netAmount).toBe(195);
      expect(challenge.paymentToken).toMatch(/^x402_[a-f0-9]{32}$/);
    });

    it("supports custom fee configuration (fixed fee + commission)", () => {
      const challenge = createPaymentChallenge({
        dealId: "deal_custom_fee",
        payee: "seller_bob",
        amount: 100,
        feeConfig: { commissionRate: 0.05, fixedFee: 2 }, // 5% + 2 credits
      });

      expect(challenge.platformFee).toBe(7); // 5 + 2
      expect(challenge.netAmount).toBe(93);
    });

    it("mints verifiable payment receipt with SHA-256 hash", () => {
      const receipt = mintPaymentReceipt({
        dealId: "deal_202",
        payer: "buyer_charlie",
        payee: "seller_alice",
        grossAmount: 80,
        grantId: "grant_deal_202",
      });

      expect(receipt.version).toBe("x402.receipt.v1");
      expect(receipt.hash).toBeDefined();
      expect(receipt.signature).toBeDefined();

      const expectedHash = hashReceipt(receipt);
      expect(receipt.hash).toBe(expectedHash);
    });
  });

  describe("Immutable Ledger Integrity", () => {
    let ledger: ImmutableLedger;

    beforeEach(() => {
      ledger = new ImmutableLedger();
    });

    it("appends blocks with valid sequence numbers and previous hash chaining", () => {
      const receipt1 = mintPaymentReceipt({
        dealId: "deal_1",
        payer: "buyer_1",
        payee: "seller_1",
        grossAmount: 10,
        grantId: "grant_1",
      });
      const receipt2 = mintPaymentReceipt({
        dealId: "deal_2",
        payer: "buyer_2",
        payee: "seller_2",
        grossAmount: 20,
        grantId: "grant_2",
      });

      const entry1 = ledger.append({ dealId: "deal_1", receipt: receipt1 });
      const entry2 = ledger.append({ dealId: "deal_2", receipt: receipt2 });

      expect(entry1.sequence).toBe(1);
      expect(entry1.prevHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
      expect(entry2.sequence).toBe(2);
      expect(entry2.prevHash).toBe(entry1.hash);

      const check = ledger.verifyIntegrity();
      expect(check.valid).toBe(true);
    });

    it("detects tampering when an internal block hash is corrupted", () => {
      const receipt1 = mintPaymentReceipt({
        dealId: "deal_legit_1",
        payer: "buyer_1",
        payee: "seller_1",
        grossAmount: 50,
        grantId: "grant_legit_1",
      });
      ledger.append({ dealId: "deal_legit_1", receipt: receipt1 });

      // Simulate malicious database mutation
      const entries = (ledger as any).entries;
      entries[0].hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

      const check = ledger.verifyIntegrity();
      expect(check.valid).toBe(false);
      expect(check.error).toContain("Hash mismatch");
    });

    it("calculates real-time marketplace KPIs accurately", () => {
      const receipt1 = mintPaymentReceipt({
        dealId: "deal_kpi_1",
        payer: "buyer_1",
        payee: "seller_1",
        grossAmount: 100,
        grantId: "grant_kpi_1",
      });
      const receipt2 = mintPaymentReceipt({
        dealId: "deal_kpi_2",
        payer: "buyer_2",
        payee: "seller_2",
        grossAmount: 50,
        grantId: "grant_kpi_2",
      });

      ledger.append({ dealId: "deal_kpi_1", receipt: receipt1, satisfactionScore: 5 });
      ledger.append({ dealId: "deal_kpi_2", receipt: receipt2, satisfactionScore: 4 });

      const kpis = ledger.getKPIs();
      expect(kpis.totalTransactions).toBe(2);
      expect(kpis.completedTransactions).toBe(2);
      expect(kpis.completionRate).toBe(100);
      expect(kpis.totalCreditsSettled).toBe(150);
      expect(kpis.totalPlatformFees).toBe(3.75); // (100 + 50) * 0.025
      expect(kpis.averageAgentSatisfaction).toBe(4.5);
      expect(kpis.ledgerIntegrityValid).toBe(true);
    });
  });
});
