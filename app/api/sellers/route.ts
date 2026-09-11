import { after } from "next/server";
import { assay } from "../../../lib/assay/engine";
import type { Finding } from "../../../lib/assay/types";
import { admit, json, rateLimited, resolveBuyer } from "../../../lib/api";
import { getSeller, listSellers, registerSeller, reputationOf } from "../../../lib/market/registry";
import type { Capability, SellerAgent } from "../../../lib/market/types";
import { slug } from "../../../lib/sharedos/identity";
import { drainAudit } from "../../../lib/sharedos/host";
import { vetSellerEndpoint } from "../../../lib/assay/sellers";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The door into the market.
 *
 * The manifest has always said the registry is open and anyone may register,
 * and until this route existed that was an unevidenced claim in a listing —
 * exactly the pattern Yuzu flags CinematicAgent for. A market that grades
 * others on checkable commitments and publishes an uncheckable one about itself
 * has handed every rival its opening argument.
 *
 * So registration is not a form submission, it is the first assay. The listing
 * a seller registers with is put through the same engine, on the same published
 * weights, that will read it again when it bids — and the verdict comes back in
 * the response, so a seller learns how it was read at the moment it joins
 * rather than after losing deals it never saw. A FLAGGED listing is refused
 * with the sentences that produced the finding quoted back, which is the only
 * kind of refusal a seller can act on.
 *
 * ponytail: the registry is one in-process Map (`lib/market/registry.ts`), so a
 * registration lives in the serverless instance that served it and nowhere
 * else. A different instance, or the same one after a cold start, knows only
 * the seeded sellers. That is a real ceiling and not a modest one: this
 * demonstrates an open registry, it does not durably host one. Durability is a
 * datastore (Redis, Postgres, the SharedOS resource plane) behind the same four
 * registry functions, and nothing above that module would change.
 */

/** Enough to describe a service, short enough that the field is not a payload. */
const MAX_NAME = 80;
const MAX_PITCH = 20_000;
const MAX_CAPABILITIES = 12;
const MAX_CAPABILITY_ID = 64;

interface Body {
  name?: unknown;
  pitch?: unknown;
  capabilities?: unknown;
  askPrice?: unknown;
  floorPrice?: unknown;
  etaSeconds?: unknown;
  endpoint?: unknown;
  sharednetNode?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  // Before the body is read, because registering runs a full assay and an assay
  // is several billed model calls. A malformed body still costs its admission
  // unit: nobody buys unmetered work by sending rubbish.
  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  const registeredBy = resolveBuyer(request);
  const raw = await request.text();

  let body: Body;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Body;
  } catch {
    return json(
      {
        error: "unreadable_body",
        message:
          "Registration takes a JSON object, not free text. Joining a market is a structured act, so it is never guessed at.",
        example: EXAMPLE,
      },
      400,
    );
  }

  const problems: string[] = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0) problems.push("name: required — the service's own name.");
  if (name.length > MAX_NAME) problems.push(`name: ${name.length} characters; the cap is ${MAX_NAME}.`);

  const pitch = typeof body.pitch === "string" ? body.pitch.trim() : "";
  if (pitch.length === 0) problems.push("pitch: required — your listing in your own words. It is what gets assayed.");
  if (pitch.length > MAX_PITCH) problems.push(`pitch: ${pitch.length} characters; the cap is ${MAX_PITCH}.`);

  const capabilities = toCapabilities(body.capabilities);
  if (capabilities.length === 0) {
    problems.push('capabilities: required — at least one dotted verb such as "research.brief", or {id, summary}.');
  }
  if (capabilities.length > MAX_CAPABILITIES) {
    problems.push(`capabilities: ${capabilities.length}; the cap is ${MAX_CAPABILITIES}.`);
  }

  const askPrice = finite(body.askPrice);
  if (askPrice === undefined || askPrice < 0) {
    problems.push("askPrice: required — a non-negative number of Arena credits.");
  }

  // A floor above the ask is not a floor, and a seller that names none has
  // authorised no discount: the broker negotiates down to `floorPrice` and no
  // further, so defaulting it to the ask means the stated price is the price.
  const floorPrice = Math.min(finite(body.floorPrice) ?? askPrice ?? 0, askPrice ?? 0);
  const etaSeconds = finite(body.etaSeconds) ?? 60;
  if (etaSeconds <= 0) problems.push("etaSeconds: must be greater than zero.");

  const endpoint = typeof body.endpoint === "string" && body.endpoint.trim().length > 0 ? body.endpoint.trim() : undefined;
  const endpointProblem = endpoint === undefined ? undefined : await endpointRefusal(endpoint);
  if (endpointProblem !== undefined) problems.push(`endpoint: ${endpointProblem}`);

  if (problems.length > 0) {
    return json(
      { error: "invalid_listing", message: "That was not readable as a listing.", problems, example: EXAMPLE },
      400,
    );
  }

  // Claiming an id that is already trading would silently replace that seller —
  // `registerSeller` is a Map set — and the replacement would inherit a
  // reputation it did not earn. Names are first-come here rather than owned,
  // which is the honest description of a registry with no identity layer.
  const id = slug(name);
  const taken = getSeller(id);
  if (taken !== undefined) {
    return json(
      {
        error: "id_taken",
        id,
        message:
          `"${name}" resolves to the seller id "${id}", which ` +
          `${taken.registeredBy === "yuzu" ? "a seeded seller" : `an agent registered by ${taken.registeredBy}`} already holds. ` +
          "Registering over it would inherit a reputation this listing did not earn, so it is refused rather than merged. Pick another name.",
      },
      409,
    );
  }

  // The registration IS the assay. Same engine, same weights, same receipt a
  // buyer would get for paying to check this listing — handed over free,
  // because a seller that cannot see how it was read cannot fix it.
  const { receipt, elapsedMs } = await assay(
    { vendor: name, pitch, askingPrice: askPrice, buyerId: registeredBy },
    endpoint === undefined ? {} : { probeEndpoint: endpoint },
  );
  const report = receipt.report;

  if (report.verdict === "FLAGGED") {
    return json(
      {
        error: "listing_flagged",
        registered: false,
        verdict: report.verdict,
        score: report.score,
        deterministicScore: report.deterministicScore,
        headline: report.headline,
        message:
          "This listing is refused registration. FLAGGED means the material either instructs the agent reading it or asks for authority a service of this kind does not need, and admitting it would put that in front of every buyer with our introduction attached. The findings below quote your own sentences. Fix them and register again — there is no appeal queue, no fee, and no tier that buys a better verdict.",
        findings: quoted(report.risks),
        rulesArePublic: "lib/assay/patterns.ts — every finding names the rule that produced it.",
        receipt,
      },
      422,
    );
  }

  const seller: SellerAgent = {
    id,
    name,
    pitch,
    capabilities,
    askPrice: askPrice ?? 0,
    floorPrice,
    etaSeconds,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(typeof body.sharednetNode === "string" ? { sharednetNode: body.sharednetNode.trim().slice(0, 96) } : {}),
    registeredBy,
    registeredAt: new Date().toISOString(),
  };
  registerSeller(seller);

  return json(
    {
      registered: true,
      seller,
      reputation: reputationOf(id),
      verdict: report.verdict,
      score: report.score,
      deterministicScore: report.deterministicScore,
      headline: report.headline,
      findings: quoted(report.risks),
      notChecked: report.notChecked,
      reproducibility: report.reproducibility,
      note:
        "You are in the book and will be considered on the next goal asking for one of your capabilities, on the same terms as the seeded sellers. Reputation starts at 0.5 — nothing known, not probably bad — and moves only on a delivery a verifier accepted. This verdict is not a rank; it is how your listing reads, and the broker re-derives it when you bid.",
      persistence:
        "This registry has no datastore. Your registration lives in the instance that served this request, so a cold start or another instance will not know you. Re-register if you stop appearing.",
      receipt,
      meta: { elapsedMs, analysis: report.analysis, registeredBy },
    },
    201,
  );
}

/**
 * The book, open.
 *
 * Reputations sit beside the listings on purpose: a registry that shows who is
 * in it without showing how they have done is an advertisement.
 */
export async function GET(): Promise<Response> {
  return json({
    service: "sellers",
    registry: listSellers().map((seller) => ({
      id: seller.id,
      name: seller.name,
      capabilities: seller.capabilities,
      askPrice: seller.askPrice,
      floorPrice: seller.floorPrice,
      etaSeconds: seller.etaSeconds,
      endpoint: seller.endpoint,
      seeded: seller.registeredBy === "yuzu",
      registeredBy: seller.registeredBy,
      registeredAt: seller.registeredAt,
      reputation: reputationOf(seller.id),
    })),
    howToJoin: {
      method: "POST",
      body: EXAMPLE,
      assayedOnSubmission:
        "Your listing goes through the same engine as POST /api/assay while you register, and the verdict comes back with the response. A FLAGGED listing is refused, with the sentences that produced each finding quoted.",
      curl:
        "curl -X POST /api/sellers -H 'content-type: application/json' -H 'x-agent-id: <your-sharednet-node-id>' -d " +
        `'${JSON.stringify(EXAMPLE)}'`,
    },
    note: "Reputation starts neutral at 0.5 and moves only on verified delivery. A seller's own confidence never touches it.",
    persistence:
      "In-process, one Map per serverless instance. The seeded sellers are on every instance; a registration is on exactly one of them. Honest rather than nominal: this demonstrates an open registry, it does not durably host one.",
  });
}

const EXAMPLE = {
  name: "RenderKit",
  pitch:
    "RenderKit produces one 9:16 product video per request. Price: 6 Arena credits. Delivery under 180 seconds. Input: a product name, three bullet points, and a hex brand colour. Output: an MP4 URL plus the shot list as JSON. If delivery exceeds 180 seconds the call returns a refund token and you are not charged.",
  capabilities: ["creative.video", { id: "creative.shotlist", summary: "Shot lists as JSON" }],
  askPrice: 6,
  floorPrice: 4,
  etaSeconds: 180,
  endpoint: "https://renderkit.example/health",
} as const;

/** Findings a seller can act on: the rule, the severity, and its own sentence. */
function quoted(risks: readonly Finding[]): ReadonlyArray<Record<string, string>> {
  return risks.map((risk) => ({
    code: risk.code,
    severity: risk.severity,
    statement: risk.statement,
    ...(risk.evidence === undefined ? {} : { yourWords: risk.evidence }),
  }));
}

/**
 * Where a registered endpoint may point.
 *
 * This route is what first lets an unauthenticated string become a URL our own
 * server fetches: no seeded seller publishes an endpoint, so before this door
 * existed every probe ended at `vendor_endpoint_unpublished`. That makes this
 * the SSRF boundary rather than a tidiness check, and the check has to be the
 * resolving one. `isBlockedHost` reads the literal host, and a literal host is
 * not where a request goes — `rival.example` with an A record of 10.0.0.5
 * passes every string test and then connects to the private network, needing no
 * rebinding trick, only an attacker who controls a DNS record. So the name is
 * resolved here through `blockedHostRefusal`, which checks every address the
 * resolver returns and is the same function the Arena participant runs.
 *
 * Two things this does not do, stated rather than implied away.
 *
 * It is resolve-then-store, so it is not the last word: a record can change
 * after registration. `lib/arena/participant.ts` — the path that actually
 * fetches a registered seller's endpoint — re-resolves immediately before
 * connecting, and that is the check that holds. `assay.probe_vendor` in
 * `lib/sharedos/tools.ts` does not re-resolve; it applies the literal check and
 * binds the URL to the hostname the named seller registered, and reaching it at
 * all needs `probe` authority that an order grant does not carry. So a hostname
 * that turns inward after registration is caught on the Arena path and is not
 * caught on the probe path, which is a gap in a file this change does not own
 * and is worth someone's attention rather than a comment that reads as if it
 * were closed.
 *
 * And it refuses a name that will not resolve at all. An endpoint nobody can
 * reach is a broken promise stored as a commitment, and a transient DNS failure
 * costs a registrant one retry, which is the cheaper of the two mistakes.
 */
async function endpointRefusal(candidate: string): Promise<string | undefined> {
  return vetSellerEndpoint(candidate);
}

function toCapabilities(value: unknown): readonly Capability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Capability[] => {
    if (typeof entry === "string") {
      const id = entry.trim().slice(0, MAX_CAPABILITY_ID);
      return id.length === 0 ? [] : [{ id, summary: id }];
    }
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as { id?: unknown; summary?: unknown };
    const id = typeof record.id === "string" ? record.id.trim().slice(0, MAX_CAPABILITY_ID) : "";
    if (id.length === 0) return [];
    const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 240) : "";
    return [{ id, summary: summary.length > 0 ? summary : id }];
  });
}

function finite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
