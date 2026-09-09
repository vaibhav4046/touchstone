import { afterEach, describe, expect, it } from "vitest";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { publicKeyDocument, sign, signingKey, verify, type Receipt } from "../lib/assay/receipt";

/**
 * The claim under test is a sentence in the README: anyone can check a receipt.
 *
 * Under HMAC that sentence was false — only the holder of the secret could
 * check anything, so every dispute ended at our own endpoint asking to be
 * believed. These tests are the difference: a receipt verified with the key we
 * publish, by code that never touches the private half.
 */

/** Cheap, nested, and no engine required. Depth is the point of the tamper test. */
function receiptFixture(): Omit<Receipt, "signature"> {
  return {
    version: "touchstone.receipt.v1",
    receiptId: "rcp_fixture",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    issuer: "touchstone",
    buyerId: "buyer-under-test",
    purpose: "touchstone.assay",
    traceId: "trace-fixture",
    report: {
      vendor: "RenderKit",
      verdict: "QUALIFIED",
      score: 61,
      dimensions: [
        {
          id: "specificity",
          label: "Specificity",
          score: 0.8,
          weight: 0.3,
          method: "deterministic",
          summary: "fixed",
          findings: [{ code: "PRICE_VAGUE", severity: "low", detail: "buried four levels down" }],
        },
      ],
    } as never,
    decisions: [{ action: "read", resource: "vendors/renderkit/claims", outcome: "allowed", reasonCode: "grant" }],
    escalations: [],
  };
}

afterEach(() => {
  delete process.env.VERCEL;
  delete process.env.TOUCHSTONE_SIGNING_SECRET;
});

describe("a receipt is checkable by someone who has nothing of ours but the public key", () => {
  it("verifies with the published key, using no private material at all", () => {
    const receipt = sign(receiptFixture());
    expect(receipt.signature.alg).toBe("ed25519");

    const published = publicKeyDocument();
    expect(receipt.signature.publicKeyId).toBe(published.publicKeyId);

    // Deliberately not calling our own `verify`. This is the outsider's check:
    // the served base64, node:crypto, and the canonical bytes.
    const key = createPublicKey({
      key: Buffer.from(published.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const { signature, ...unsigned } = receipt;
    expect(edVerify(null, Buffer.from(canonical(unsigned)), key, Buffer.from(signature.value, "base64"))).toBe(true);

    // And our endpoint agrees with the outsider, which is the only reason it is
    // worth having.
    const ours = verify(receipt);
    expect(ours.valid).toBe(true);
  });

  it("publishes the raw 32 key bytes as well, for anything that is not Node", () => {
    const published = publicKeyDocument();
    const raw = Buffer.from(published.publicKeyRaw, "base64");
    expect(raw.length).toBe(32);
    // The SPKI form is the same key with a 12-byte header.
    expect(Buffer.from(published.publicKey, "base64").subarray(-32).equals(raw)).toBe(true);
  });
});

describe("a one-field edit anywhere fails, at any depth", () => {
  const receipt = sign(receiptFixture());

  const tampered: Record<string, Receipt> = {
    "top level: the verdict": { ...receipt, report: { ...receipt.report, verdict: "TRUSTED" } as never },
    "one level down: the buyer": { ...receipt, buyerId: "someone-else" },
    "two down: a dimension score": {
      ...receipt,
      report: {
        ...receipt.report,
        dimensions: [{ ...receipt.report.dimensions[0], score: 1 }],
      } as never,
    },
    "four down: a finding's severity": {
      ...receipt,
      report: {
        ...receipt.report,
        dimensions: [
          {
            ...receipt.report.dimensions[0],
            findings: [{ ...receipt.report.dimensions[0]!.findings[0], severity: "high" }],
          },
        ],
      } as never,
    },
    "in an audit trace: a denial becomes an allowance": {
      ...receipt,
      decisions: [{ ...receipt.decisions[0]!, outcome: "denied" }],
    },
    /**
     * The one `JSON.stringify(value, keys.sort())` would miss. A key that
     * appears only deep in the tree is invisible to a top-level allowlist, so
     * adding one there is the cheapest possible forgery against that mistake.
     */
    "a key that exists only at depth": {
      ...receipt,
      report: {
        ...receipt.report,
        dimensions: [{ ...receipt.report.dimensions[0], smuggled: "not covered by a shallow canonicaliser" }],
      } as never,
    },
  };

  for (const [what, forged] of Object.entries(tampered)) {
    it(`rejects an edit to ${what}`, () => {
      const check = verify(forged);
      expect(check.valid).toBe(false);
      if (!check.valid) expect(check.reason).toBe("signature_mismatch");
    });
  }

  it("rejects a signature that is not a signature, without throwing", () => {
    expect(verify({ ...receipt, signature: { ...receipt.signature, value: "not base64 at all !!" } }).valid).toBe(false);
    expect(verify({ ...receipt, signature: { ...receipt.signature, value: "" } }).valid).toBe(false);
  });

  it("does not let a receipt name the key it is checked against", () => {
    // If `verify` trusted `publicKeyId`, relabelling would be a forgery route.
    // It checks against the key this deployment publishes, so this is a no-op.
    const relabelled = { ...receipt, signature: { ...receipt.signature, publicKeyId: "deadbeefdeadbeef" } };
    expect(verify(relabelled).valid).toBe(true);
  });
});

describe("the published key is public, and only public", () => {
  it("leaks neither the receipt seed nor the ticket secret", () => {
    process.env.TOUCHSTONE_SIGNING_SECRET = Buffer.alloc(32, 7).toString("base64");
    const served = JSON.stringify(publicKeyDocument());

    expect(served).not.toContain(process.env.TOUCHSTONE_SIGNING_SECRET);
    // The seed in other encodings, in case a field ever exported the wrong half.
    expect(served).not.toContain(Buffer.alloc(32, 7).toString("hex"));
    expect(served).not.toContain(Buffer.alloc(32, 7).toString("base64url"));
    // The symmetric key that seals escalation tickets is a different secret and
    // must never ride along with the one we mean to publish.
    expect(served).not.toContain(signingKey());
    for (const forbidden of ["PRIVATE KEY", "privateKey", "seed", "TOUCHSTONE_SIGNING_SECRET"]) {
      expect(served).not.toContain(forbidden);
    }
  });

  it("says out loud when it is the committed development key", () => {
    expect(publicKeyDocument().development).toBe(true);
    process.env.TOUCHSTONE_SIGNING_SECRET = Buffer.alloc(32, 9).toString("base64");
    expect(publicKeyDocument().development).toBe(false);
  });

  it("hands back a snippet carrying the real key, not the placeholder", () => {
    const published = publicKeyDocument();
    expect(published.verify).toContain(published.publicKey);
    expect(published.verify).not.toContain("<PUBLIC_KEY>");
  });
});

describe("key material", () => {
  it("derives the same development keypair every run, in every process", () => {
    // Pinned, not merely compared to itself: a keypair that changed between
    // restarts would make yesterday's dev receipt look forged.
    expect(publicKeyDocument().publicKeyId).toBe(DEV_KEY_ID);
    expect(publicKeyDocument().publicKey).toBe(publicKeyDocument().publicKey);
  });

  it("uses the configured secret when there is one", () => {
    const dev = publicKeyDocument().publicKeyId;
    process.env.TOUCHSTONE_SIGNING_SECRET = Buffer.alloc(32, 3).toString("base64");
    expect(publicKeyDocument().publicKeyId).not.toBe(dev);
  });

  it("refuses a secret that is not a 32-byte seed rather than signing with the wrong key", () => {
    process.env.TOUCHSTONE_SIGNING_SECRET = "-----BEGIN PRIVATE KEY-----";
    expect(() => publicKeyDocument()).toThrow(/32-byte Ed25519 seed/);
  });

  it("refuses to sign, verify or publish in production with no secret set", () => {
    process.env.VERCEL = "1";
    expect(() => sign(receiptFixture())).toThrow(/TOUCHSTONE_SIGNING_SECRET/);
    expect(() => publicKeyDocument()).toThrow(/TOUCHSTONE_SIGNING_SECRET/);
    expect(() => verify(sample())).toThrow(/TOUCHSTONE_SIGNING_SECRET/);
  });
});

describe("receipts already in the wild", () => {
  it("reports the old HMAC receipts as legacy, not as tampered", () => {
    const legacy = { ...sample(), signature: { alg: "HMAC-SHA256", value: "a1b2c3" } };
    const check = verify(legacy);
    expect(check.valid).toBe(false);
    if (!check.valid) expect(check.reason).toBe("legacy_hmac");
  });

  it("reports an algorithm it does not implement as unknown, not as tampered", () => {
    const future = { ...sample(), signature: { alg: "ml-dsa-65", value: "a1b2c3" } };
    const check = verify(future);
    expect(check.valid).toBe(false);
    if (!check.valid) expect(check.reason).toBe("unknown_algorithm");
  });

  it("still calls an edited ed25519 receipt what it is", () => {
    const forged = { ...sign(receiptFixture()), buyerId: "someone-else" };
    const check = verify(forged);
    if (!check.valid) expect(check.reason).toBe("signature_mismatch");
  });
});

/** A well-formed shell, so these tests exercise the alg branch and nothing else. */
function sample(): Record<string, unknown> {
  return { ...receiptFixture(), signature: { alg: "ed25519", value: "AA==", publicKeyId: "0" } };
}

/**
 * The development public key id, pinned. Derived from the fixed label in
 * receipt.ts; if this changes, every receipt signed by a local run before the
 * change stops verifying, which is exactly the surprise the fixed seed exists
 * to prevent.
 */
const DEV_KEY_ID = "5ffdddeaaebfce0d";

/** The canonicaliser, copied rather than imported: it is not exported, and an
 * outsider would have to write it from the published description anyway. If
 * this copy and the real one ever disagree, this test fails, which is the
 * point. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
