import type { AssayInput, DimensionResult, Finding } from "./types";
import * as P from "./patterns";

/**
 * Pull the sentence a match sits in, so evidence reads as a quote.
 *
 * A period is only a sentence boundary when whitespace or the end of the text
 * follows it. Splitting on every dot turns "99.9% acceptance" into evidence
 * that stops at "99." — which is a misquote of the vendor, in a document whose
 * whole value is that it does not misquote the vendor.
 */
const BOUNDARY = /[.!?](?=\s|$)/g;

function sentenceAround(text: string, index: number): string {
  let start = 0;
  let end = text.length;
  BOUNDARY.lastIndex = 0;
  for (let match = BOUNDARY.exec(text); match !== null; match = BOUNDARY.exec(text)) {
    if (match.index < index) start = match.index + 1;
    else {
      end = match.index + 1;
      break;
    }
  }
  const slice = text.slice(start, Math.min(end, start + 300)).trim().replace(/\s+/g, " ");
  return slice.length > 0 ? slice : text.slice(index, index + 160).trim();
}

/**
 * Is this match inside a denial of the thing it matched?
 *
 * Looks back a short window from the match, stopping at the sentence that
 * contains it — a negator two sentences earlier says nothing about this clause.
 */
function negated(text: string, index: number): boolean {
  const from = Math.max(0, index - P.NEGATION_WINDOW);
  const window = text.slice(from, index);
  const sentenceStart = Math.max(window.lastIndexOf("."), window.lastIndexOf("\n"));
  return P.NEGATION.test(sentenceStart === -1 ? window : window.slice(sentenceStart + 1));
}

/** Letters and digits in any script, so the check is not English-only. */
const WORDISH = /[\p{L}\p{N}]/u;

/** Is the character before `at` part of the same word? Then this is not a match. */
function startsMidToken(text: string, at: number): boolean {
  const before = text[at - 1];
  return before !== undefined && WORDISH.test(before);
}

function quote(text: string, re: RegExp): string | undefined {
  const match = re.exec(text);
  return match === null ? undefined : sentenceAround(text, match.index);
}

const COMMITMENTS: ReadonlyArray<{ code: string; label: string; re: RegExp }> = [
  { code: "SPEC_PRICE", label: "a price", re: P.PRICE },
  { code: "SPEC_LATENCY", label: "a delivery time", re: P.LATENCY },
  { code: "SPEC_INPUTS", label: "what it accepts", re: P.INPUTS },
  { code: "SPEC_OUTPUTS", label: "what it returns", re: P.OUTPUTS },
  { code: "SPEC_FAILURE", label: "what happens when it fails", re: P.FAILURE_POLICY },
  { code: "SPEC_ARTIFACT", label: "a checkable artifact", re: P.ARTIFACT },
];

/** D1 — does the listing commit to anything that could later be shown false? */
export function specificity(input: AssayInput): DimensionResult {
  const findings: Finding[] = [];
  let present = 0;

  for (const commitment of COMMITMENTS) {
    const evidence = quote(input.pitch, commitment.re);
    if (evidence !== undefined) {
      present += 1;
      findings.push({
        code: commitment.code,
        severity: "info",
        statement: `States ${commitment.label}.`,
        evidence,
      });
    } else {
      findings.push({
        code: `${commitment.code}_MISSING`,
        severity: commitment.code === "SPEC_FAILURE" ? "medium" : "low",
        statement: `Does not state ${commitment.label}.`,
      });
    }
  }

  return {
    id: "specificity",
    label: "Commitment specificity",
    score: present / COMMITMENTS.length,
    weight: 0.2,
    method: "deterministic",
    summary: `${present} of ${COMMITMENTS.length} falsifiable commitments present.`,
    findings,
  };
}

/** D2 — density of language that stays true no matter what the vendor delivers. */
export function unfalsifiableLanguage(input: AssayInput): DimensionResult {
  const lower = input.pitch.toLowerCase();
  const words = Math.max(1, input.pitch.split(/\s+/).length);
  const findings: Finding[] = [];
  let hits = 0;

  for (const phrase of P.UNFALSIFIABLE) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(phrase, from);
      if (at === -1) break;
      from = at + phrase.length;
      // A substring search starts anywhere, including inside another word: the
      // list contains "perfect", so "our first cut is imperfect" was counted as
      // a superlative and quoted back as one. A trailing suffix is left alone —
      // "flawlessly" is the same claim as "flawless" — but a phrase that begins
      // mid-token is not the phrase.
      if (startsMidToken(lower, at)) continue;
      hits += 1;
      if (findings.length < 6) {
        findings.push({
          code: "UNFALSIFIABLE_CLAIM",
          severity: "low",
          statement: `"${phrase}" cannot be shown false by any outcome.`,
          evidence: sentenceAround(input.pitch, at),
        });
      }
    }
  }

  // One flourish per hundred words is normal copy. Six is a substitute for facts.
  //
  // Density alone is a length game. Six superlatives in fifty words scores 0.28;
  // the same six with five thousand words of filler around them scores 0.98,
  // and a vendor who reads this file can buy back the difference by padding.
  // The absolute count does not move when text is added, so the lower of the
  // two governs and adding words can no longer raise this number.
  const density = (hits / words) * 100;
  const score = Math.max(0, Math.min(1 - density / 6, 1 - hits / 12));

  return {
    id: "unfalsifiable",
    label: "Unfalsifiable language",
    score,
    weight: 0.1,
    method: "deterministic",
    summary:
      hits === 0
        ? "No unfalsifiable superlatives found."
        : `${hits} unfalsifiable superlative${hits === 1 ? "" : "s"} in ${words} words (${density.toFixed(1)} per 100).`,
    findings,
  };
}

/**
 * D3 — is the listing addressing the buyer's agent rather than describing a product?
 *
 * This is the deterministic half. The classifier half runs in injection.ts and
 * the two are combined, because a rule catches the phrasings someone wrote a
 * rule for and a classifier catches the ones nobody did.
 */
export function steering(input: AssayInput): { readonly findings: readonly Finding[]; readonly hits: number } {
  const findings: Finding[] = [];
  const haystack = `${input.pitch}\n${input.transcript ?? ""}`;
  let hits = 0;

  for (const re of P.STEERING) {
    const match = re.exec(haystack);
    if (match === null) continue;
    hits += 1;
    findings.push({
      code: "STEERING_INSTRUCTION",
      severity: "critical",
      statement:
        "Contains an instruction aimed at the agent reading it, not a description of the service.",
      evidence: sentenceAround(haystack, match.index),
    });
  }

  return { findings, hits };
}

/** D4 — does the vendor ask for authority the job does not require? */
export function authorityOverreach(input: AssayInput): DimensionResult {
  const findings: Finding[] = [];
  const haystack = `${input.pitch}\n${input.transcript ?? ""}`;

  for (const rule of P.OVERREACH) {
    const match = rule.re.exec(haystack);
    if (match === null) continue;
    if (negated(haystack, match.index)) continue;
    findings.push({
      code: rule.code,
      severity: rule.code === "OVERREACH_STANDING" ? "high" : "critical",
      statement: `Asks for ${rule.what}. A delivery service should be reachable without it.`,
      evidence: sentenceAround(haystack, match.index),
    });
  }

  const score = findings.length === 0 ? 1 : Math.max(0, 1 - findings.length * 0.45);

  return {
    id: "authority",
    label: "Authority hygiene",
    score,
    weight: 0.2,
    method: "deterministic",
    summary:
      findings.length === 0
        ? "Requests no credentials, standing access, or execution authority."
        : `Requests authority beyond delivery in ${findings.length} place${findings.length === 1 ? "" : "s"}.`,
    findings,
  };
}

/** D5 — are the numbers in the listing attached to anything a buyer could check? */
export function evidenceQuality(input: AssayInput): DimensionResult {
  const findings: Finding[] = [];
  const artifacts = input.pitch.match(/https?:\/\/\S+/g) ?? [];
  const stats = input.pitch.match(P.UNSOURCED_STAT) ?? [];

  for (const artifact of artifacts.slice(0, 4)) {
    findings.push({
      code: "EVIDENCE_ARTIFACT",
      severity: "info",
      statement: "Links a checkable artifact.",
      evidence: artifact,
    });
  }

  const unsourced =
    artifacts.length === 0 ? stats : stats.slice(0, Math.max(0, stats.length - artifacts.length));
  for (const stat of unsourced.slice(0, 5)) {
    findings.push({
      code: "EVIDENCE_UNSOURCED_STAT",
      severity: "medium",
      statement: `"${stat}" is presented as fact with no source a buyer can reach.`,
    });
  }

  // A number with a link behind it earns credit. A number alone costs some.
  const raw = artifacts.length * 0.34 - unsourced.length * 0.18;
  const score = Math.min(1, Math.max(0, 0.4 + raw));

  return {
    id: "evidence",
    label: "Evidence quality",
    score,
    weight: 0.15,
    method: "deterministic",
    summary: `${artifacts.length} checkable artifact${artifacts.length === 1 ? "" : "s"}, ${unsourced.length} unsourced statistic${unsourced.length === 1 ? "" : "s"}.`,
    findings,
  };
}

/** A whole number, commas and decimals included. Starting mid-token misquotes. */
const AMOUNT = String.raw`(?:${P.NUMBER})(?:\.\d+)?`;
const UNIT = new RegExp(
  String.raw`\b(${AMOUNT})\s*(videos?|images?|posts?|articles?|pages?|reports?|files?|assets?|designs?|scripts?)\b`,
  "i",
);
const DURATION = new RegExp(
  String.raw`\b(${AMOUNT})\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)\b`,
  "i",
);

/** "4,182" is four thousand one hundred and eighty-two, not NaN. */
function amount(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function toSeconds(value: number, unit: string): number {
  if (unit.startsWith("ms") || unit.startsWith("millisecond")) return value / 1000;
  if (unit.startsWith("h")) return value * 3600;
  if (unit.startsWith("m")) return value * 60;
  return value;
}

/** D6 — does the claimed throughput survive arithmetic? */
export function slaPlausibility(input: AssayInput): DimensionResult {
  const unitMatch = UNIT.exec(input.pitch);
  const timeMatch = DURATION.exec(input.pitch);

  if (unitMatch === null || timeMatch === null) {
    return {
      id: "sla",
      label: "SLA plausibility",
      score: 0.5,
      weight: 0.1,
      method: "deterministic",
      summary: "No quantity-and-time pair stated, so throughput cannot be checked either way.",
      findings: [
        { code: "SLA_UNSTATED", severity: "low", statement: "No checkable throughput claim to test." },
      ],
    };
  }

  const quantity = amount(unitMatch[1] ?? "0");
  const noun = unitMatch[2] ?? "artifact";
  const seconds = toSeconds(amount(timeMatch[1] ?? "0"), (timeMatch[2] ?? "s").toLowerCase());
  const perUnit = seconds / Math.max(1, quantity);

  // Generative media under ~4s per artifact is a claim, not a capability.
  const implausible = /video|design|report|article/i.test(noun) && perUnit < 4;
  const findings: Finding[] = implausible
    ? [
        {
          code: "SLA_IMPLAUSIBLE",
          severity: "high",
          statement: `Claims ${quantity} x ${noun} in ${seconds}s — ${perUnit.toFixed(1)}s per artifact. Buy one before paying for three.`,
          evidence: sentenceAround(input.pitch, unitMatch.index),
        },
      ]
    : [
        {
          code: "SLA_STATED",
          severity: "info",
          statement: `Claims ${perUnit.toFixed(1)}s per artifact (${quantity} in ${seconds}s).`,
          evidence: sentenceAround(input.pitch, unitMatch.index),
        },
      ];

  return {
    id: "sla",
    label: "SLA plausibility",
    score: implausible ? 0.15 : 0.9,
    weight: 0.1,
    method: "deterministic",
    summary: implausible
      ? "Stated throughput does not survive arithmetic."
      : "Stated throughput is arithmetically plausible.",
    findings,
  };
}

/**
 * How much of this listing there was to examine at all.
 *
 * Four of the six dimensions score by *not* finding something: no superlatives,
 * no embedded instructions, no request for credentials, no arithmetic that
 * fails. A blank listing passes all four perfectly, because there is nothing in
 * it to catch — which is how an empty pitch reached QUALIFIED at 66, one point
 * ahead of a real vendor's listing, and how 500KB of the same sentence repeated
 * beat every honest seller in the market. A grader that pays out for silence
 * pays best for saying nothing at all.
 *
 * So a clean sheet is worth only as much as the material it was drawn from.
 * Two things decide that, and the lower one governs:
 *
 *   volume     — distinct word-shaped tokens. Distinct, so repeating one
 *                sentence 24,000 times counts once; word-shaped, so a keyboard
 *                being hit does not count at all.
 *   commitment — how many of the six falsifiable commitments the listing makes.
 *                Half of them earns full credit; a listing that commits to
 *                nothing is capped at SILENT_CEILING no matter how long it is.
 *
 * Both are monotone and neither rewards length: adding words can only move a
 * listing toward the ceiling it would have had anyway, and never past it.
 */
export const EXAMINABLE = {
  /** Distinct word-shaped tokens at which volume earns full credit. */
  DISTINCT_WORDS: 24,
  /** Falsifiable commitments (of the six) at which commitment earns full credit. */
  COMMITMENTS: 3,
  /** The most a listing that commits to nothing can earn on a "found nothing wrong" dimension. */
  SILENT_CEILING: 0.25,
} as const;

/** A letter followed by letters, marks, apostrophes or hyphens. Script-agnostic. */
const TOKEN = /\p{L}[\p{L}\p{M}'’-]*/gu;
const HAS_ASCII_LETTER = /[a-z]/;
const HAS_VOWEL = /[aeiouy]/;
/** No English word runs six consonants together; "asdfjkl" and "lkjhgfdsa" do. */
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{6,}/;

/**
 * Distinct tokens that look like words, counted up to the point they stop mattering.
 *
 * The shape test only applies to tokens containing ASCII letters. A listing in
 * a script this heuristic cannot read is thin material to *this* checker, not
 * proof of gibberish, so its tokens are taken at face value — being unable to
 * judge a vendor is not grounds for convicting one.
 */
export function substantiveWords(text: string): number {
  const seen = new Set<string>();
  for (const match of text.toLowerCase().matchAll(TOKEN)) {
    const token = match[0];
    if (token.length < 2 || token.length > 24) continue;
    if (HAS_ASCII_LETTER.test(token) && (!HAS_VOWEL.test(token) || CONSONANT_RUN.test(token))) continue;
    seen.add(token);
    // The measure saturates here, so reading further tells us nothing and a
    // 500KB listing costs the same as a paragraph.
    if (seen.size >= EXAMINABLE.DISTINCT_WORDS) return seen.size;
  }
  return seen.size;
}

/**
 * 0..1. The ceiling every dimension except commitment specificity is held to.
 *
 * `commitmentRatio` is the specificity dimension's own score. When it is
 * absent — the static checks were denied, so nobody counted — only volume
 * applies: a checker that failed to run must not also convict.
 */
export function examinableRatio(pitch: string, commitmentRatio?: number): number {
  const volume = Math.min(1, substantiveWords(pitch) / EXAMINABLE.DISTINCT_WORDS);
  if (commitmentRatio === undefined) return volume;
  const target = EXAMINABLE.COMMITMENTS / COMMITMENTS.length;
  const committed = Math.min(1, Math.max(0, commitmentRatio) / target);
  return Math.min(volume, EXAMINABLE.SILENT_CEILING + (1 - EXAMINABLE.SILENT_CEILING) * committed);
}

/**
 * Hold every scored dimension to what the listing actually offered up.
 *
 * Specificity is exempt: silence already scores zero there, so capping it would
 * be punishing the same absence twice. Weight-0 dimensions are exempt too — a
 * live probe is an observation of the world, and the world does not get thinner
 * because the listing did.
 *
 * The cap is a pure function of the pitch, so `deterministicScore` stays
 * reproducible: the same listing yields the same ceiling on every run, on every
 * instance, whether or not any upstream answered.
 */
export function capByExaminable(
  dimensions: readonly DimensionResult[],
  pitch: string,
): readonly DimensionResult[] {
  const commitment = dimensions.find((dimension) => dimension.id === "specificity")?.score;
  const cap = examinableRatio(pitch, commitment);
  if (cap >= 1) return dimensions;

  const words = substantiveWords(pitch);
  const commitments = commitment === undefined ? undefined : Math.round(commitment * COMMITMENTS.length);
  const measured = `${words === 0 ? "no" : words} distinct word${words === 1 ? "" : "s"}${
    commitments === undefined ? "" : ` and ${commitments} of ${COMMITMENTS.length} falsifiable commitments`
  }`;
  const finding: Finding = {
    code: "THIN_MATERIAL",
    severity: "medium",
    statement:
      `This listing offers ${measured}, so the checks that score by finding nothing wrong had ` +
      `almost nothing to examine. Every dimension except commitment specificity is capped at ` +
      `${cap.toFixed(2)}: a clean sheet is worth no more than the material it was drawn from.`,
  };
  const note = `Capped at ${cap.toFixed(2)} — ${measured}.`;

  return dimensions.map((dimension) => {
    if (dimension.id === "specificity" || dimension.weight === 0) return dimension;
    const score = Math.min(dimension.score, cap);
    const reproducibleScore =
      dimension.reproducibleScore === undefined ? undefined : Math.min(dimension.reproducibleScore, cap);
    if (score === dimension.score && reproducibleScore === dimension.reproducibleScore) return dimension;
    return {
      ...dimension,
      score,
      reproducibleScore,
      summary: `${dimension.summary} ${note}`,
      findings: [...dimension.findings, finding],
    };
  });
}
