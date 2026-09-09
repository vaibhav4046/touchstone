import { createHmac, timingSafeEqual } from "node:crypto";
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
  readonly signature: { alg: "HMAC-SHA256"; value: string };
}

/**
 * A default signing key is a forged receipt waiting to happen.
 *
 * This repository is public, so a committed fallback is not a fallback — it is
 * the key, published, for anyone who deploys without setting the real one. The
 * same key seals escalation tickets, and an approved ticket mints a grant from
 * the path and action the ticket names, so one missing environment variable
 * would turn a forgeable string into arbitrary authority.
 *
 * In production a missing key is therefore fatal at the point of use rather
 * than silently substituted. Locally it falls back to a key whose own name says
 * it is worthless, so tests and `npm run dev` still run.
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
  const value = createHmac("sha256", signingKey()).update(canonical(receipt)).digest("hex");
  return { ...receipt, signature: { alg: "HMAC-SHA256", value } };
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

  const { signature, ...unsigned } = receipt;
  const expected = createHmac("sha256", signingKey()).update(canonical(unsigned)).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature.value, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, expired: Date.parse(receipt.expiresAt) < Date.now(), receipt };
}
