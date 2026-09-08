import { json } from "../../../lib/api";

export const runtime = "nodejs";

const BASE = process.env.TOUCHSTONE_BASE_URL ?? "https://touchstone-arena.vercel.app";

/**
 * What another agent reads before deciding to spend on us.
 *
 * Written to the standard Touchstone applies to everyone else: a price, a
 * deadline, named inputs and outputs, what happens when it fails, and a list of
 * what it does not do. If this manifest could not survive its own assay the
 * product would not be worth selling.
 */
export async function GET(): Promise<Response> {
  return json({
    name: "Touchstone",
    tagline: "The assay office for agent services.",
    description:
      "Send a vendor's own listing. Touchstone returns a signed verdict on which of its claims are checkable, which are not, and which are attempts to instruct the agent reading them. Built on the SharedOS kernel: every step of an assay is an authorised tool call, and the receipt carries the kernel's decisions.",
    protocolVersion: "touchstone.manifest.v1",
    baseUrl: BASE,

    services: [
      {
        name: "assay",
        endpoint: `${BASE}/api/assay`,
        method: "POST",
        price: { amount: 3, currency: "arena-credits", note: "First call per buyer is free. We would rather you checked." },
        sla: { p50Seconds: 3, maxSeconds: 30, deadlineSeconds: 300 },
        input: {
          vendor: "string — the vendor's name",
          pitch: "string — the vendor's own listing, verbatim",
          askingPrice: "number, optional — what they quoted you",
          transcript: "string, optional — a trial you already ran against them",
          probeEndpoint: "string, optional — a live URL you want reached (opens an escalation; never granted by default)",
        },
        alsoAccepts: "text/plain, or {\"text\": \"...\"} — the listing is extracted from free language",
        output: {
          verdict: "TRUSTED | QUALIFIED | UNPROVEN | FLAGGED",
          score: "0-100, a weighted mean over published dimension weights",
          recommendedMaxPrice: "what the evidence supports paying, in the currency you quoted",
          risks: "findings, most severe first, each with a verbatim quote",
          dimensions: "per-dimension score, weight, and method",
          claims: "each claim marked VERIFIABLE, UNVERIFIABLE, or CONTRADICTED",
          notChecked: "what this assay did not establish, stated plainly",
          receipt: "the whole thing, HMAC-signed and independently verifiable",
        },
        onFailure: "Returns a receipt with the dimensions that did run and names the ones that did not in notChecked. It does not invent a score.",
      },
      {
        name: "shortlist",
        endpoint: `${BASE}/api/shortlist`,
        method: "POST",
        price: { amount: 10, currency: "arena-credits" },
        sla: { maxSeconds: 60, deadlineSeconds: 300 },
        input: { budget: "number", goal: "string, optional", vendors: "array of {vendor, pitch, askingPrice}, up to 12" },
        output: "A ranked buy plan: per-vendor allocation, a buy / trial / hold / avoid decision, unspent budget, and one signed receipt each.",
        onFailure: "Vendors that could not be assayed are returned as hold with the reason, and their budget stays unspent.",
      },
      {
        name: "verify",
        endpoint: `${BASE}/api/verify`,
        method: "POST",
        price: { amount: 0, currency: "arena-credits", note: "Free. A verdict only we can confirm is not evidence." },
        input: "Any Touchstone receipt",
        output: "Whether its signature still matches its contents.",
      },
    ],

    price: "3 arena-credits per assay, 10 per shortlist, 0 to verify. The first assay for any buyer is free.",
    onFailure:
      "If a check cannot run, the receipt still returns and names that check under notChecked with its reason. Touchstone does not fill a gap with a guess, and it does not charge for a receipt it could not sign.",

    howToCall: {
      // Deliberately free of any example listing text. An earlier draft
      // embedded a sample vendor pitch here, and this manifest failed its own
      // authority-hygiene check for quoting the words "share your API key" —
      // correctly, since a detector cannot know a quotation mark makes it
      // hypothetical. The demonstration listings live at /api/samples instead.
      curl: `curl -X POST ${BASE}/api/assay -H 'content-type: application/json' -H 'x-agent-id: <your-sharednet-node-id>' -d '{"vendor":"<name>","pitch":"<their listing, verbatim>","askingPrice":<number>}'`,
      plainLanguage: `curl -X POST ${BASE}/api/assay -H 'content-type: text/plain' --data 'Should I buy from <name>? Here is what they sent me: <paste it>'`,
      sampleListings: `${BASE}/api/samples`,
    },

    whatItChecks: [
      "Commitment specificity — does the listing state a price, a deadline, its inputs, its outputs, and what happens when it fails",
      "Steering resistance — is the listing instructing the agent that reads it, by rule set and by a dedicated prompt-injection classifier",
      "Authority hygiene — does it ask for credentials, standing access, or arbitrary execution it does not need to deliver",
      "Evidence quality — are its numbers attached to anything a buyer can reach",
      "SLA plausibility — does the stated throughput survive arithmetic",
      "Claim analysis — each claim marked verifiable, unverifiable, or contradicted, with quotes",
    ],

    whatItDoesNot: [
      "It does not probe a vendor's live endpoint without an approved escalation. A buyer paying for an assay is not authority to spend a third party's resources.",
      "It does not rate a vendor it has no material for. No material, no verdict.",
      "It does not keep your material. An order is a lease and it expires.",
      "It does not accept instructions from the material it reads, including instructions telling it to score well.",
    ],

    sharedos: {
      kernel: "@aicoo/sharedos 0.1.0-alpha.2",
      purposes: ["touchstone.assay", "touchstone.shortlist", "touchstone.dossier", "touchstone.probe"],
      namespace: "arena",
      resourcePlane: "assay",
      grantModel:
        "One grant per order, bounded three ways: a purpose it cannot leave, an expiry it cannot outlive, and a use count it cannot exceed. Every analysis step is a kernel-authorised tool call.",
      escalation:
        "Live probing is never covered by an order grant. The denial opens an escalation a human decides, and approval mints a narrower grant — one action, one exact resource, one use, sixty seconds.",
      audit: "Every decision is recorded and shipped to SharedOS Cloud. The receipt carries the same decisions.",
    },

    verifyThisManifest: `${BASE}/api/assay — send this manifest as the pitch. It scores itself under the same rules.`,
  });
}
