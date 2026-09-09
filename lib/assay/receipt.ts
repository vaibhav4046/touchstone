import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import type { AssayReport } from "./types";

/**
 * A receipt is portable evidence, not a database row.
 *
 * The whole report is signed and handed to the buyer. Anyone — the buyer, a
 * rival vendor, a judge — can verify it against the public endpoint without
 * Touchstone being online or trusted, and nothing about a past assay depends
 * on us still holding it. That is deliberate: an assay office whose findings
 * only exist inside the assay office is asking to be taken on faith.
 */

export interface DecisionTrace {
  readonly action: string;
  readonly resource: string;
  readonly outcome: "allowed" | "denied" | "escalated";
  readonly reasonCode: string;
  readonly grantId?: string;
  readonly ceilingRule?: string;
}

/**
 * Authority answered from the owner's own record instead of by waking a person.
 *
 * It sits beside `escalations` rather than inside them because it is the
 * opposite event. An escalation is a decision nobody has made yet; this is one
 * that was made before the room opened and merely read back — so filing them
 * together would count a machine answer as a request for help.
 */
export interface AutoDecisionTrace {
  /** The matcher that produced it. R4's handle: the thing an operator revokes. */
  readonly matcher: string;
  readonly resource: string;
  readonly action: string;
  /** Whether the record could answer at all, separate from what it answered. */
  readonly admitted: boolean;
  readonly allowed: boolean;
  /** Whether the cited evidence was the identical question, or merely a similar one. */
  readonly match?: string;
  /** True when resemblance carried it and the grant was bounded by the ask as well. */
  readonly narrowed?: boolean;
  readonly citedRequestIds: readonly string[];
  /** Why the record could not answer, when it could not. */
  readonly reason?: string;
}

export interface Receipt {
  readonly version: "touchstone.receipt.v1";
  readonly receiptId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuer: "touchstone";
  readonly buyerId: string;
  readonly purpose: string;
  readonly traceId: string;
  readonly report: AssayReport;
  /** Every authorization the kernel made while producing this report. */
  readonly decisions: readonly DecisionTrace[];
  readonly escalations: readonly { id: string; resource: string; action: string; state: string }[];
  /**
   * Authority the record answered, so a reader can audit what ran without a
   * person. Absent on a receipt from a path that never asked for any.
   */
  readonly autoDecisions?: readonly AutoDecisionTrace[];
  /**
   * Ed25519 over the canonical bytes of everything above, base64.
   *
   * `alg` and `publicKeyId` sit inside the block they describe and are
   * therefore not themselves covered by the signature. That is safe only
   * because nothing trusts them: `verify` dispatches on `alg` and then checks
   * against the key *this deployment* publishes, never against a key the
   * receipt names. Relabelling a receipt changes which check runs, and every
   * check still has to pass.
   */
  readonly signature: { alg: "ed25519"; value: string; publicKeyId: string };
}

/**
 * The shared secret. It seals escalation tickets, and nothing else.
 *
 * Receipts used to be signed with this too, and that made "anyone can check a
 * receipt" false: an HMAC is a claim only its holder can check, so every
 * dispute ended at our own endpoint saying trust me. Receipts moved to Ed25519
 * below. Tickets did not, and the difference is the point.
 *
 * A receipt is *evidence*: publishing the key that checks it costs nothing,
 * because the public half cannot mint one. An escalation ticket is *authority*
 * — `decideEscalation` mints a capability grant from the path and action the
 * ticket names, so anyone who can produce a valid ticket can produce a grant.
 * Handing the world a key that verifies tickets, in a system where the same
 * parties would like to write them, is the whole vulnerability. Symmetric is
 * correct here: the only party that should be able to check a ticket is the
 * party that issued it.
 *
 * This repository is public, so a committed fallback is not a fallback — it is
 * the key, published, for anyone who deploys without setting the real one. In
 * production a missing key is therefore fatal at the point of use rather than
 * silently substituted. Locally it falls back to a key whose own name says it
 * is worthless, so tests and `npm run dev` still run.
 */
const DEV_KEY = "INSECURE-DEV-ONLY-touchstone-key-do-not-deploy";

export function signingKey(): string {
  const configured = process.env.TOUCHSTONE_SIGNING_KEY;
  if (configured !== undefined && configured.length > 0) return configured;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new Error(
      "TOUCHSTONE_SIGNING_KEY is not set. Refusing to sign or verify with the public development key.",
    );
  }
  return DEV_KEY;
}

/**
 * Receipt keys: Ed25519. The private half lives here, the public half is served
 * to anyone who asks, and that is the only reason "anyone can check a receipt"
 * is a true sentence.
 *
 * `TOUCHSTONE_SIGNING_SECRET` is the 32-byte Ed25519 seed, base64. One line,
 * which is what an environment variable can actually hold, and the same thing
 * every other Ed25519 tool means by "the private key":
 *
 *   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
 *
 * Locally it is derived from a fixed label rather than generated, so the public
 * key is identical on every run and in every process: tests can pin it, and a
 * receipt written by `npm run dev` still verifies tomorrow. A freshly generated
 * dev key would be a different key every reload, and a receipt that stops
 * verifying is indistinguishable from a receipt someone edited. The label is
 * the warning — this key is published, in this file, in a public repository.
 */
const DEV_SEED_LABEL = "INSECURE-DEV-ONLY-touchstone-ed25519-do-not-deploy";

/** DER header of a PKCS8 Ed25519 private key. The 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

interface Keypair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  /** True when the committed development seed is in use. Published, loudly. */
  readonly development: boolean;
}

function keypair(): Keypair {
  const configured = process.env.TOUCHSTONE_SIGNING_SECRET;
  let seed: Buffer;
  let development: boolean;

  if (configured !== undefined && configured.length > 0) {
    seed = Buffer.from(configured, "base64");
    if (seed.length !== 32) {
      // base64 decoding is lenient enough to turn a pasted PEM, or a copied
      // half of one, into plausible bytes. Length is what catches the wrong
      // thing entirely, and it is worth catching loudly: the alternative is a
      // deployment that signs every receipt with a key nobody meant.
      throw new Error(
        `TOUCHSTONE_SIGNING_SECRET must be a base64-encoded 32-byte Ed25519 seed; it decoded to ${seed.length} bytes.`,
      );
    }
    development = false;
  } else {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
      throw new Error(
        "TOUCHSTONE_SIGNING_SECRET is not set. Refusing to sign or verify with the public development keypair. " +
          "(Receipt signing moved from the HMAC TOUCHSTONE_SIGNING_KEY to Ed25519; TOUCHSTONE_SIGNING_KEY now seals escalation tickets only.)",
      );
    }
    seed = createHash("sha256").update(DEV_SEED_LABEL).digest();
    development = true;
  }

  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return { privateKey, publicKey: createPublicKey(privateKey), development };
}

/** The bare 32 key bytes, without the SPKI wrapper. What non-Node tools want. */
function rawPublicKey(publicKey: KeyObject): Buffer {
  return publicKey.export({ format: "der", type: "spki" }).subarray(-32);
}

/** Names which key signed a receipt. A digest of the public half, so public. */
function keyId(publicKey: KeyObject): string {
  return createHash("sha256").update(rawPublicKey(publicKey)).digest("hex").slice(0, 16);
}

/**
 * What a stranger is handed so they never have to ask us anything again.
 *
 * Every field is derived from the public half; no branch in here can reach the
 * seed, and `test/pubkey.test.ts` asserts the served bytes contain neither the
 * seed nor the ticket secret. An endpoint whose entire job is to be copied is
 * the worst possible place for a leak.
 */
export interface PublicKeyDocument {
  readonly alg: "ed25519";
  readonly publicKeyId: string;
  /** SPKI DER, base64. Loads straight into `crypto.createPublicKey`. */
  readonly publicKey: string;
  /** The bare 32 key bytes, base64, for tools that want them raw. */
  readonly publicKeyRaw: string;
  readonly signatureEncoding: "base64";
  readonly signedBytes: string;
  /** True when this deployment is signing with the committed development key. */
  readonly development: boolean;
  readonly verify: string;
}

export function publicKeyDocument(): PublicKeyDocument {
  const { publicKey, development } = keypair();
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return {
    alg: "ed25519",
    publicKeyId: keyId(publicKey),
    publicKey: spki,
    publicKeyRaw: rawPublicKey(publicKey).toString("base64"),
    signatureEncoding: "base64",
    signedBytes:
      "Canonical JSON of the receipt with its `signature` member removed: object keys sorted at every depth, " +
      "arrays left in their order, `undefined` members dropped, UTF-8.",
    development,
    verify: VERIFY_SNIPPET.replace("<PUBLIC_KEY>", spki),
  };
}

/**
 * Runnable, offline, no dependencies, no network. Save it next to a receipt and
 * run it. It is deliberately the same handful of lines `verify` below runs — if
 * the snippet and the endpoint could disagree they would not be the same check,
 * and the endpoint would be back to being something you have to trust.
 */
const VERIFY_SNIPPET = [
  "// node check.cjs receipt.json   ->   true means the receipt is intact",
  'const { createPublicKey, verify } = require("node:crypto");',
  'const receipt = require(require("node:path").resolve(process.argv[2]));',
  "",
  "const canonical = (v) =>",
  '  v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null"',
  '  : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"',
  '  : "{" + Object.entries(v)',
  "      .filter(([, i]) => i !== undefined)",
  "      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))",
  '      .map(([k, i]) => JSON.stringify(k) + ":" + canonical(i))',
  '      .join(",") + "}";',
  "",
  "const { signature, ...unsigned } = receipt;",
  'const key = createPublicKey({ key: Buffer.from("<PUBLIC_KEY>", "base64"), format: "der", type: "spki" });',
  'console.log(verify(null, Buffer.from(canonical(unsigned)), key, Buffer.from(signature.value, "base64")));',
].join("\n");

/**
 * Canonical JSON: keys sorted at every depth, arrays left in order.
 *
 * The obvious version of this is `JSON.stringify(value, Object.keys(value).sort())`,
 * and it is wrong in a way that matters. An array second argument to
 * `JSON.stringify` is an allowlist applied at *every* level, so nested
 * properties whose names happen not to appear at the top level are dropped from
 * the output — and therefore from the signature. A receipt signed that way
 * verifies happily after someone rewrites its verdict. The test suite catches
 * exactly that; this walks the tree instead.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function sign(receipt: Omit<Receipt, "signature">): Receipt {
  const { privateKey, publicKey } = keypair();
  const value = edSign(null, Buffer.from(canonical(receipt)), privateKey).toString("base64");
  return { ...receipt, signature: { alg: "ed25519", value, publicKeyId: keyId(publicKey) } };
}

export type VerifyResult =
  | { readonly valid: true; readonly expired: boolean; readonly receipt: Receipt }
  | { readonly valid: false; readonly reason: string };

export function verify(candidate: unknown): VerifyResult {
  if (typeof candidate !== "object" || candidate === null) {
    return { valid: false, reason: "not_an_object" };
  }
  const receipt = candidate as Receipt;
  if (receipt.version !== "touchstone.receipt.v1") return { valid: false, reason: "unknown_version" };
  if (typeof receipt.signature?.value !== "string") return { valid: false, reason: "missing_signature" };

  // Key material first, and deliberately before the algorithm is read. A
  // deployment that cannot state its own public key cannot honestly say
  // anything about a signature, including "that one is the old kind".
  const { publicKey } = keypair();

  // Receipts issued before the move are evidence someone still holds. Reporting
  // them as merely `valid: false` would read as tampering — the one thing a
  // receipt exists to rule out — so the reason names the algorithm instead.
  // They are genuinely uncheckable here: verification is public-key now, and
  // the HMAC that sealed them also seals escalation tickets, so it is not ours
  // to publish. Re-run the assay to get a receipt anyone can check.
  const alg: unknown = receipt.signature.alg;
  if (alg === "HMAC-SHA256") return { valid: false, reason: "legacy_hmac" };
  if (alg !== "ed25519") return { valid: false, reason: "unknown_algorithm" };

  const { signature, ...unsigned } = receipt;
  let intact = false;
  try {
    intact = edVerify(null, Buffer.from(canonical(unsigned)), publicKey, Buffer.from(signature.value, "base64"));
  } catch {
    // A signature that is not a signature is a mismatch, not a crash.
    intact = false;
  }
  if (!intact) return { valid: false, reason: "signature_mismatch" };

  return { valid: true, expired: Date.parse(receipt.expiresAt) < Date.now(), receipt };
}
