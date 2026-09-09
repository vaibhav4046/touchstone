import { describe, expect, it, vi } from "vitest";
import { houseWork, HOUSE_MARKER } from "../lib/market/house";
import { allReputations } from "../lib/market/registry";
import type { Rfp } from "../lib/market/types";

/**
 * The claim under test: the market transacts when every model supplier refuses,
 * and never once implies the seller did the work.
 *
 * Both halves were real defects. Six live deals in a row returned HTTP 200 with
 * `filled: false` and an apology, because a whitelist of "failures that are
 * ours" did not include `openrouter_http_402` — the account out of credit — so
 * a funding problem was charged to every bidder and the shortlist emptied. And
 * the fix has its own failure mode, worse than the bug: a house-produced
 * artifact that a reader takes for a seller's.
 *
 * So the second describe below is deliberately adversarial. It does not check
 * that the labels are present; it checks that the sentences which would be lies
 * are absent, everywhere in the outcome, by comparing against a real
 * seller-delivered deal that is allowed to contain them.
 */

const upstream = vi.hoisted(() => ({
  /** Exactly the code production reported: Groq rate limited, OpenRouter out of credit, Gemini rate limited. */
  mode: "all-suppliers-down" as "all-suppliers-down" | "answering",
}));

const PRODUCTION_OUTAGE = "http_429+openrouter_http_402+gemini_429";

const SAMPLE =
  "Yuzu sits between a buyer's goal and the agents that answer it, taking the brief apart into a capability, a budget and a deadline before anyone is asked to price it.";

vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();
  return {
    ...actual,
    complete: async (options: { model: string; system?: string; user: string }) => {
      if (upstream.mode === "all-suppliers-down") {
        return { ok: false, text: "", ms: 0, error: PRODUCTION_OUTAGE as string | undefined };
      }
      if (options.model === actual.MODELS.guard) return { ok: false, text: "", ms: 0, error: "no_api_key" };
      const system = options.system ?? "";
      if (system.includes("procurement request")) {
        return {
          ok: true,
          ms: 1,
          text: '{"capability":"research.brief","deliverable":"A competitor brief in markdown.","constraints":["name every competitor"]}',
        };
      }
      if (system.includes("proof-of-capability")) return { ok: true, ms: 1, text: SAMPLE };
      if (system.includes("verify delivered work")) {
        return { ok: true, ms: 1, text: '{"adherence":0.9,"quality":0.9,"accepted":true,"findings":["Answers the brief."]}' };
      }
      return { ok: true, ms: 1, text: `${SAMPLE} ${SAMPLE} The brief is answered in full.` };
    },
  };
});

const { runBroker } = await import("../lib/market/broker");

const GOAL = "I am launching a coffee brand called Ember for busy nurses and need a competitor brief.";

async function deal(mode: "all-suppliers-down" | "answering") {
  upstream.mode = mode;
  return runBroker({
    goal: GOAL,
    budget: 20,
    buyerId: `buyer-house-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capability: "research.brief",
  });
}

describe("the market transacts when every supplier refuses", () => {
  it("fills the deal with a real deliverable instead of an apology", async () => {
    const outcome = await deal("all-suppliers-down");

    // The defect, in the two fields the reviewers actually pasted.
    expect(outcome.unfilled).toBeUndefined();
    expect(outcome.contract).toBeDefined();
    expect(outcome.settlement).toBeDefined();

    const delivery = outcome.delivery;
    expect(delivery).toBeDefined();
    if (delivery === undefined) return;

    // A real artifact, not a one-line stub and not an error string.
    expect(delivery.output.startsWith("[no delivery")).toBe(false);
    expect(delivery.output.length).toBeGreaterThan(1500);
    // Assembled from this brief: the buyer's own subject reaches the artifact.
    expect(delivery.output).toContain("Ember");
    expect(delivery.output).toContain("busy nurses");
    // And every stage after execute actually happened.
    expect(outcome.verification).toBeDefined();
    expect(outcome.verification?.accepted).toBe(true);
    expect(outcome.receipt.signature.value.length).toBeGreaterThan(0);
    for (const stage of ["execute", "verify", "settle"] as const) {
      expect(outcome.timeline.some((event) => event.stage === stage)).toBe(true);
    }
  }, 30_000);

  it("does not blame the sellers for our funding failure", async () => {
    const outcome = await deal("all-suppliers-down");

    // The whitelist bug: `openrouter_http_402` was not on the list of codes
    // that count as ours, so every bidder was dropped and nothing was bought.
    expect(outcome.proofs.length).toBeGreaterThan(0);
    expect(outcome.proofs.every((proof) => proof.passed)).toBe(true);
    expect(outcome.proofs.every((proof) => proof.proven)).toBe(false);
    for (const proof of outcome.proofs) expect(proof.reason).toContain("our upstream");
  }, 30_000);

  it("charges nothing and moves no reputation, because the seller did not do the work", async () => {
    // The whole store, not just this seller's score. `before === after` on the
    // score alone is too weak to pin the claim: a system that wrongly records
    // house work as an accepted delivery converges on 0.6 after the first deal
    // and then reports before and after as equal for ever. What has to be true
    // is that no outcome was recorded at all, and the delivered/failed counters
    // are the only things that say so.
    const before = JSON.stringify(allReputations());
    const outcome = await deal("all-suppliers-down");
    const after = JSON.stringify(allReputations());

    expect(after, "a house-fulfilled deal must not touch any seller's record").toBe(before);
    // And the receipt must not claim a seller's work was assessed, because none was.
    expect(outcome.verification?.judged).toBe(false);

    const settlement = outcome.settlement;
    expect(settlement).toBeDefined();
    if (settlement === undefined) return;

    expect(settlement.paid).toBe(0);
    expect(settlement.reputationAfter).toBe(settlement.reputationBefore);
    // The use the delivery call itself consumed is still on the record.
    expect(settlement.consumed).toBeGreaterThan(0);
    expect(settlement.agreed).toBeGreaterThan(0);
    expect(settlement.reason).toContain("charged 0");
  }, 30_000);
});

describe("a house delivery can never be mistaken for a seller's", () => {
  /**
   * Every surface a reader or a machine could take the attribution from. If a
   * label is dropped anywhere, one of these stops saying "house-template".
   */
  function surfaces(outcome: Awaited<ReturnType<typeof runBroker>>) {
    return {
      delivery: outcome.delivery?.deliveredBy,
      settlement: outcome.settlement?.deliveredBy,
      artifactTop: outcome.delivery?.output.startsWith(`${"=".repeat(66)}\n${HOUSE_MARKER}`),
      receiptVendor: outcome.receipt.report.vendorSlug,
      timeline: outcome.timeline.find((event) => event.stage === "execute")?.summary,
      headline: outcome.receipt.report.headline,
    };
  }

  it("labels itself on the delivery, the settlement, the timeline and the receipt", async () => {
    const outcome = await deal("all-suppliers-down");
    const seen = surfaces(outcome);

    expect(seen.delivery).toBe("house-template");
    expect(seen.settlement).toBe("house-template");
    expect(seen.artifactTop).toBe(true);
    expect(seen.receiptVendor).toBe("house-template");
    expect(seen.timeline).toContain("house template");
    expect(seen.headline).toContain("Yuzu's own template");
    // The marker is stamped at both ends, so a truncated read still carries it.
    expect(outcome.delivery?.output.split(HOUSE_MARKER)).toHaveLength(3);
    expect(outcome.receipt.report.notChecked.join(" ")).toContain("house template");
  }, 30_000);

  it("never states, anywhere in the outcome, that the seller delivered or was paid", async () => {
    const house = await deal("all-suppliers-down");
    const seller = house.contract?.sellerName;
    expect(seller).toBeDefined();
    if (seller === undefined) return;

    // The whole outcome as one string: timeline summaries, settlement reason,
    // verification findings, receipt, and the artifact itself. A future edit
    // that drops a qualifier puts one of these sentences back.
    const everything = JSON.stringify(house);
    for (const lie of [`${seller} delivered`, `${seller} delivered for`, "Delivery accepted."]) {
      expect(everything, `a house-fulfilled deal must never say "${lie}"`).not.toContain(lie);
    }
    // Attribution, minus the disclaimers. The timeline is allowed to say "it is
    // not Scout's work"; dropping that "not" is exactly the mutation this
    // catches, so the negation has to be part of the pattern rather than an
    // excuse to skip the check.
    expect(everything, "a house artifact must never be attributed to the seller").not.toMatch(
      new RegExp(`(?<!not )(?<!NOT )${seller}'s work`),
    );
    // And it must positively disclaim authorship, in the artifact a buyer reads.
    expect(house.delivery?.output).toContain(`${seller} did not write this`);
    expect(house.delivery?.output).toContain("You were not charged");
  }, 30_000);

  it("does not label a genuine seller delivery as the house's", async () => {
    // The inverse mutation: a label that is always on is not a label.
    const outcome = await deal("answering");
    expect(outcome.delivery?.deliveredBy).toBe("seller");
    expect(outcome.settlement?.deliveredBy).toBe("seller");
    expect(outcome.delivery?.houseReason).toBeUndefined();
    expect(outcome.delivery?.output).not.toContain(HOUSE_MARKER);
    expect(outcome.receipt.report.vendorSlug).not.toBe("house-template");
    expect(JSON.stringify(outcome)).not.toContain("house-template");
    // And the seller is paid and judged, which is the point of the other path.
    expect(outcome.settlement?.paid).toBeGreaterThan(0);
    expect(outcome.verification?.judged).toBe(true);
  }, 30_000);
});

describe("the templated artifact is on-brief and reproducible", () => {
  const rfp = (over: Partial<Rfp>): Rfp => ({
    id: "rfp_test",
    goal: GOAL,
    capability: "research.brief",
    deliverable: "A competitor brief in markdown.",
    budget: 20,
    deadlineSeconds: 240,
    constraints: [],
    ...over,
  });

  it("produces the same bytes for the same brief", () => {
    const once = houseWork(rfp({}), "Scout", PRODUCTION_OUTAGE);
    const twice = houseWork(rfp({}), "Scout", PRODUCTION_OUTAGE);
    expect(once.output).toBe(twice.output);
  });

  it("produces the number of items the brief asked for", () => {
    const five = houseWork(
      rfp({ goal: "Write five taglines for Ember, a cold brew for night-shift nurses.", capability: "copy.taglines" }),
      "Quill",
      PRODUCTION_OUTAGE,
    );
    expect(five.requested).toBe(5);
    expect(five.produced).toBe(5);

    const three = houseWork(
      rfp({ goal: "Write three taglines for Ember.", capability: "copy.taglines" }),
      "Quill",
      PRODUCTION_OUTAGE,
    );
    expect(three.produced).toBe(3);
  });

  it("carries every constraint through verbatim", () => {
    const work = houseWork(rfp({ constraints: ["name every competitor", "keep it under 400 words"] }), "Scout", "no_api_key");
    expect(work.output).toContain("name every competitor");
    expect(work.output).toContain("keep it under 400 words");
  });

  it("marks what the brief did not say rather than inventing it", () => {
    const work = houseWork(rfp({}), "Scout", "no_api_key");
    expect(work.openSlots).toBeGreaterThan(0);
    expect(work.output).toContain("[BRIEF DID NOT SAY:");
  });

  it("builds something usable for every family the registry sells", () => {
    for (const capability of [
      "research.brief",
      "research.positioning",
      "copy.taglines",
      "copy.announcement",
      "creative.shotlist",
      "creative.concept",
      "analysis.numbers",
      "analysis.review",
    ]) {
      const work = houseWork(rfp({ capability }), "Scout", "no_api_key");
      expect(work.output.length, capability).toBeGreaterThan(1500);
      expect(work.output.split(HOUSE_MARKER), capability).toHaveLength(3);
      expect(work.produced, capability).toBeGreaterThan(0);
    }
  });

  it("survives a goal with nothing extractable in it", () => {
    for (const goal of ["help", "...", "a"]) {
      const work = houseWork(rfp({ goal }), "Scout", "no_api_key");
      expect(work.output.length, goal).toBeGreaterThan(1200);
      expect(work.output, goal).toContain(HOUSE_MARKER);
    }
  });
});
