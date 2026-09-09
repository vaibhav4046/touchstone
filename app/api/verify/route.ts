import { publicKeyDocument, verify } from "../../../lib/assay/receipt";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

/**
 * Anyone can check a Touchstone receipt.
 *
 * A verdict that only Touchstone can confirm is a verdict you have to trust.
 * Receipts are signed with Ed25519 and the public key is served from here and
 * from `/api/pubkey`, so this endpoint is a convenience rather than an
 * authority: it runs the same public-key check a rival vendor or a judge can
 * run on their own machine, against the same published key. If we lied about a
 * result here, the offline script in the GET body would say so.
 */

/**
 * Why a receipt failed matters as much as that it failed.
 *
 * `signature_mismatch` means the bytes were edited. The two below mean nothing
 * of the sort — they are receipts this deployment cannot check at all — and
 * letting them arrive as a bare `valid: false` would read as an accusation.
 */
const UNCHECKABLE: Record<string, string> = {
  legacy_hmac:
    "This receipt was sealed with the old symmetric key, before signing moved to Ed25519. That is not evidence of tampering — it cannot be publicly verified either way. Re-run the assay for a receipt anyone can check.",
  unknown_algorithm:
    "This receipt names a signature algorithm this deployment does not implement. That is not evidence of tampering; nothing was checked.",
};

/**
 * An encoding accident wearing a forgery's reason code.
 *
 * A receipt carries the punctuation Yuzu writes, em dashes included. Parse it
 * and re-serialise it and the signature still checks — verified against Python
 * in both ASCII-escaped and UTF-8 modes, with emoji, RTL text and floats. What
 * does break it is a consumer that decodes the bytes with the wrong codec,
 * because every character it could not represent arrives as U+FFFD and the
 * receipt is genuinely, if accidentally, altered.
 *
 * The signature cannot tell that apart from an edit, and should not pretend to.
 * But a replacement character is not something our signer ever emits, so its
 * presence is worth naming: it turns a bare accusation into the one sentence
 * that actually fixes the caller's problem.
 */
function mangled(candidate: unknown): string | undefined {
  let serialised: string;
  try {
    serialised = JSON.stringify(candidate) ?? "";
  } catch {
    return undefined;
  }
  // Written as an escape on purpose: a literal replacement character in this
  // file would be the first casualty of the very mistake it detects.
  if (!serialised.includes(String.fromCharCode(0xfffd))) return undefined;
  return (
    "This receipt contains U+FFFD replacement characters, which nothing here ever writes. " +
    "It was almost certainly decoded with the wrong character set somewhere between us and you — " +
    "read and write it as UTF-8, or hand us the bytes you were given. The signature covers the " +
    "canonical JSON of the parsed receipt, so re-serialising it is safe; re-encoding it is not."
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ valid: false, reason: "unparseable_body" }, 400);
  }

  const candidate = (body as { receipt?: unknown })?.receipt ?? body;
  const result = verify(candidate);

  if (!result.valid) {
    const note = UNCHECKABLE[result.reason] ?? mangled(candidate);
    return json({ valid: false, reason: result.reason, ...(note !== undefined ? { note } : {}) }, 200);
  }

  return json({
    valid: true,
    expired: result.expired,
    receiptId: result.receipt.receiptId,
    issuedAt: result.receipt.issuedAt,
    vendor: result.receipt.report.vendor,
    verdict: result.receipt.report.verdict,
    score: result.receipt.report.score,
    decisions: result.receipt.decisions.length,
    signedBy: result.receipt.signature.publicKeyId,
  });
}

export async function GET(): Promise<Response> {
  return json({
    service: "verify",
    method: "POST",
    price: "Free, always.",
    body: "A Touchstone receipt, or {\"receipt\": {...}}",
    returns: "Whether the signature still matches the contents.",
    // The same document /api/pubkey serves. Inlined so that a reader who found
    // this endpoint first never has to be told where the key lives.
    key: publicKeyDocument(),
  });
}
