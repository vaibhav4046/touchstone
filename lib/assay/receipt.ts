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
  readonly outcome: "allowed" | "denied";
  readonly reasonCode: string;
  readonly grantId?: string;
  readonly ceilingRule?: string;
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
  readonly signature: { alg: "HMAC-SHA256"; value: string };
}

const KEY = () => process.env.TOUCHSTONE_SIGNING_KEY ?? "touchstone-development-key-not-for-production";

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
  const value = createHmac("sha256", KEY()).update(canonical(receipt)).digest("hex");
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
  const expected = createHmac("sha256", KEY()).update(canonical(unsigned)).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature.value, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, expired: Date.parse(receipt.expiresAt) < Date.now(), receipt };
}
