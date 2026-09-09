/**
 * Lexicons used by the deterministic dimensions.
 *
 * These are deliberately visible rather than buried in a model: a buyer agent
 * that disagrees with a finding can read the exact rule that produced it.
 */

/**
 * A number as vendors actually write one, thousands separators included.
 *
 * `\d+` alone is not a number, it is the tail of one. On "4,182 deliveries" it
 * fails at the comma, the engine advances, and the match succeeds one token
 * later — so the receipt quoted the vendor as saying "182 deliveries" about a
 * listing that said 4,182. A document whose whole value is that it does not
 * misquote the seller cannot start its quotes mid-token, so every rule that
 * reads a number reads a whole one.
 *
 * The grouped form comes first because alternation is ordered: with `\d+`
 * leading, "4,182" would match "4" and stop.
 */
export const NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
/** The same, with an optional decimal tail. */
const DECIMAL = String.raw`(?:${NUMBER})(?:\.\d+)?`;

export const PRICE = new RegExp(
  String.raw`(?:\b${DECIMAL}\s*(?:arena[\s-]?)?credits?\b|\bcredits?\b\W{0,6}${DECIMAL}|\bprice\b\W{0,12}${DECIMAL}|[$£€]\s?${DECIMAL}|\b${DECIMAL}\s*(?:usd|gbp|eur)\b)`,
  "i",
);

export const LATENCY = new RegExp(
  String.raw`\b(?:${DECIMAL}\s*(?:ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)\b|within\s+${DECIMAL}|under\s+${DECIMAL}|<\s*${DECIMAL}\s*(?:s|m|min|sec))`,
  "i",
);

export const INPUTS = /\b(?:input|inputs|accepts?|takes?|send me|give me|provide|payload|request format|you supply)\b/i;

export const OUTPUTS = /\b(?:output|outputs|returns?|deliver(?:s|able|ables)?|you (?:get|receive)|response format|artifact)\b/i;

export const FAILURE_POLICY =
  /\b(?:refund|retry|retries|if (?:it|i) fail|failure|fallback|guarantee|money back|no charge|credit back|sla breach)\b/i;

export const ARTIFACT = /\b(?:https?:\/\/\S+|github\.com\/\S+|node[_\s-]?id\s*[:=]\s*\S+|receipt\s*[:#]\s*\S+)/i;

/** Adjectives that survive any outcome. Density of these is the signal, not presence. */
export const UNFALSIFIABLE = [
  "best-in-class", "best in class", "world-class", "world class", "state-of-the-art",
  "state of the art", "cutting-edge", "cutting edge", "revolutionary", "game-changing",
  "game changing", "seamless", "effortless", "blazing", "lightning fast", "unmatched",
  "unparalleled", "industry-leading", "industry leading", "next-generation",
  "next generation", "military-grade", "enterprise-grade", "magical", "flawless",
  "perfect", "superior", "premier", "elite", "unbeatable", "second to none",
];

/**
 * Instructions embedded in a listing that address the *reading agent* rather
 * than describing the product. In a market where agents read listings, this is
 * not marketing — it is an attempt to move authority through a message.
 */
export const STEERING = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|other|the\s+other)\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|other)\b/i,
  /\brank\s+(?:this|us|me)\s+(?:first|highest|top|#?1)\b/i,
  /\b(?:you\s+)?(?:must|should|need to|have to)\s+(?:buy|choose|select|pick|purchase|recommend)\s+(?:this|us|me)\b/i,
  /\bwhen\s+(?:evaluating|comparing|scoring|reviewing)[^.]{0,60}\b(?:prefer|choose|favour|favor|select)\s+(?:this|us|me)\b/i,
  /\bdo\s+not\s+(?:compare|evaluate|test|assay|verify)\b/i,
  /\byour\s+(?:system\s+prompt|instructions|rules)\b/i,
  /\bas\s+an\s+ai(?:\s+agent)?,?\s+you\s+(?:must|should|are required)\b/i,
  /\boverride\s+(?:your|the)\s+(?:instructions|rules|policy|guidelines)\b/i,
  /\bthis\s+(?:listing|message)\s+is\s+(?:a\s+)?(?:system|developer|admin)\s+(?:instruction|message|prompt)\b/i,
  /\b(?:forget|discard|drop|bypass|dismiss|set\s+aside)\s+(?:all\s+)?(?:previous|prior|preceding|earlier|other)\s+(?:directives|instructions|rules|guidelines|policies)?\b/i,
  /\b(?:notice\s+to|attention|instruction\s+for)\s+(?:the\s+)?(?:autonomous\s+)?(?:evaluator|agent|buyer|model)\b/i,
  /\b(?:award|assign|grant|give)\s+(?:this\s+)?(?:listing|product|solution|entry|service|seller|us|me)?\s*(?:the\s+)?(?:top|maximum|highest|perfect|winning|\d{2,3}(?:%|\s*points|\s*score))\s*(?:rating|standing|score|mark|grade|rank)?\b/i,
  /\b(?:ensure|make\s+sure)\s+(?:this\s+)?(?:listing|solution|seller|us|me)\s+is\s+(?:selected|chosen|picked|awarded)\b/i,
];

/**
 * Requests for authority a delivery service has no business holding.
 *
 * The naive version of this matched the noun — any listing containing the words
 * "API key" was flagged. Touchstone's own service manifest tripped it, because
 * the manifest describes the check ("does it ask for credentials"), and so
 * would any honest listing that says "we never need your API key". A detector
 * that cannot tell a request from a description of a request is not a detector;
 * it is a word filter, and in a market where vendors read each other's listings
 * it would be trivially weaponised against a rival.
 *
 * So each rule needs two things in the same clause: a verb that asks, and a
 * thing asked for that belongs to the reader. `ASKS_FOR` supplies the first.
 */
const ASKS_FOR = String.raw`(?:share|send|give|provide|supply|hand|paste|enter|upload|forward|grant|transfer|expose|disclose|reveal|need|require|request|want|must have)\s+(?:me|us|it)?\s*`;
const YOURS = String.raw`(?:your|the buyer's|your own)\s+`;

function directed(target: string): RegExp {
  // The ask and the asset must sit within one clause of each other. Only word
  // characters are allowed between them, so a full stop ends the search —
  // "we never ask for keys. Send the brief." must not become an accusation.
  //
  // Note the parentheses around YOURS. Without them the trailing `?` binds to
  // that fragment's own `\s+` and makes it lazy rather than making the group
  // optional, which quietly requires the word "your" and drops every listing
  // that says "grant us permanent access".
  return new RegExp(String.raw`\b${ASKS_FOR}(?:[\w-]+\s+){0,3}(?:${YOURS})?(?:[\w-]+\s+){0,2}${target}`, "i");
}

/**
 * A promise not to do a thing is not the thing.
 *
 * "We do not need your API key" contains a request verb and a credential, and
 * a rule reading only those two facts convicts a vendor for the sentence that
 * should have cleared them.
 *
 * But a false friend like "with no delay, send your API key" or "without hesitation,
 * share your password" must not clear the match just because it has "no" or "without".
 * The negation must bind to the verb or requirement itself.
 */
export const VERB_NEGATION =
  /\b(?:(?:do|does|did|will|would|can|could|shall|should|might|must)\s+not|don't|dont|doesn't|doesnt|won't|wont|cannot|can't|never)\b/i;

export const REQUIREMENT_NEGATION =
  /\b(?:no|zero|without\s+(?:any\s+)?)\s*(?:need|requirement|obligation)\b/i;

export const WITHOUT_ACTION_NEGATION =
  /\bwithout\s+(?:ever\s+)?(?:needing|requiring|asking|requesting|collecting|storing|sharing|demanding)\b/i;

export const NEGATION = new RegExp(
  `${VERB_NEGATION.source}|${REQUIREMENT_NEGATION.source}|${WITHOUT_ACTION_NEGATION.source}`,
  "i",
);

/** How far back to look for a negator before treating a match as a real ask. */
export const NEGATION_WINDOW = 42;

export const OVERREACH = [
  {
    code: "OVERREACH_CREDENTIALS",
    re: directed(String.raw`(?:api[_\s-]?keys?|secret[_\s-]?keys?|access[_\s-]?tokens?|bearer\s+tokens?|passwords?|credentials?)\b`),
    what: "credentials",
  },
  {
    code: "OVERREACH_ENV",
    re: directed(String.raw`(?:\.env\b|environment\s+variables?|env\s+file)`),
    what: "environment file",
  },
  {
    code: "OVERREACH_REPO",
    re: directed(String.raw`(?:full|complete|entire|write|admin|root)\s+(?:repo|repository|codebase|filesystem|disk|drive)\s+access`),
    what: "whole-repository access",
  },
  {
    code: "OVERREACH_SHELL",
    re: directed(String.raw`(?:shell|terminal|bash|command)\s+access|\brun\s+arbitrary\s+(?:code|commands?)`),
    what: "arbitrary command execution",
  },
  {
    code: "OVERREACH_BILLING",
    re: directed(String.raw`(?:billing|payment|card|wallet|bank)\s+(?:details|access|credentials|information)`),
    what: "payment authority",
  },
  {
    code: "OVERREACH_STANDING",
    re: directed(String.raw`(?:permanent|standing|unlimited|unrestricted|ongoing|persistent)\s+(?:access|permission|authority|grant)`),
    what: "standing authority",
  },
];

/**
 * Numbers presented as evidence with nothing behind them.
 *
 * The match itself is quoted back to the seller, so this one has to start at
 * the first digit of the number or the receipt misquotes the listing it is
 * judging. See `NUMBER`.
 *
 * The closing `\b` belongs to the noun branch alone. It used to sit after both,
 * which asks for a word boundary immediately after "%" — and "%" followed by a
 * space is two non-word characters, so there is no boundary there and never
 * could be. The percentage half of this rule matched nothing at all: "99.9%
 * acceptance" was silently unscored on every listing that claimed one.
 */
export const UNSOURCED_STAT = new RegExp(
  String.raw`\b(?:${DECIMAL}%|(?:${NUMBER})\+?\s*(?:completed\s+)?(?:jobs|clients|customers|users|deliveries|contracts)\b)`,
  "gi",
);
