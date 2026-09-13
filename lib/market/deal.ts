/**
 * The gate between a claim of payment and a seller being invoked.
 *
 * Yuzu's published position is that it verifies payment against its own ledger
 * rather than against the message announcing it. That is only worth anything if
 * failing the check actually stops something, so this is the thing that stops
 * it: `invokeSeller` is unreachable until every invariant below holds.
 *
 * They are all seven necessary and none is sufficient, and the interesting ones
 * are not the obvious ones. A forged `txn_FAKE_123` fails the first test and is
 * the easy case. The attack worth defending against is a *genuine* transfer
 * replayed against a different deal, or twice against the same one: the money
 * really moved, the recipient really is the seller, the amount really is right,
 * and it still must not buy this job. That is what `deal` and `consumed` are
 * for, and why this is a pure function with the ledger passed in -- a boundary
 * that cannot be tested cheaply is a boundary nobody checks.
 */

export interface LedgerTransfer {
  readonly id: string;
  readonly amount: number;
  readonly memo?: string | null;
  readonly state?: string;
  /** Who paid. */
  readonly from_principal_id?: string;
  /** Who was paid. */
  readonly to_principal_id?: string;
}

export interface PaymentExpectation {
  readonly dealId: string;
  readonly seller: string;
  readonly buyer: string;
  readonly price: number;
  /** Deals whose payment has already been spent. Replay is the subtle attack. */
  readonly consumed: ReadonlySet<string>;
}

export type Invariant =
  | "exists"
  | "settled"
  | "recipient"
  | "amount"
  | "deal_binding"
  | "payer"
  | "not_consumed";

export interface PaymentDecision {
  readonly ok: boolean;
  /** Every invariant, and whether it held. Printed as-is in the demo. */
  readonly checks: readonly { readonly invariant: Invariant; readonly held: boolean | undefined }[];
  readonly failed?: Invariant;
  readonly reason?: string;
  /** The only field the caller is allowed to gate on. */
  readonly sellerMayBeInvoked: boolean;
}

/** A memo binds a transfer to one deal. Anything else is a payment for something else. */
export function memoFor(dealId: string): string {
  return `yuzu:${dealId}`;
}

/**
 * Check a claimed payment against the ledger and the deal it claims to settle.
 *
 * `transfer` is what our own ledger returned for the claimed id, or undefined
 * when it returned nothing. It is passed in rather than fetched so the whole
 * boundary is testable without a network, a purse, or a single spent credit.
 *
 * Checks stop at the first failure and the rest report `undefined` rather than
 * `false`: "we never got far enough to look" and "we looked and it was wrong"
 * are different facts, and a demo that renders them the same way is lying
 * slightly in its own favour.
 */
export function verifyPayment(
  transfer: LedgerTransfer | undefined,
  expect: PaymentExpectation,
): PaymentDecision {
  const order: Invariant[] = ["exists", "settled", "recipient", "amount", "deal_binding", "payer", "not_consumed"];

  const held: Partial<Record<Invariant, boolean>> = {};
  let failed: Invariant | undefined;
  let reason: string | undefined;

  const test = (invariant: Invariant, condition: boolean, why: string): boolean => {
    if (failed !== undefined) return false;
    held[invariant] = condition;
    if (!condition) {
      failed = invariant;
      reason = why;
    }
    return condition;
  };

  test("exists", transfer !== undefined, `No transfer with that id is in our ledger.`);
  if (transfer !== undefined) {
    // An absent state is treated as settled: this ledger returns completed
    // transfers, and inventing a pending state it does not report would be
    // failing honest payments for a status that does not exist.
    test("settled", transfer.state === undefined || /settled|complete|succeed/i.test(transfer.state), `Transfer state is ${transfer.state}.`);
    test(
      "recipient",
      transfer.to_principal_id === undefined || transfer.to_principal_id === expect.seller,
      `Paid ${transfer.to_principal_id}, not the seller ${expect.seller}.`,
    );
    test("amount", transfer.amount >= expect.price, `Paid ${transfer.amount}, the agreed price is ${expect.price}.`);
    test(
      "deal_binding",
      (transfer.memo ?? "").includes(expect.dealId),
      `The memo does not name ${expect.dealId}. A real payment for another deal does not buy this one.`,
    );
    test(
      "payer",
      transfer.from_principal_id === undefined || transfer.from_principal_id === expect.buyer,
      `Paid by ${transfer.from_principal_id}, not the buyer ${expect.buyer}.`,
    );
    test("not_consumed", !expect.consumed.has(transfer.id), `That transfer already settled a deal. One payment buys one job.`);
  }

  return {
    ok: failed === undefined,
    checks: order.map((invariant) => ({ invariant, held: held[invariant] })),
    failed,
    reason,
    // Deliberately a separate field rather than `ok` reused. The caller gates on
    // this name, so the thing being decided is legible at the call site.
    sellerMayBeInvoked: failed === undefined,
  };
}
