import { describe, expect, it, beforeEach } from "vitest";
import { ledger, record, resetLedger, restore, spendRecord } from "../lib/arena/ledger";

/**
 * The claim under test: the Arena tally survives the process that produced it.
 *
 * The ledger lives in one Node instance and Vercel runs many, so the spend a
 * judge is asked to check is invisible from any other instance and gone on a
 * cold start. There is no database here and adding one would contradict the
 * rest of the design, so the durability is the same one receipts use: each
 * purchase yields a signed, self-contained record, and any instance rebuilds
 * the whole ledger from a pile of them.
 *
 * The three things that have to hold for that to be worth anything: a rebuild
 * reproduces the original exactly, replaying a record cannot inflate the
 * spend, and a record altered by so much as one credit stops verifying.
 */

const BOUGHT = {
  seller: "renderkit",
  sellerName: "RenderKit",
  credits: 36,
  bought: "One 9:16 product video, 20s, MP4 plus shot list.",
  why: "Ranked #1 at standing 74.",
  delivered: true,
} as const;

const ALSO = {
  seller: "copyforge",
  sellerName: "CopyForge",
  credits: 27,
  bought: "Three launch taglines under 8 words.",
  why: "Ranked #2 at standing 61.",
  delivered: true,
} as const;

function spendBoth(): readonly unknown[] {
  expect(record(BOUGHT).ok).toBe(true);
  expect(record(ALSO).ok).toBe(true);
  return ledger().purchases.map(spendRecord);
}

describe("the Arena ledger is portable", () => {
  beforeEach(() => resetLedger());

  it("rebuilds the same spend, sellers and purchases on a different instance", () => {
    const records = spendBoth();
    const original = ledger();

    // A cold start, or the next request landing on a different instance.
    resetLedger();
    expect(ledger().spent).toBe(0);

    const rebuilt = restore(records);
    expect(rebuilt).toEqual({ restored: 2, rejected: 0 });

    const after = ledger();
    expect(after.spent).toBe(original.spent);
    expect(after.distinctSellers).toBe(original.distinctSellers);
    expect(after.purchases).toEqual(original.purchases);
  });

  it("ignores a record it already holds, so replaying cannot inflate the spend", () => {
    const records = spendBoth();
    const before = ledger().spent;

    // Sent back on the next call, as the response tells a caller to do.
    expect(restore(records)).toEqual({ restored: 0, rejected: 0 });
    expect(ledger().spent).toBe(before);

    // And twice over, in case the caller is enthusiastic rather than honest.
    restore([...records, ...records]);
    expect(ledger().spent).toBe(before);
    expect(ledger().purchases).toHaveLength(2);
  });

  it("refuses a record whose credits were edited after signing", () => {
    const [signed] = spendBoth() as [{ payload: Record<string, unknown> }];
    resetLedger();

    const inflated = { ...signed, payload: { ...signed.payload, credits: 99 } };
    expect(restore([inflated])).toEqual({ restored: 0, rejected: 1 });
    expect(ledger().spent).toBe(0);
  });

  it("refuses anything that is not one of our spend records", () => {
    const [signed] = spendBoth() as [{ kind: string }];
    resetLedger();

    // A receipt is signed with the same key. It is still not a spend record,
    // and the kind is inside the signature so it cannot be relabelled.
    const relabelled = { ...signed, kind: "yuzu.assay.receipt.v1" };
    const result = restore([relabelled, { seller: "x", credits: 40 }, null, "40"]);

    expect(result).toEqual({ restored: 0, rejected: 4 });
    expect(ledger().spent).toBe(0);
  });
});
