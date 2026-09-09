/**
 * Lines the request model writes that are about us, not about the work.
 *
 * The goal-to-request model is handed a budget and a schema, and it turns both
 * into requirements. "budget <= 22 Arena credits" comes straight out of its own
 * prompt. The expensive one is "deliverable <= 10 words", which is the model
 * reading the schema's description of the `deliverable` field — "one sentence
 * naming the artifact" — as a limit on the work itself.
 *
 * The delivery prompt puts constraints last, as a checklist to run the finished
 * work against. That is the right place for them and it is what made this so
 * costly: a seller that follows instructions well obeys a bad instruction
 * exactly. A competitor brief came back as the forty-character string
 * "Competitor Brief for Coffee Brand Launch", and the verifier rejected it, and
 * the seller was not paid for work our own request had ruined. Three live runs,
 * perfectly correlated: with that line the delivery was 71 to 74 characters,
 * without it, 1838.
 *
 * The distinction that matters is between a limit on the artifact the buyer
 * asked for and a limit on the wrapper we put around it. "each tagline no more
 * than 8 words" is the entire point of a constraint and is kept. Only the
 * wrapper is noise, and the wrapper is the thing the buyer never named.
 */
export const PROCUREMENT_NOISE: readonly RegExp[] = [
  // The price. Enforced by the negotiation and by the grant, so a seller that
  // sees it can only be confused by it.
  /\b(?:budget|credits?|price|cost|spend|pay(?:ment)?)\b/i,
  // A cap on the deliverable itself rather than on anything inside it. Bounded
  // to the same clause so it cannot reach across a sentence and swallow a real
  // requirement that happens to mention words.
  /\bdeliverabl\w*\b[^.]{0,24}\b(?:word|character|line|page|sentence)s?\b/i,
  // A deadline. The contract already carries one, in seconds.
  /\b(?:business|working)\s+days?\b|\bturnaround\b|\bdeliver(?:y|ed)\s+(?:with)?in\b/i,
];

/** True when this line is ours rather than the buyer's, and must not reach a seller. */
export function isProcurementNoise(line: string): boolean {
  return PROCUREMENT_NOISE.some((pattern) => pattern.test(line));
}
