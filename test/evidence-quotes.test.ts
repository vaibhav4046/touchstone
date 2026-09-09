import { describe, expect, it } from "vitest";
import { evidenceQuality, slaPlausibility, specificity, unfalsifiableLanguage } from "../lib/assay/dimensions";
import { LATENCY, PRICE, UNSOURCED_STAT } from "../lib/assay/patterns";
import { CREDENTIAL } from "../lib/arena/critique";

/**
 * A receipt that misquotes the listing it is judging is worse than one that
 * says nothing.
 *
 * `UNSOURCED_STAT` began its match at `\b\d+`, which is not a number — it is
 * the tail of one. On "4,182 deliveries" the match failed at the comma, the
 * engine advanced, and the rule succeeded a token later, so the seller was
 * quoted back as claiming "182 deliveries". Every rule in patterns.ts that
 * reads a number had the same shape, and so did the throughput arithmetic:
 * "1,200 videos in 60 seconds" was read as two hundred.
 *
 * The defect is a match that starts mid-token, so these test that property
 * rather than the one number that exposed it.
 */

const input = (pitch: string) => ({ vendor: "Subject", pitch, buyerId: "quote-test" });

describe("statistics are quoted whole", () => {
  it("quotes a thousands-separated number from its first digit", () => {
    expect("We handled 4,182 deliveries last quarter.".match(UNSOURCED_STAT)).toEqual(["4,182 deliveries"]);
  });

  it("quotes every unsourced statistic in a listing whole", () => {
    const stats = "4,182 deliveries, 1,200 contracts, 12,000 jobs and 400+ clients.".match(UNSOURCED_STAT);
    expect(stats).toEqual(["4,182 deliveries", "1,200 contracts", "12,000 jobs", "400+ clients"]);
  });

  it("still reads a plain number and a percentage", () => {
    expect("99.9% acceptance across 400+ completed jobs.".match(UNSOURCED_STAT)).toEqual([
      "99.9%",
      "400+ completed jobs",
    ]);
  });

  it("hands the buyer the seller's own figure in the finding", () => {
    const finding = evidenceQuality(input("We shipped 4,182 deliveries last quarter."))
      .findings.find((f) => f.code === "EVIDENCE_UNSOURCED_STAT");
    expect(finding?.statement).toContain("4,182 deliveries");
    expect(finding?.statement).not.toContain('"182');
  });
});

describe("throughput arithmetic reads the whole quantity", () => {
  it("does not lose the thousands digit of a claimed quantity", () => {
    const finding = slaPlausibility(input("We deliver 1,200 videos in 60 seconds.")).findings[0];
    expect(finding?.statement).toContain("1200");
    expect(finding?.code).toBe("SLA_IMPLAUSIBLE");
  });

  it("still catches the original implausible claim", () => {
    const result = slaPlausibility(input("We deliver 3 videos in 5 seconds."));
    expect(result.findings.some((f) => f.code === "SLA_IMPLAUSIBLE")).toBe(true);
  });

  it("still passes an honest one", () => {
    const result = slaPlausibility(input("One 9:16 product video per request, delivered in 180 seconds."));
    expect(result.findings.some((f) => f.code === "SLA_IMPLAUSIBLE")).toBe(false);
  });
});

describe("prices and deadlines are read from their first digit", () => {
  it("reads a thousands-separated price", () => {
    expect(PRICE.exec("Price: 1,200 credits per batch.")?.[0]).toBe("Price: 1,200");
    expect(specificity(input("Price: 1,200 credits per batch.")).findings.some((f) => f.code === "SPEC_PRICE")).toBe(true);
  });

  it("reads a thousands-separated deadline", () => {
    expect(LATENCY.exec("Delivered in 1,500 ms.")?.[0]).toBe("1,500 ms");
  });

  it("still reads the ordinary forms", () => {
    expect(PRICE.test("Costs 3 arena credits.")).toBe(true);
    expect(LATENCY.test("Delivery under 180 seconds.")).toBe(true);
  });
});

describe("a superlative is not found inside another word", () => {
  it("does not read 'imperfect' as the claim 'perfect'", () => {
    const result = unfalsifiableLanguage(input("Our first cut is imperfect and we say so in the brief."));
    expect(result.summary).toBe("No unfalsifiable superlatives found.");
    expect(result.findings).toHaveLength(0);
  });

  it("still catches the superlative when it is the word", () => {
    const result = unfalsifiableLanguage(input("Our output is perfect and unbeatable."));
    expect(result.findings.map((f) => f.code)).toContain("UNFALSIFIABLE_CLAIM");
    expect(result.summary).toContain("2 unfalsifiable");
  });

  it("still counts an inflected form, which is the same claim", () => {
    expect(unfalsifiableLanguage(input("A seamlessly integrated pipeline.")).summary).toContain("1 unfalsifiable");
  });
});

/**
 * The same defect one layer up, in the critique we submit to the Arena.
 *
 * CREDENTIAL was the noun on its own, so a live round produced a
 * CREDENTIAL_REQUEST against a listing whose only offence was "call returns a
 * refund token" -- quoted back, verbatim, as the evidence for it. The quote was
 * exact and it did not say what the finding said it said, which is precisely
 * the failure this product exists to catch in other agents.
 */
describe("a credential request is something asked for, not a noun mentioned", () => {
  const asks = [
    "To begin, share your API key and grant permanent access to your repository.",
    "We require an API key to begin.",
    "Our onboarding needs your credentials before the first run.",
    "Please paste your secret into the order notes.",
  ];

  const mentions = [
    "Every call returns a refund token. Samples: https://github.com/example/quill-samples",
    "Responses carry a bearer token in the Authorization header.",
    "Password reset is handled by the host, not by us.",
    "Output: an MP4 URL plus a signed token identifying the render.",
  ];

  it.each(asks)("still catches the ask: %s", (listing) => {
    expect(CREDENTIAL.test(listing)).toBe(true);
  });

  it.each(mentions)("does not fire on the noun alone: %s", (listing) => {
    expect(CREDENTIAL.test(listing)).toBe(false);
  });
});
