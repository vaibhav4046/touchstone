import { beforeAll, describe, expect, it } from "vitest";
import { capabilityIsWithin, type Capability, type CapabilityConstraints, type JsonObject } from "@aicoo/sharedos";
import { readAutoDecided } from "@aicoo/sharedos-precedent";
import { assay } from "../lib/assay/engine";
import { buildContext } from "../lib/sharedos/host";
import { mintAutoDecidedGrant } from "../lib/sharedos/grants";
import { TOUCHSTONE, slug } from "../lib/sharedos/identity";
import { listEscalations } from "../lib/sharedos/escalation";
import { decideFromPrecedent, type AutoDecision } from "../lib/sharedos/precedent";
import {
  askPayload,
  ownerDecisions,
  probeQuestion,
  seedPrecedents,
  type OwnerDecision,
} from "../lib/sharedos/precedent-seed";

/**
 * What has to be true for the escalation to stop being a disqualification.
 *
 * Not "the matcher usually gets it right" — that is a claim about a model. The
 * four properties below are the ones ADR 0022 makes structural, and they are
 * the ones a judge can check: an answer only where the owner left one, never
 * wider than the owner left, no allow read off a refusal, and every machine
 * answer carrying the handle that revokes its whole generation.
 */

const MATCHER = "test.precedent.v1";
const BUYER = "precedent-test-buyer";

/** A registered seller. The owner pre-decided the questions the market asks about these. */
const SELLER = "scout";

/** Nobody the registry knows, so nothing about it was pre-decided. */
const STRANGER = "unregistered-stranger";

/** `capabilityIsWithin` reads only the owner off a context, and both sides are Touchstone's. */
const OWNER = { owner: TOUCHSTONE };

const LISTING = `Scout writes competitor briefs. Price: 4 Arena credits. Delivery under 60 seconds.
Input: a product description and up to five competitor names.
Output: a markdown brief with one paragraph per competitor, plus the sources it used.
If a competitor cannot be covered from what you gave it, the brief says so.`;

/** Refused instantly by the OS rather than by the network, so the test needs neither. */
const DEAD_ENDPOINT = "http://127.0.0.1:9/health";

beforeAll(async () => {
  await seedPrecedents(BUYER);
});

function decisionFor(label: string): OwnerDecision {
  const found = ownerDecisions(BUYER).find((decision) => decision.label === label);
  if (found === undefined) throw new Error(`the owner's table has no decision labelled ${label}`);
  return found;
}

async function decide(question: OwnerDecision["question"]): Promise<AutoDecision> {
  const context = buildContext({ buyerId: BUYER, purpose: question.purpose });
  return decideFromPrecedent(context, askPayload(question), MATCHER);
}

/** Every capability decided fits inside something the owner approved. Never the reverse. */
function withinAll(decided: readonly Capability[], approved: readonly Capability[]): boolean {
  return decided.every((capability) => approved.some((width) => capabilityIsWithin(capability, width, OWNER)));
}

describe("answering from the record", () => {
  it("decides a seeded question without opening an escalation", async () => {
    const decided = await decide(probeQuestion(SELLER));

    expect(decided.admitted).toBe(true);
    expect(decided.allowed).toBe(true);
    expect(decided.citedRequestIds.length).toBeGreaterThan(0);
    // The precedent is filed under the question the run actually asks, so this
    // is the identical question rather than one that resembles it.
    expect(decided.match).toBe("exact");
  });

  it("runs the probe under the auto-decided grant and says so in the receipt", async () => {
    const { receipt, escalation } = await assay(
      { vendor: "Scout", pitch: LISTING, askingPrice: 4, buyerId: BUYER },
      { probeEndpoint: DEAD_ENDPOINT },
    );

    expect(escalation).toBeUndefined();

    const auto = (receipt.autoDecisions ?? []).find((decision) => decision.action === "probe");
    expect(auto?.admitted).toBe(true);
    expect(auto?.allowed).toBe(true);
    expect(auto?.matcher).toBe("touchstone.probe.exact-question.v1");

    // The kernel allowed the retry under a grant it loaded, not under the order
    // grant: the same probe was denied moments earlier on that one.
    const probes = receipt.decisions.filter((decision) => decision.action === "probe");
    expect(probes.some((decision) => decision.outcome === "denied")).toBe(true);
    const allowed = probes.find((decision) => decision.outcome === "allowed");
    expect(allowed?.grantId).toMatch(/^grant_auto_/);

    // It ran, so it is not listed as something Touchstone did not check.
    expect(receipt.report.notChecked.some((line) => line.includes("not probed"))).toBe(false);
  }, 60_000);
});

describe("an auto-decision may only narrow", () => {
  it("never grants a capability wider than the precedent it cited", async () => {
    for (const label of [`prove_capability:${SELLER}`, `read_listing:${SELLER}`]) {
      const decision = decisionFor(label);
      const approved = decision.approved;
      expect(approved).toBeDefined();
      if (approved === undefined) continue;

      const decided = await decide(decision.question);
      expect(decided.allowed).toBe(true);

      const granted = decided.capabilities ?? [];
      expect(granted.length).toBeGreaterThan(0);
      expect(withinAll(granted, approved.capabilities)).toBe(true);
    }
  });

  it("grants strictly less than the owner allowed when the question is smaller", async () => {
    const decision = decisionFor(`read_listing:${SELLER}`);
    const approved = decision.approved;
    expect(approved).toBeDefined();
    if (approved === undefined) return;

    const decided = await decide(decision.question);
    const granted = decided.capabilities ?? [];

    // The owner approved the seller's whole subtree; the assay asked to read
    // one leaf of it. Containment holds one way and not the other.
    expect(withinAll(granted, approved.capabilities)).toBe(true);
    expect(withinAll(approved.capabilities, granted)).toBe(false);
  });

  it("takes an envelope no looser than the precedent's, and forbids passing it on", async () => {
    const decision = decisionFor(`prove_capability:${SELLER}`);
    const approved = decision.approved;
    expect(approved).toBeDefined();
    if (approved === undefined) return;

    const decided = await decide(decision.question);
    const envelope = decided.constraints;
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;

    expect(tighterOrEqual(envelope, approved.constraints)).toBe(true);
    // A machine-made grant that can be delegated is one whose blast radius is
    // decided by somebody else. The precedent set no depth; this one is zero.
    expect(envelope.delegationDepth).toBe(0);
    expect(approved.constraints.delegationDepth).toBeUndefined();
  });
});

describe("a question nobody pre-decided", () => {
  it("is refused as no_precedent_cited rather than guessed at", async () => {
    const decided = await decide(probeQuestion(STRANGER));

    expect(decided.admitted).toBe(false);
    expect(decided.allowed).toBe(false);
    expect(decided.reason).toBe("no_precedent_cited");
    expect(decided.citedRequestIds).toEqual([]);
  });

  it("wakes nobody during a run and names the gap in the receipt", async () => {
    const before = listEscalations(500).length;

    const { receipt, escalation } = await assay(
      { vendor: "Unregistered Stranger", pitch: LISTING, buyerId: BUYER },
      { probeEndpoint: DEAD_ENDPOINT },
    );

    expect(escalation).toBeUndefined();
    // Not merely "we did not return one" — no escalation exists to be pending.
    expect(listEscalations(500).length).toBe(before);

    const auto = (receipt.autoDecisions ?? []).find((decision) => decision.action === "probe");
    expect(auto?.admitted).toBe(false);
    expect(auto?.reason).toBe("no_precedent_cited");
    expect(receipt.report.notChecked.some((line) => line.includes("no_precedent_cited"))).toBe(true);
    expect(receipt.escalations).toEqual([]);
  }, 60_000);

  it("still escalates to a person when a caller explicitly asks for it", async () => {
    const { escalation } = await assay(
      { vendor: "Unregistered Stranger", pitch: LISTING, buyerId: BUYER },
      { probeEndpoint: DEAD_ENDPOINT, allowHumanEscalation: true },
    );

    // The path is intact. It is off by default, not removed.
    expect(escalation?.state).toBe("pending");
  }, 60_000);
});

describe("a refusal is citable too", () => {
  it("does not let an allow be read off what the owner refused", async () => {
    for (const label of [`request_credentials:${slug(BUYER)}`, `read_buyer_private:${slug(BUYER)}`]) {
      const decision = decisionFor(label);
      expect(decision.approved).toBeUndefined();

      const decided = await decide(decision.question);

      // The row was found — this is not a miss dressed up as a refusal.
      expect(decided.citedRequestIds.length).toBeGreaterThan(0);
      expect(decided.allowed).toBe(false);
      expect(decided.reason).toBe("allow_cites_refusal");
      expect(decided.capabilities).toBeUndefined();
    }
  });
});

describe("every auto-decision is marked", () => {
  it("carries a marker the operator can read back off the decision", async () => {
    const decided = await decide(probeQuestion(SELLER));
    const marker = readAutoDecided(decided.metadata as JsonObject | undefined);

    expect(marker?.matcher).toBe(MATCHER);
    expect(marker?.match).toBe("exact");
    expect(marker?.citedRequestIds).toEqual(decided.citedRequestIds);
  });

  it("carries it through onto the grant the run actually issues", async () => {
    const decided = await decide(probeQuestion(SELLER));
    expect(decided.requestId).toBeDefined();
    expect(decided.capabilities).toBeDefined();
    expect(decided.constraints).toBeDefined();
    if (decided.requestId === undefined || decided.capabilities === undefined || decided.constraints === undefined) {
      return;
    }

    const grant = mintAutoDecidedGrant({
      requestId: decided.requestId,
      buyerId: BUYER,
      capabilities: decided.capabilities,
      constraints: decided.constraints,
      metadata: (decided.metadata ?? {}) as JsonObject,
      now: new Date(),
    });

    // R4's reading half: a grant with no marker was decided by a person, and
    // that is the distinction the whole rule exists to keep drawable.
    const marker = readAutoDecided(grant.metadata);
    expect(marker?.matcher).toBe(MATCHER);
    expect(marker?.citedRequestIds.length).toBeGreaterThan(0);
    expect(grant.constraints).toEqual(decided.constraints);
  });
});

function tighterOrEqual(envelope: CapabilityConstraints, precedent: CapabilityConstraints): boolean {
  const expiresInTime =
    precedent.expiresAt === undefined ||
    (envelope.expiresAt !== undefined && Date.parse(envelope.expiresAt) <= Date.parse(precedent.expiresAt));

  const usesBounded =
    precedent.maxUses === undefined || (envelope.maxUses !== undefined && envelope.maxUses <= precedent.maxUses);

  const purposesContained =
    precedent.purposes === undefined ||
    (envelope.purposes ?? []).every((purpose) => precedent.purposes?.includes(purpose) === true);

  return expiresInTime && usesBounded && purposesContained;
}
