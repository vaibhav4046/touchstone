/**
 * What happens when every model supplier is gone.
 *
 * F-03 was fixed and unit-verified and never exercised: the guard was proven
 * by `attemptWindow`, but nothing had run the assay with the whole bench dead.
 * That is the Arena condition -- every agent in the room calling every other
 * for two hours -- so leaving it untested was leaving the most likely failure
 * untested.
 *
 * This removes every credential from the process and runs the real engine. Three
 * things have to hold, and they are the difference between a degraded market and
 * a broken one:
 *
 *   1. It answers. A verdict comes back, not an exception and not a hang.
 *   2. It answers inside the route's 120-second ceiling. Past that the platform
 *      kills the call and the buyer gets no receipt at all.
 *   3. It says the analysis was degraded rather than passing a rule-only score
 *      off as the full one.
 *
 *   node --import tsx scripts/exhaustion-check.mts
 */
for (const key of [
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "BAZAARLINK_API_KEY",
  "TOUCHSTONE_OPERATOR_KEY",
]) {
  delete process.env[key];
}

const { assay } = await import("../lib/assay/engine");

const LISTING = {
  vendor: "ExhaustionCheck",
  pitch:
    "ExhaustionCheck renders one 9:16 product video per request. Price: 6 Arena credits per video. " +
    "Delivery under 180 seconds. Output: an MP4 URL plus the shot list as JSON. " +
    "Samples: https://github.com/example/exhaustioncheck",
  askingPrice: 6,
  buyerId: "exhaustion",
};

/** The route's platform ceiling. Past this the buyer gets nothing at all. */
const ROUTE_CEILING_MS = 120_000;

console.log("Every supplier credential removed from this process.\n");

const started = Date.now();
const { receipt } = await assay(LISTING);
const elapsed = Date.now() - started;

const report = receipt.report;
const analystRan = report.analysis.includes("model");

console.log(`verdict            ${report.verdict}`);
console.log(`score              ${report.score}`);
console.log(`deterministicScore ${report.deterministicScore}`);
console.log(`analysis           ${report.analysis}`);
console.log(`notChecked         ${JSON.stringify(report.notChecked)}`);
console.log(`elapsed            ${(elapsed / 1000).toFixed(1)}s of a ${ROUTE_CEILING_MS / 1000}s ceiling`);
console.log(`signed receipt     ${receipt.receiptId}`);

const failures: string[] = [];
if (elapsed >= ROUTE_CEILING_MS) failures.push(`took ${elapsed}ms, past the ${ROUTE_CEILING_MS}ms route ceiling`);
if (report.verdict === undefined) failures.push("no verdict");
if (receipt.receiptId === undefined) failures.push("no signed receipt");
if (analystRan) failures.push(`analysis claims a model ran (${report.analysis}) with no credentials present`);
if (report.dimensions.length === 0) failures.push("no dimensions scored");

console.log(
  failures.length === 0
    ? "\nHELD: answered, in time, signed, and honest that the model half did not run."
    : `\nFAILED:\n  ${failures.join("\n  ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
