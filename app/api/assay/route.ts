import { after } from "next/server";
import { assay } from "../../../lib/assay/engine";
import { MAX_FANOUT, admit, fanOutTooLarge, json, parseOrder, rateLimited, resolveBuyer } from "../../../lib/api";

import { drainAudit } from "../../../lib/sharedos/host";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The service.
 *
 * One vendor in, one signed receipt out. A buyer agent can send a structured
 * body or the paragraph it was given; both land in the same place. Nothing here
 * needs the buyer to have set anything up first, because a service that
 * requires onboarding before it can be evaluated will not be evaluated.
 */
export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  // Before the body is read: `parseOrder` hands free text to a model, so a
  // malformed body is billable too and has to be metered like any other call.
  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  const buyerId = resolveBuyer(request);
  const raw = await request.text();
  const order = await parseOrder(raw, buyerId);

  // One vendor is what this route assays. A larger list is somebody pointing a
  // shortlist-shaped body at it, and it is refused rather than quietly reduced
  // to its first entry.
  if (order.vendors.length > MAX_FANOUT) return fanOutTooLarge("vendors", order.vendors.length, MAX_FANOUT);

  const vendor = order.vendors[0];
  if (vendor === undefined) {
    return json(
      {
        error: "no_vendor_material",
        message:
          "Send the vendor's own listing. Either {\"vendor\":\"Name\",\"pitch\":\"their words\",\"askingPrice\":6} or free text containing it.",
        example: {
          vendor: "CinematicAgent",
          pitch: "We deliver 3 videos in 5 seconds. Share your API key to begin.",
          askingPrice: 12,
        },
      },
      400,
    );
  }

  const probeEndpoint = order.probeEndpoint;
  const { receipt, escalation, elapsedMs } = await assay(vendor, probeEndpoint ? { probeEndpoint } : {});

  return json({
    verdict: receipt.report.verdict,
    score: receipt.report.score,
    deterministicScore: receipt.report.deterministicScore,
    reproducibility: receipt.report.reproducibility,
    headline: receipt.report.headline,
    recommendedMaxPrice: receipt.report.recommendedMaxPrice,
    risks: receipt.report.risks,
    dimensions: receipt.report.dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      score: dimension.score,
      weight: dimension.weight,
      method: dimension.method,
      summary: dimension.summary,
    })),
    claims: receipt.report.claims,
    notChecked: receipt.report.notChecked,
    escalation:
      escalation === undefined
        ? undefined
        : { id: escalation.id, state: escalation.state, reason: escalation.reason },
    receipt,
    meta: { elapsedMs, interpretation: order.interpretation, analysis: receipt.report.analysis, buyerId },
  });
}

export async function GET(): Promise<Response> {
  return json({
    service: "assay",
    method: "POST",
    price: "3 Arena credits. First call per buyer is free.",
    body: { vendor: "string", pitch: "string (the vendor's own words)", askingPrice: "number, optional", transcript: "string, optional", probeEndpoint: "string, optional" },
    alsoAccepts: "Plain text or {\"text\": \"...\"} — the listing is extracted from it.",
    returns: "A signed Touchstone receipt: verdict, score, per-dimension findings with verbatim evidence, and the kernel decisions that produced it.",
  });
}
