import { describe, expect, it } from "vitest";
import { runRound } from "../lib/arena/participant";
import type { RoundOneResult, RoundTwoResult } from "../lib/arena/participant";
import { resetLedger, ledger } from "../lib/arena/ledger";

/**
 * The Arena rules are about trying other people's products and spending real
 * credits on them. A round that fills its quota from our own market is a
 * rehearsal, and a live call once returned five ranked products, every one of
 * them ours, with `meetsRule: true` printed beside them. Disclosing the top-up
 * in the prose was not enough: the machine-readable field a judge or a script
 * would actually read still claimed compliance.
 */
describe("the Arena rounds refuse to count our own market", () => {
  it("marks house entries and does not let them satisfy the product floor", async () => {
    const result = (await runRound({ round: 1, candidates: [] })) as RoundOneResult;

    expect(result.ranking.length).toBeGreaterThan(0);
    // Everything here came from our own registry.
    expect(result.ranking.every((entry) => entry.house === true)).toBe(true);
    expect(result.meetsRule).toBe(false);
    expect(result.shortfall.join(" ")).toContain("competing product");
    // And the post says so where a reader will actually see it.
    expect(result.post).toContain("ours, does not count");
  }, 120_000);

  it("spends no Arena credits inside our own market", async () => {
    resetLedger();
    await runRound({ round: 1, candidates: [] });
    const result = (await runRound({ round: 2, candidates: [] })) as RoundTwoResult;

    // Nothing to buy that is not ours, so nothing is bought and the ledger is
    // untouched. Buying from our own market with the scoreboard's money would
    // be the single easiest thing for a rival to point at.
    expect(ledger().purchases.length).toBe(0);
    expect(result.purchases.length).toBe(0);
    expect(result.plan.allocations.length).toBe(0);
  }, 120_000);
});

/**
 * The Arena hands us endpoints out of a request body and we fetch them from our
 * own server. That is an SSRF boundary, and it had only a `^https?://` test: a
 * rival could have listed the cloud metadata address and had us fetch it and
 * hand the body back inside the trial excerpt.
 */
describe("the Arena will not fetch a private address for a competitor", () => {
  const hostile = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1:9/trial",
    "http://localhost/admin",
    "http://10.0.0.5/internal",
    "http://[::1]/trial",
    "file:///etc/passwd",
  ];

  it("refuses each one before the request is made, and says so in the record", async () => {
    const result = (await runRound({
      round: 1,
      candidates: hostile.map((endpoint, index) => ({
        name: `Probe${index}`,
        pitch: "A competitor listing that points somewhere it should not be able to reach.",
        endpoint,
      })),
    })) as RoundOneResult;

    for (const entry of result.ranking.filter((row) => row.product.startsWith("Probe"))) {
      expect(entry.trial.answered).toBe(false);
      // `attempted: false` is the security property: not "we called it and it
      // failed", but "we never made the call".
      expect(entry.trial.attempted).toBe(false);
      expect(entry.trial.note).toMatch(/private, loopback, link-local or metadata address|only call http and https/);
    }
  }, 120_000);
});
