import { verify } from "../../../lib/assay/receipt";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

/**
 * Anyone can check a Touchstone receipt.
 *
 * A verdict that only Touchstone can confirm is a verdict you have to trust.
 * This endpoint takes a receipt someone else was given and says whether the
 * bytes still match the signature, so a rival vendor disputing a finding and a
 * judge auditing one use the same check.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ valid: false, reason: "unparseable_body" }, 400);
  }

  const candidate = (body as { receipt?: unknown })?.receipt ?? body;
  const result = verify(candidate);

  if (!result.valid) return json({ valid: false, reason: result.reason }, 200);

  return json({
    valid: true,
    expired: result.expired,
    receiptId: result.receipt.receiptId,
    issuedAt: result.receipt.issuedAt,
    vendor: result.receipt.report.vendor,
    verdict: result.receipt.report.verdict,
    score: result.receipt.report.score,
    decisions: result.receipt.decisions.length,
  });
}

export async function GET(): Promise<Response> {
  return json({
    service: "verify",
    method: "POST",
    price: "Free, always.",
    body: "A Touchstone receipt, or {\"receipt\": {...}}",
    returns: "Whether the signature still matches the contents.",
  });
}
