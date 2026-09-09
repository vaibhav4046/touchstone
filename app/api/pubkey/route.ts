import { publicKeyDocument } from "../../../lib/assay/receipt";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

/**
 * The key that makes "anyone can check a receipt" true.
 *
 * Everything a stranger needs to verify a Yuzu receipt without us: the Ed25519
 * public key, what the signature covers, and a script they can run offline. No
 * request to this endpoint is part of verification — it is here so the check
 * can be done once and then done forever without asking again.
 *
 * The private half never leaves the signing process, and cannot: the document
 * is derived entirely from the public key object.
 */
export async function GET(): Promise<Response> {
  return json({ service: "pubkey", ...publicKeyDocument() });
}
