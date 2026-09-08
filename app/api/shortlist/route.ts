import { after } from "next/server";
import { shortlist } from "../../../lib/assay/shortlist";
import { json, parseOrder, resolveBuyer } from "../../../lib/api";

import { drainAudit } from "../../../lib/sharedos/host";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_VENDORS = 12;

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
  const buyerId = resolveBuyer(request);
  const raw = await request.text();
  const order = await parseOrder(raw, buyerId);

  if (order.vendors.length === 0) {
    return json(
      {
        error: "no_vendor_material",
        message: "Send two or more listings: {\"budget\":100,\"goal\":\"...\",\"vendors\":[{\"vendor\":\"A\",\"pitch\":\"...\",\"askingPrice\":6}]}",
      },
      400,
    );
  }

  const vendors = order.vendors.slice(0, MAX_VENDORS);
  const result = await shortlist(vendors, { budget: order.budget, goal: order.goal });

  return json({
    goal: result.goal,
    budget: result.budget,
    spent: Math.round(result.spent * 100) / 100,
    held: result.held,
    plan: result.entries,
    receipts: result.receipts,
    truncated: order.vendors.length > MAX_VENDORS ? order.vendors.length - MAX_VENDORS : undefined,
    meta: { elapsedMs: result.elapsedMs, interpretation: order.interpretation, buyerId },
  });
}

export async function GET(): Promise<Response> {
  return json({
    service: "shortlist",
    method: "POST",
    price: "10 Arena credits",
    body: { budget: "number", goal: "string, optional", vendors: "array of {vendor, pitch, askingPrice}" },
    limit: `${MAX_VENDORS} vendors per call`,
    returns: "A ranked buy plan with a per-vendor allocation, a decision (buy / trial / hold / avoid), and one signed receipt per vendor.",
  });
}
