import type { AssayInput, DimensionResult, Finding, Verdict } from "./types";
import { specificity, unfalsifiableLanguage, authorityOverreach, evidenceQuality, slaPlausibility, steering } from "./dimensions";
import { deterministicScore, recommendedMaxPrice, verdictFor, weightedScore } from "./score";
import { blockedHostRefusal, isBlockedHost, type HostRefusal, type HostResolver } from "../sharedos/tools";
import type { Capability, SellerAgent } from "../market/types";
import { slug } from "../sharedos/identity";
import * as P from "./patterns";

export { isBlockedHost, blockedHostRefusal, type HostRefusal, type HostResolver };

export const MAX_SELLER_NAME = 80;
export const MAX_SELLER_PITCH = 20_000;
export const MAX_CAPABILITIES = 12;
export const MAX_CAPABILITY_ID = 64;

export interface AdversarialInspection {
  readonly isAdversarial: boolean;
  readonly findings: readonly Finding[];
  readonly normalizedPitch: string;
  readonly hasZeroWidth: boolean;
  readonly hasHomoglyphs: boolean;
  readonly categories: {
    readonly directiveOverride: boolean;
    readonly promptInjection: boolean;
    readonly invisibleHomoglyphs: boolean;
    readonly markdownExfiltration: boolean;
    readonly authorityOverreach: boolean;
  };
}

export interface MultiCriteriaReport {
  readonly vendor: string;
  readonly vendorSlug: string;
  readonly score: number;
  readonly deterministicScore: number;
  readonly verdict: Verdict;
  readonly recommendedMaxPrice?: number;
  readonly criteria: {
    readonly commitmentSpecificity: {
      readonly score: number;
      readonly presentCount: number;
      readonly totalCount: number;
      readonly findings: readonly Finding[];
    };
    readonly testableFalsifiability: {
      readonly score: number;
      readonly unfalsifiableScore: number;
      readonly evidenceScore: number;
      readonly slaScore: number;
      readonly findings: readonly Finding[];
    };
    readonly priceCalibration: {
      readonly askingPrice?: number;
      readonly recommendedMaxPrice?: number;
      readonly calibratedDiscount: number;
      readonly valueRatio: number;
    };
    readonly zeroAmbientAuthority: {
      readonly satisfiesZeroAmbient: boolean;
      readonly requestedOverreach: readonly Finding[];
      readonly grantsDerivationNote: string;
    };
  };
  readonly allFindings: readonly Finding[];
}

export interface SellerValidationResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly seller?: Partial<SellerAgent>;
}

export function toCapabilities(value: unknown): readonly Capability[] {
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

function parseFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function vetSellerEndpoint(
  candidate: string,
  resolver?: HostResolver,
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "not a URL. Give an absolute one, e.g. https://your-host/health.";
  }
  if (url.protocol !== "https:") {
    return `${url.protocol} is not fetched. Registered endpoints are called over https only.`;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return "credentials in the URL are not accepted. A probe of ours does not carry your secrets.";
  }
  if (isBlockedHost(url.hostname)) {
    return `${url.hostname} is a loopback, private, link-local or metadata address. A registered endpoint has to be reachable from outside our network, and this one names ours.`;
  }
  const refusal = await blockedHostRefusal(url.hostname, resolver);
  if (refusal === undefined) return undefined;
  return refusal.kind === "blocked"
    ? `${refusal.message} It is a public name, and it points inward.`
    : `${refusal.message}. An endpoint that does not resolve cannot be called, so it is not stored as one. If that was a transient failure, register again.`;
}

export function validateSellerRegistration(body: unknown): SellerValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, problems: ["Registration body must be a JSON object."] };
  }
  const rec = body as Record<string, unknown>;
  const problems: string[] = [];

  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (name.length === 0) problems.push("name: required, the service's own name.");
  if (name.length > MAX_SELLER_NAME) problems.push(`name: ${name.length} characters; the cap is ${MAX_SELLER_NAME}.`);

  const pitch = typeof rec.pitch === "string" ? rec.pitch.trim() : "";
  if (pitch.length === 0) problems.push("pitch: required, your listing in your own words. It is what gets assayed.");
  if (pitch.length > MAX_SELLER_PITCH) problems.push(`pitch: ${pitch.length} characters; the cap is ${MAX_SELLER_PITCH}.`);

  const capabilities = toCapabilities(rec.capabilities);
  if (capabilities.length === 0) {
    problems.push('capabilities: required, at least one dotted verb such as "research.brief", or {id, summary}.');
  }
  if (capabilities.length > MAX_CAPABILITIES) {
    problems.push(`capabilities: ${capabilities.length}; the cap is ${MAX_CAPABILITIES}.`);
  }

  const askPrice = parseFinite(rec.askPrice);
  if (askPrice === undefined || askPrice < 0) {
    problems.push("askPrice: required, a non-negative number of Arena credits.");
  }
  const floorPrice = Math.min(parseFinite(rec.floorPrice) ?? askPrice ?? 0, askPrice ?? 0);
  const etaSeconds = parseFinite(rec.etaSeconds) ?? 60;
  if (etaSeconds <= 0) {
    problems.push("etaSeconds: must be greater than zero.");
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    problems: [],
    seller: {
      name,
      pitch,
      capabilities,
      askPrice: askPrice ?? 0,
      floorPrice,
      etaSeconds,
    },
  };
}

export type ListingInput = {
  readonly vendor: string;
  readonly pitch: string;
  readonly transcript?: string;
  readonly askingPrice?: number;
  readonly buyerId?: string;
};

export function detectAdversarialListing(rawInput: ListingInput): AdversarialInspection {
  const input: AssayInput = {
    vendor: rawInput.vendor,
    pitch: rawInput.pitch,
    transcript: rawInput.transcript,
    askingPrice: rawInput.askingPrice,
    buyerId: rawInput.buyerId ?? "anonymous-buyer",
  };
  const haystack = `${input.pitch}\n${input.transcript ?? ""}`;
  const { normalized, hasZeroWidth, hasHomoglyphs } = P.normalizeAdversarialText(haystack);

  const steerResult = steering(input);
  const overreachResult = authorityOverreach(input);

  const findings: Finding[] = [...steerResult.findings, ...overreachResult.findings];

  const directiveOverridePattern =
    /\b(?:system|admin|root|developer|operator|assistant|human|user)\s*:\s*(?:override|ignore|priority|reset|grant|bypass|eval|allow|new\s+instructions)\b|(?:\[\/?(?:inst|sys|system|user|assistant|human)\]|<<\/?sys>>|<\|(?:im_start|im_end|system|user|assistant|human)\|>|<\/?system>|<\/?instructions?>)|\boverride\s+(?:all\s+)?(?:system\s+)?(?:prompts?|instructions?|directives?|rules?|filters?|constraints?|safety|guidelines?|policies?)\b/i;

  const directiveOverride = directiveOverridePattern.test(haystack) || directiveOverridePattern.test(normalized);

  const promptInjection = steerResult.findings.some(
    (f) =>
      f.code === "STEERING_INSTRUCTION" ||
      f.code === "GUARD_INJECTION_DETECTED" ||
      f.code === "ANALYST_STEERING",
  );

  const invisibleHomoglyphs = hasZeroWidth || hasHomoglyphs || findings.some(
    (f) => f.code === "ZERO_WIDTH_OBFUSCATION" || f.code === "HOMOGLYPH_OBFUSCATION",
  );

  const markdownExfiltration = findings.some((f) => f.code === "MARKDOWN_EXFILTRATION");

  const authorityOverreachHit = overreachResult.findings.some((f) => f.code.startsWith("OVERREACH_"));

  const isAdversarial =
    directiveOverride ||
    promptInjection ||
    invisibleHomoglyphs ||
    markdownExfiltration ||
    authorityOverreachHit;

  return {
    isAdversarial,
    findings,
    normalizedPitch: normalized,
    hasZeroWidth,
    hasHomoglyphs,
    categories: {
      directiveOverride,
      promptInjection,
      invisibleHomoglyphs,
      markdownExfiltration,
      authorityOverreach: authorityOverreachHit,
    },
  };
}

export function evaluateMultiCriteriaIntelligence(
  rawInput: ListingInput,
  options: { readonly maxBudget?: number } = {},
): MultiCriteriaReport {
  const input: AssayInput = {
    vendor: rawInput.vendor,
    pitch: rawInput.pitch,
    transcript: rawInput.transcript,
    askingPrice: rawInput.askingPrice,
    buyerId: rawInput.buyerId ?? "anonymous-buyer",
  };
  const vendorSlug = slug(input.vendor);

  const specDim = specificity(input);
  const unfalsifiableDim = unfalsifiableLanguage(input);
  const evidenceDim = evidenceQuality(input);
  const slaDim = slaPlausibility(input);
  const overreachDim = authorityOverreach(input);
  const steerRes = steering(input);

  const steerDim: DimensionResult = {
    id: "steering",
    label: "Steering resistance",
    score: steerRes.hits === 0 ? 1 : Math.max(0, 1 - steerRes.hits * 0.5),
    weight: 0.25,
    method: "deterministic",
    summary: steerRes.hits === 0 ? "No steering instructions found." : `${steerRes.hits} steering hits.`,
    findings: steerRes.findings,
  };

  const dimensions: readonly DimensionResult[] = [
    specDim,
    unfalsifiableDim,
    overreachDim,
    evidenceDim,
    slaDim,
    steerDim,
  ];

  const allFindings = dimensions.flatMap((d) => d.findings);
  const score = weightedScore(dimensions);
  const detScore = deterministicScore(dimensions);
  const { verdict } = verdictFor(score, allFindings);

  const recommendedPrice = recommendedMaxPrice(input.askingPrice, score, verdict);

  const presentCommitments = specDim.findings.filter((f) => !f.code.endsWith("_MISSING")).length;

  const testableScore = Math.round(
    ((unfalsifiableDim.score * unfalsifiableDim.weight +
      evidenceDim.score * evidenceDim.weight +
      slaDim.score * slaDim.weight) /
      (unfalsifiableDim.weight + evidenceDim.weight + slaDim.weight)) *
      100,
  );

  const overreachFindings = overreachDim.findings.filter((f) => f.code.startsWith("OVERREACH_"));
  const satisfiesZeroAmbient = overreachFindings.length === 0;

  const asking = input.askingPrice ?? 0;
  const calibratedDiscount =
    recommendedPrice === undefined || asking <= 0
      ? 0
      : Math.max(0, Math.round((1 - recommendedPrice / asking) * 100));

  const valueRatio = asking > 0 && recommendedPrice !== undefined ? Math.round((recommendedPrice / asking) * 100) / 100 : 0;

  return {
    vendor: input.vendor,
    vendorSlug,
    score,
    deterministicScore: detScore,
    verdict,
    recommendedMaxPrice: recommendedPrice,
    criteria: {
      commitmentSpecificity: {
        score: specDim.score,
        presentCount: presentCommitments,
        totalCount: 6,
        findings: specDim.findings,
      },
      testableFalsifiability: {
        score: testableScore,
        unfalsifiableScore: unfalsifiableDim.score,
        evidenceScore: evidenceDim.score,
        slaScore: slaDim.score,
        findings: [...unfalsifiableDim.findings, ...evidenceDim.findings, ...slaDim.findings],
      },
      priceCalibration: {
        askingPrice: input.askingPrice,
        recommendedMaxPrice: recommendedPrice,
        calibratedDiscount,
        valueRatio,
      },
      zeroAmbientAuthority: {
        satisfiesZeroAmbient,
        requestedOverreach: overreachFindings,
        grantsDerivationNote: satisfiesZeroAmbient
          ? "No ambient authority requested. Order grant remains strictly scoped to assay claims."
          : `Requests excessive ambient authority in ${overreachFindings.length} area(s).`,
      },
    },
    allFindings,
  };
}
