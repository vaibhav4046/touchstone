import { after } from "next/server";
import { shortlist } from "../../../lib/assay/shortlist";
import { MAX_FANOUT, admit, fanOutTooLarge, json, parseOrder, rateLimited, resolveBuyer } from "../../../lib/api";

import { drainAudit } from "../../../lib/sharedos/host";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_VENDORS = MAX_FANOUT;

/**
 * Where the credits go.
 *
 * Assay answers "is this one honest". Shortlist answers the question a buyer
 * with a fixed budget actually has, which is "which of these, and for how
 * much". Every entry carries its own receipt, so the plan can be checked line
 * by line rather than taken on the ranking.
 */
export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  // Before the body is read, because reading it can itself call a model.
  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  const buyerId = resolveBuyer(request);
  const raw = await request.text();
  const order = await parseOrder(raw, buyerId);

  if (order.vendors.length > MAX_VENDORS) return fanOutTooLarge("vendors", order.vendors.length, MAX_VENDORS);

  if (order.vendors.length === 0) {
    return json(
      {
        error: "no_vendor_material",
        message: "Send two or more listings: {\"budget\":100,\"goal\":\"...\",\"vendors\":[{\"vendor\":\"A\",\"pitch\":\"...\",\"askingPrice\":6}]}",
      },
      400,
    );
  }

  // The rest of the fan-out, charged now that its size is known. One unit was
  // taken at admission, so a single-vendor list costs nothing further, and a
  // twelve-vendor one is refused here rather than after it has been assayed.
  const fanOut = admit(request, order.vendors.length - 1);
  if (!fanOut.ok) return rateLimited(fanOut);

  const result = await shortlist(order.vendors, { budget: order.budget, goal: order.goal });

  return json({
    goal: result.goal,
    budget: result.budget,
    spent: Math.round(result.spent * 100) / 100,
    held: result.held,
    plan: result.entries,
    receipts: result.receipts,
    meta: { elapsedMs: result.elapsedMs, interpretation: order.interpretation, buyerId },
  });
}

export async function GET(): Promise<Response> {
  return json({
    service: "shortlist",
    method: "POST",
    price: "10 Arena credits",
    body: { budget: "number", goal: "string, optional", vendors: "array of {vendor, pitch, askingPrice}" },
    limit: `${MAX_VENDORS} vendors per call, refused with 429 rather than truncated. Calls are rate limited per caller, per address and overall; a 429 carries retry-after.`,
    returns: "A ranked buy plan with a per-vendor allocation, a decision (buy / trial / hold / avoid), and one signed receipt per vendor.",
  });
}
