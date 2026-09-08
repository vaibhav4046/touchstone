import { randomUUID } from "node:crypto";
import type { AssayInput, AssayReport, DimensionResult, Finding } from "./types";
import { allFindings, deterministicScore, rankedRisks, recommendedMaxPrice, verdictFor, weightedScore } from "./score";
import { sign, type AutoDecisionTrace, type DecisionTrace, type Receipt } from "./receipt";
import { llmAvailable } from "./llm";
import type { AnalystResult } from "./analyst";
import { ASSAY_NAMESPACE, PURPOSES, slug } from "../sharedos/identity";
import { mintAutoDecidedGrant, mintOrderGrant } from "../sharedos/grants";
import { buildContext, callTool, traceFor } from "../sharedos/host";
import { depositGrant, withdrawGrant } from "../sharedos/authority";
import { closeOrder, openOrder } from "../sharedos/orders";
import { requestEscalation, type Escalation } from "../sharedos/escalation";
import { decideFromPrecedent } from "../sharedos/precedent";
import { askPayload, probeQuestion, seedPrecedents } from "../sharedos/precedent-seed";
import type { JsonObject } from "@aicoo/sharedos";

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * The matcher behind every auto-decision this engine makes, named and versioned.
 *
 * R4 wants a class handle rather than a per-request one: a matcher will be
 * improved, some improvement will be wrong, and the difference between that
 * being an incident and being a rollback is whether an operator can select
 * everything one generation produced and revoke it in a single action.
 */
const PROBE_MATCHER = "touchstone.probe.exact-question.v1";

export interface AssayOptions {
  /** A live endpoint the buyer wants probed. Never covered by an order grant. */
  readonly probeEndpoint?: string;
  readonly traceId?: string;
  /**
   * Wake a person when the record cannot answer. Off unless a caller says so.
   *
   * `sharedos.escalate` puts a bridge into `escalation_pending`, where it stops
   * answering until somebody resolves it. That is correct behaviour and a
   * losing move in a room that forbids a human in the loop for two hours, so
   * the path stays here fully working behind a flag that is off during a run:
   * what the record cannot answer is named in the receipt and left for after.
   */
  readonly allowHumanEscalation?: boolean;
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

  // The owner's answers go on the record before the run can consult them. It
  // is a fixed table, and a no-op after the first assay a given buyer runs.
  await seedPrecedents(input.buyerId);

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

  depositGrant(grant);
  const context = buildContext({ buyerId: input.buyerId, purpose: PURPOSES.assay, traceId });
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
    const autoDecisions: AutoDecisionTrace[] = [];
    const notChecked: string[] = [...unrun];
    if (options.probeEndpoint !== undefined) {
      const probePath = ["vendors", vendorSlug, "probe"];
      const probeArgs = { ...args, endpoint: options.probeEndpoint };
      const requirement = { path: probePath, action: "probe" };
      const probe = await callTool(context, "assay.probe_vendor", probeArgs, requirement);

      if (probe.denied !== undefined) {
        // Authority the order grant does not carry. Ask the record before
        // asking a person: the owner answered this question in front of the
        // room, and inside the room there is nobody left to ask.
        const decided = await decideFromPrecedent(context, askPayload(probeQuestion(vendorSlug)), PROBE_MATCHER);
        autoDecisions.push({
          matcher: decided.asked,
          resource: `${ASSAY_NAMESPACE}/${probePath.join("/")}`,
          action: "probe",
          admitted: decided.admitted,
          allowed: decided.allowed,
          match: decided.match,
          narrowed: decided.narrowed,
          citedRequestIds: decided.citedRequestIds,
          reason: decided.reason,
        });

        if (
          decided.admitted &&
          decided.allowed &&
          decided.requestId !== undefined &&
          decided.capabilities !== undefined &&
          decided.constraints !== undefined
        ) {
          // The order grant is never widened. The record issues a second and
          // strictly smaller one, exactly as an approved escalation would.
          const grant = mintAutoDecidedGrant({
            requestId: decided.requestId,
            buyerId: input.buyerId,
            capabilities: decided.capabilities,
            constraints: decided.constraints,
            metadata: (decided.metadata ?? {}) as JsonObject,
            now: new Date(),
          });
          depositGrant(grant);
          try {
            // Probing is its own intent, and the envelope the record handed
            // back says so. A grant minted for it authorises nothing under the
            // assay purpose, so the retry states the purpose it is for.
            const probeContext = buildContext({ buyerId: input.buyerId, purpose: PURPOSES.probe, traceId });
            const retried = await callTool(probeContext, "assay.probe_vendor", probeArgs, requirement);
            if (retried.denied !== undefined) {
              notChecked.push(
                `Live behaviour of ${options.probeEndpoint}: not probed. The owner's record allowed it, but the call was still refused (${retried.denied.reasonCode}).`,
              );
            }
          } finally {
            // The grant covered one probe. It does not outlive it.
            withdrawGrant(grant.id);
          }
        } else if (options.allowHumanEscalation === true) {
          escalation = await requestEscalation({
            buyerId: input.buyerId,
            resourcePath: probePath,
            action: "probe",
            reason: `Buyer asked for a live probe of ${options.probeEndpoint}. An order grant does not carry authority to reach a third party.`,
            context,
          });
          notChecked.push(
            `Live behaviour of ${options.probeEndpoint}: not probed. Reaching a third party needs an approved escalation (${escalation.id}), and this order grant does not carry it.`,
          );
        } else {
          notChecked.push(
            `Live behaviour of ${options.probeEndpoint}: not probed. ${
              decided.admitted
                ? "The owner refused this question before the Arena opened."
                : `The owner's record does not answer this question (${decided.reason ?? "unknown"}).`
            } Nobody is woken mid-run to answer it.`,
          );
        }
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

    const modelDerived = dimensions.filter((d) => d.method === "model" && d.weight > 0).map((d) => d.label);
    const exact = dimensions
      .filter((d) => d.method !== "model" && d.method !== "not-run" && d.weight > 0)
      .map((d) => d.label);

    const report: AssayReport = {
      vendor: input.vendor,
      vendorSlug,
      verdict,
      score,
      deterministicScore: deterministicScore(dimensions),
      reproducibility: {
        exact,
        modelDerived,
        note:
          modelDerived.length === 0
            ? "Every dimension in this report is reproducible: the same listing yields the same score."
            : "deterministicScore covers the rules and the classifier and is exactly reproducible. score also includes the model's claim analysis, which may shift between runs. The verdict floors — steering and credential requests — are deterministic and do not depend on the model.",
      },
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
      autoDecisions,
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
    withdrawGrant(grant.id);
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
