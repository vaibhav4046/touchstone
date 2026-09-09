/**
 * Does the market actually pay anybody?
 *
 * Runs the real broker against the real suppliers N times and reports what came
 * back: who delivered, whether the verifier accepted it, what was paid, and
 * whether the "delivery" was really a refusal wearing a JSON hat. Nothing is
 * mocked, because the thing under test is a prompt and a mocked model cannot
 * fail the way a real one does.
 *
 * This exists because a market can be green on every test and still pay nobody.
 * Three separate live regressions were invisible to the suite: sellers asking
 * clarifying questions, sellers filing an assumption instead of the work, and
 * sellers returning `{"error": "Missing input: ..."}` for a brief that named a
 * one-pager the protocol has no way to attach. Each was a prompt, each was
 * caught by running deals and reading them, and this is the shortest path back
 * to that evidence.
 *
 * Node reads the keys itself, so there is no dotenv here and no dependency
 * added for one line:
 *
 *   node --env-file=.env.local --import tsx scripts/delivery-check.mts
 *   node --env-file=.env.local --import tsx scripts/delivery-check.mts 8
 *   node --env-file=.env.local --import tsx scripts/delivery-check.mts 4 "a different goal"
 */
import { runBroker } from "../lib/market/broker";

const RUNS = Number(process.argv[2] ?? 4);
const GOAL = process.argv[3] ?? "Turn my coffee brand one-pager into a six-shot list for a launch film";

/** The three shapes a refusal has taken, as text rather than as a status. */
const REFUSAL = /"error"\s*:|\bnot provided\b|\bplease provide\b|\bmissing input\b|\bto be defined\b/i;

let paid = 0;
let accepted = 0;
let refusalShaped = 0;

console.log(`${RUNS} deals: ${GOAL}\n`);

for (let index = 0; index < RUNS; index += 1) {
  const started = Date.now();
  const outcome = await runBroker({ goal: GOAL, budget: 22, buyerId: `check-${index}`, traceId: `chk_${index}` });
  const output = outcome.delivery?.output ?? "";
  const looksLikeRefusal = REFUSAL.test(output);

  if (looksLikeRefusal) refusalShaped += 1;
  if (outcome.verification?.accepted === true) accepted += 1;
  if ((outcome.settlement?.paid ?? 0) > 0) paid += 1;

  console.log(
    JSON.stringify({
      run: index + 1,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      by: outcome.delivery?.deliveredBy,
      paid: outcome.settlement?.paid,
      consumed: outcome.settlement?.consumed,
      accepted: outcome.verification?.accepted,
      chars: output.length,
      looksLikeRefusal,
      unfilled: outcome.unfilled,
      upstream: outcome.delivery?.upstream,
      head: output.slice(0, 100).replace(/\s+/g, " "),
    }),
  );
}

console.log(
  `\npaid ${paid}/${RUNS} · accepted ${accepted}/${RUNS} · refusal-shaped ${refusalShaped}/${RUNS}` +
    (refusalShaped > 0 ? "\nA refusal-shaped delivery is a prompt bug, not a seller being difficult." : ""),
);
