import { describe, expect, it } from "vitest";
import { POST } from "../app/api/verify/route";
import { sign } from "../lib/assay/receipt";

/**
 * An encoding accident must not be reported as a forgery.
 *
 * A reviewer told us that receipts extracted with Python failed to verify, and
 * blamed `ensure_ascii` escaping our em dashes. That turned out to be wrong:
 * escaping changes the file's bytes and not the parsed value, and the signature
 * covers canonical JSON of the parsed receipt. Checked against Python in both
 * modes, with emoji, RTL text, floats and scientific notation — all verify.
 *
 * The near-miss underneath it is real, though. A consumer that decodes the
 * bytes with the wrong character set turns every em dash into U+FFFD, which
 * genuinely alters the receipt, and the only thing we told them was
 * `signature_mismatch` — the same words we use for a deliberate edit. The
 * signature cannot distinguish those and should not pretend to, but we can
 * notice the replacement character, because our signer never emits one.
 */
const EM = String.fromCharCode(0x2014);
const FFFD = String.fromCharCode(0xfffd);

/** A complete, genuinely signed receipt whose prose contains an em dash. */
function receiptWithEmDash() {
  const issued = new Date();
  return sign({
    version: "touchstone.receipt.v1",
    receiptId: "rcp_encoding_test",
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + 3_600_000).toISOString(),
    issuer: "touchstone",
    buyerId: "buyer-encoding",
    purpose: "touchstone.assay",
    traceId: "trace-encoding",
    report: {
      vendor: "Quill",
      verdict: "QUALIFIED",
      score: 66,
      deterministicScore: 66,
      headline: `QUALIFIED at 66 ${EM} weakest dimension: specificity.`,
      recommendedMaxPrice: 6,
      risks: [],
      dimensions: [],
      claims: [],
      notChecked: [`Live behaviour ${EM} not probed.`],
      reproducibility: { exact: [], modelDerived: [], unavailable: [], note: `Rules only ${EM} no model ran.` },
    } as never,
    decisions: [],
    escalations: [],
  } as never);
}

async function ask(receipt: unknown): Promise<{ valid: boolean; reason?: string; note?: string }> {
  const response = await POST(
    new Request("https://yuzu-market.vercel.app/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    }),
  );
  return (await response.json()) as { valid: boolean; reason?: string; note?: string };
}

describe("a receipt damaged in transit is not called a forgery", () => {
  it("verifies a receipt that survived a parse and re-serialise", async () => {
    const receipt = receiptWithEmDash();
    // Exactly what any consumer does: parse, hold, hand back.
    expect((await ask(JSON.parse(JSON.stringify(receipt)) as unknown)).valid).toBe(true);
  });

  it("still verifies when every non-ASCII character was escaped in transit", async () => {
    const receipt = receiptWithEmDash();
    // What Python's json.dumps does by default. Different bytes, same value.
    // Character by character rather than a regex class: a literal
    // non-ASCII range in this file is the first thing a bad codec eats.
    // Built with fromCharCode rather than escape sequences, because a
    // backslash in this file is exactly what the layers under it keep eating.
    const BACKSLASH = String.fromCharCode(92);
    const escaped = [...JSON.stringify(receipt)]
      .map((c) =>
        c.charCodeAt(0) > 127
          ? BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0")
          : c,
      )
      .join("");
    // The escaping must actually have happened or this asserts nothing.
    expect(escaped).toContain(BACKSLASH + "u2014");
    expect(escaped).not.toContain(EM);
    expect((await ask(JSON.parse(escaped) as unknown)).valid).toBe(true);
  });

  it("names the encoding damage instead of only accusing the caller", async () => {
    const receipt = receiptWithEmDash();
    const wrongCodec = JSON.parse(
      JSON.stringify(receipt).split(EM).join(FFFD),
    ) as unknown;

    const answer = await ask(wrongCodec);
    expect(answer.valid).toBe(false);
    // The verdict is unchanged and correct: the bytes really are different.
    expect(answer.reason).toBe("signature_mismatch");
    // What is new is the sentence that tells them why, which is the difference
    // between an hour of debugging and a one-line fix.
    expect(answer.note).toBeDefined();
    expect(answer.note).toContain("U+FFFD");
    expect(answer.note).toContain("UTF-8");
  });

  it("says nothing extra about an ordinary tamper", async () => {
    const receipt = receiptWithEmDash();
    const edited = JSON.parse(JSON.stringify(receipt)) as { report: { score: number } };
    edited.report.score = 99;

    const answer = await ask(edited);
    expect(answer.valid).toBe(false);
    expect(answer.reason).toBe("signature_mismatch");
    // No replacement characters, so no encoding excuse offered for a real edit.
    expect(answer.note).toBeUndefined();
  });
});
