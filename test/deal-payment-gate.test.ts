import { describe, expect, it } from "vitest";
import { memoFor, verifyPayment, type LedgerTransfer } from "../lib/market/deal";

/**
 * The seller must be unreachable until the money is real, and is *this* money.
 *
 * Yuzu tells the room it verifies payment against its own ledger rather than
 * against the message announcing it. That sentence is worth nothing unless
 * failing the check stops something, so these are about the stopping.
 *
 * The forged id is the easy case and the least interesting. The attacks that
 * matter are the ones where the money genuinely moved: a real transfer replayed
 * against a different deal, and a real transfer spent twice on the same one.
 * Both look perfect on amount and recipient, and both must be refused.
 */

const DEAL = "deal_yuzu_arena_001";
const SELLER = "p_seller";
const BUYER = "p_buyer";

const expectation = (consumed: string[] = []) => ({
  dealId: DEAL,
  seller: SELLER,
  buyer: BUYER,
  price: 3,
  consumed: new Set(consumed),
});

const good: LedgerTransfer = {
  id: "txn_REAL",
  amount: 3,
  memo: memoFor(DEAL),
  state: "settled",
  from_principal_id: BUYER,
  to_principal_id: SELLER,
};

describe("a seller cannot be invoked until every payment invariant holds", () => {
  it("admits a payment that is real, correct and unspent", () => {
    const decision = verifyPayment(good, expectation());
    expect(decision.sellerMayBeInvoked).toBe(true);
    expect(decision.failed).toBeUndefined();
    expect(decision.checks.every((check) => check.held === true)).toBe(true);
  });

  it("refuses a transaction id that is not in the ledger at all", () => {
    const decision = verifyPayment(undefined, expectation());
    expect(decision.sellerMayBeInvoked).toBe(false);
    expect(decision.failed).toBe("exists");
    // The later checks are not reported as failures: we never got far enough to
    // look, and saying otherwise would overstate what was actually verified.
    expect(decision.checks.find((check) => check.invariant === "recipient")?.held).toBeUndefined();
  });

  it("refuses a real payment that was made to somebody else", () => {
    const decision = verifyPayment({ ...good, to_principal_id: "p_someone_else" }, expectation());
    expect(decision.sellerMayBeInvoked).toBe(false);
    expect(decision.failed).toBe("recipient");
  });

  it("refuses a real payment that is short of the agreed price", () => {
    const decision = verifyPayment({ ...good, amount: 2 }, expectation());
    expect(decision.sellerMayBeInvoked).toBe(false);
    expect(decision.failed).toBe("amount");
  });

  /**
   * The attack the obviously-fake id does not test. Everything about this
   * transfer is genuine -- it settled, it went to this seller, for enough money,
   * from this buyer -- and it bought a different job.
   */
  it("refuses a genuine payment replayed against a different deal", () => {
    const decision = verifyPayment({ ...good, memo: memoFor("deal_yuzu_arena_999") }, expectation());
    expect(decision.sellerMayBeInvoked).toBe(false);
    expect(decision.failed).toBe("deal_binding");
    expect(decision.checks.find((check) => check.invariant === "recipient")?.held).toBe(true);
    expect(decision.checks.find((check) => check.invariant === "amount")?.held).toBe(true);
  });

  it("refuses a payment somebody else made, quoted by an agent that did not pay", () => {
    const decision = verifyPayment({ ...good, from_principal_id: "p_freeloader" }, expectation());
    expect(decision.sellerMayBeInvoked).toBe(false);
    expect(decision.failed).toBe("payer");
  });

  /** One payment buys one job. The second run of the same id buys nothing. */
  it("refuses a payment that has already settled a deal", () => {
    const first = verifyPayment(good, expectation());
    expect(first.sellerMayBeInvoked).toBe(true);

    const second = verifyPayment(good, expectation(["txn_REAL"]));
    expect(second.sellerMayBeInvoked).toBe(false);
    expect(second.failed).toBe("not_consumed");
  });

  it("reports every invariant by name, so the refusal says which one broke", () => {
    const decision = verifyPayment({ ...good, memo: "no deal here" }, expectation());
    expect(decision.checks.map((check) => check.invariant)).toEqual([
      "exists",
      "settled",
      "recipient",
      "amount",
      "deal_binding",
      "payer",
      "not_consumed",
    ]);
    expect(decision.reason).toContain(DEAL);
  });
});
