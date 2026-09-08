import { randomUUID } from "node:crypto";
import type { AssayInput, AssayReport, DimensionResult, Finding } from "./types";
import { allFindings, rankedRisks, recommendedMaxPrice, verdictFor, weightedScore } from "./score";
import { sign, type DecisionTrace, type Receipt } from "./receipt";
import { llmAvailable } from "./llm";
import type { AnalystResult } from "./analyst";
import { PURPOSES, slug } from "../sharedos/identity";
import { mintOrderGrant } from "../sharedos/grants";
import { buildContext, callTool, traceFor } from "../sharedos/host";
import { closeOrder, openOrder } from "../sharedos/orders";
import { requestEscalation, type Escalation } from "../sharedos/escalation";

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60_000;

export interface AssayOptions {
  /** A live endpoint the buyer wants probed. Always requires an escalation. */
  readonly probeEndpoint?: string;
  readonly traceId?: string;
}

export interface AssayOutcome {
  readonly receipt: Receipt;
  readonly escalation?: Escalation;
  readonly elapsedMs: number;
}

export async function assay(input: AssayInput, options: AssayOptions = {}): Promise<AssayOutcome> {
  const started = Date.now();
  const orderId = `ord_${randomUUID().slice(0, 8)}`;
  const traceId = options.traceId ?? randomUUID();
  const vendorSlug = slug(input.vendor);

  openOrder({ orderId, buyerId: input.buyerId, purpose: PURPOSES.assay, vendors: [input] });

  const grant = mintOrderGrant({
    orderId,
    buyerId: input.buyerId,
    purpose: PURPOSES.assay,
    vendorSlugs: [vendorSlug],
    maxUses: 12,
    ttlMs: 5 * 60_000,
    now: new Date(),
  });

  const context = buildContext({ buyerId: input.buyerId, purpose: PURPOSES.assay, grants: [grant], traceId });
  const args = { orderId, vendor: vendorSlug };
  const claimsPath = ["vendors", vendorSlug, "claims"];

  try {
    // Reading the material is itself authorised. If this is denied there is
    // nothing to assay and the receipt says so rather than inventing a score.
    await callTool(context, "assay.read_claims", args, { path: claimsPath, action: "read" });

    const [steeringCall, staticCall, analystCall] = await Promise.all([
      callTool(context, "assay.steering_scan", args, { path: claimsPath, action: "classify" }),
      callTool(context, "assay.static_checks", args, { path: claimsPath, action: "analyze" }),
      callTool(context, "assay.claim_analysis", args, { path: claimsPath, action: "analyze" }),
    ]);

    const steeringDimension = outputOf<DimensionResult>(steeringCall.result);
    const staticDimensions = outputOf<DimensionResult[]>(staticCall.result) ?? [];
    const analyst = outputOf<AnalystResult>(analystCall.result);

    // A dimension that did not run is not a dimension that passed. Name it and
    // the reason, so a low score is never mistaken for a clean sheet.
    const unrun: string[] = [
      ["steering scan", steeringCall.result] as const,
      ["static checks", staticCall.result] as const,
      ["claim analysis", analystCall.result] as const,
    ].flatMap(([label, result]) =>
      result === undefined || result.status === "succeeded"
        ? []
        : [`${label}: did not run (${result.status === "denied" || result.status === "failed" ? result.error.code : "unknown"}).`],
    );

    const dimensions: DimensionResult[] = [
      ...staticDimensions,
      ...(steeringDimension ? [steeringDimension] : []),
      ...(analyst ? [analyst.dimension] : []),
    ];

    // The probe is attempted, not skipped. The denial is the finding.
    let escalation: Escalation | undefined;
    const notChecked: string[] = [...unrun];
    if (options.probeEndpoint !== undefined) {
      const probe = await callTool(
        context,
        "assay.probe_vendor",
        { ...args, endpoint: options.probeEndpoint },
        { path: ["vendors", vendorSlug, "probe"], action: "probe" },
      );
      if (probe.denied !== undefined) {
        escalation = requestEscalation({
          buyerId: input.buyerId,
          resourcePath: ["vendors", vendorSlug, "probe"],
          action: "probe",
          reason: `Buyer asked for a live probe of ${options.probeEndpoint}. An order grant does not carry authority to reach a third party.`,
        });
        notChecked.push(
          `Live behaviour of ${options.probeEndpoint}: not probed. Reaching a third party needs an approved escalation (${escalation.id}), and this order grant does not carry it.`,
        );
      }
    } else {
      notChecked.push("Live behaviour: not probed. No endpoint was supplied and no escalation was requested.");
    }

    if (input.transcript === undefined) {
      notChecked.push("Delivered work: no trial transcript was supplied, so only the vendor's claims were examined.");
    }
    if (!llmAvailable() || analyst?.ok !== true) {
      notChecked.push("Claim-by-claim model analysis: unavailable on this run. Deterministic and classifier findings stand alone.");
    }

    const findings = allFindings(dimensions);
    const score = weightedScore(dimensions);
    const { verdict, reason } = verdictFor(score, findings);
    const risks: Finding[] = [...rankedRisks(findings), ...(analyst?.risks ?? [])].slice(0, 10);

    const report: AssayReport = {
      vendor: input.vendor,
      vendorSlug,
      verdict,
      score,
      headline: reason ?? analyst?.headline ?? defaultHeadline(verdict, score, dimensions),
      dimensions,
      claims: analyst?.claims ?? [],
      risks,
      notChecked,
      recommendedMaxPrice: recommendedMaxPrice(input.askingPrice, score, verdict),
      analysis:
        analyst?.ok === true
          ? "deterministic+classifier+model"
          : steeringDimension?.method === "classifier"
            ? "deterministic+classifier"
            : "deterministic",
    };

    const decisions: readonly DecisionTrace[] = traceFor(traceId);
    const now = new Date();
    const receipt = sign({
      version: "touchstone.receipt.v1",
      receiptId: `rcp_${randomUUID().slice(0, 12)}`,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
      issuer: "touchstone",
      buyerId: input.buyerId,
      purpose: PURPOSES.assay,
      traceId,
      report,
      decisions,
      escalations:
        escalation === undefined
          ? []
          : [
              {
                id: escalation.id,
                resource: `assay/${escalation.resourcePath.join("/")}`,
                action: escalation.action,
                state: escalation.state,
              },
            ],
    });

    return { receipt, escalation, elapsedMs: Date.now() - started };
  } finally {
    closeOrder(orderId);
  }
}

function outputOf<T>(result: { status: string; output?: unknown } | undefined): T | undefined {
  if (result === undefined || result.status !== "succeeded") return undefined;
  return result.output as T;
}

function defaultHeadline(verdict: string, score: number, dimensions: readonly DimensionResult[]): string {
  const weakest = [...dimensions]
    .filter((dimension) => dimension.weight > 0)
    .sort((left, right) => left.score - right.score)[0];
  const tail = weakest === undefined ? "" : ` Weakest dimension: ${weakest.label.toLowerCase()}.`;
  return `${verdict} at ${score.toFixed(1)}/100 on published weights.${tail}`;
}
