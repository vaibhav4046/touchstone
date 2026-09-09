import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS, complete } from "../lib/assay/llm";

/**
 * Groq meters tokens per day per *model*, not per key.
 *
 * The refusal says so in as many words: "Rate limit reached for model
 * `openai/gpt-oss-120b` ... on tokens per day (TPD): Limit 200000, Used
 * 199611." So a second model on the same key is a second 200,000 rather than
 * the same empty pot — which is the difference between roughly thirty deals a
 * day and enough to trade through an Arena night on a free account.
 *
 * These drive `fetch` directly rather than the network: the property under test
 * is which model gets asked after a refusal, and a test that needed a genuinely
 * exhausted quota to run would only pass on the worst day of the month.
 */
const ORIGINAL = globalThis.fetch;
const ORIGINAL_KEY = process.env.GROQ_API_KEY;

beforeEach(() => {
  // `attempt` refuses before it ever reaches fetch when no key is configured,
  // and the suite runs without one. The value is never sent anywhere: every
  // request in this file is answered by the stub below.
  process.env.GROQ_API_KEY = "test-key-never-sent-anywhere";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL;
  if (ORIGINAL_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
});

function rateLimited(model: string): Response {
  return new Response(
    JSON.stringify({
      error: { message: `Rate limit reached for model \`${model}\` on tokens per day (TPD): Limit 200000` },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
}

function answered(text: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Refuses every model named in `exhausted`, answers for anything else. */
function bench(exhausted: readonly string[]): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const model = (JSON.parse(String(init.body)) as { model: string }).model;
    asked.push(model);
    return exhausted.includes(model) ? rateLimited(model) : answered(`answered by ${model}`);
  }) as typeof fetch;
  return asked;
}

describe("the analyst bench spends a second model's budget rather than giving up", () => {
  it("moves sideways to the next Groq model when the primary is out of daily tokens", async () => {
    const asked = bench([MODELS.analyst]);

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 50 });

    expect(outcome.ok).toBe(true);
    // It must actually say who answered. A score from a different model is not
    // comparable to one from the primary, and hiding the swap would be the kind
    // of unfalsifiable claim this service exists to catch.
    expect(outcome.model).toBe("openai/gpt-oss-20b");
    expect(outcome.text).toContain("gpt-oss-20b");
    expect(asked[0]).toBe(MODELS.analyst);
    expect(asked).toContain("openai/gpt-oss-20b");
  });

  it("keeps walking the bench while models keep refusing", async () => {
    const asked = bench([MODELS.analyst, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 50 });

    expect(outcome.ok).toBe(true);
    expect(outcome.model).toBe("groq/compound-mini");
    // Every model on the bench was tried, in order, before anything else was.
    expect(asked.slice(0, 4)).toEqual([
      MODELS.analyst,
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "groq/compound-mini",
    ]);
  });

  it("names every model that refused when the whole bench is out", async () => {
    bench([MODELS.analyst, "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "groq/compound-mini"]);

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 50 });

    expect(outcome.ok).toBe(false);
    // One code hides that the whole bench is out and reads as a bad minute.
    expect(outcome.error).toContain("gpt-oss-20b");
    expect(outcome.error).toContain("compound-mini");
  });

  it("does not walk the bench for the classifier, which has no substitute", async () => {
    const asked = bench([MODELS.guard]);

    const outcome = await complete({ model: MODELS.guard, user: "anything", maxTokens: 50 });

    expect(outcome.ok).toBe(false);
    // prompt-guard is a specific measurement, not a capability. Substituting a
    // general model's opinion for it would be inventing a number.
    expect(asked.every((model) => model === MODELS.guard)).toBe(true);
  });
});

/**
 * A second key only helps if it is a second organisation.
 *
 * Groq's daily budget is per organisation and per model. Two keys issued from
 * the same account share one pot — established the hard way: five requests
 * spent on the first dropped the second's `x-ratelimit-remaining-requests` by
 * the same five. So the rotation exists for a key from a *different* account,
 * and the list is comma-separated so adding one is configuration rather than a
 * deploy.
 */
describe("a second Groq key is a second bench", () => {
  it("walks every model on the first key before touching the second", async () => {
    process.env.GROQ_API_KEY = "key-one,key-two";
    const seen: { key: string; model: string }[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      const key = String((init.headers as Record<string, string>).authorization).replace("Bearer ", "");
      seen.push({ key, model });
      // Everything on key-one is out; key-one's whole bench must be tried first.
      return key === "key-one" ? rateLimited(model) : answered(`answered by ${key}`);
    }) as typeof fetch;

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 50 });

    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain("key-two");
    // All four models on the first key, then the first model on the second.
    expect(seen.filter((call) => call.key === "key-one")).toHaveLength(4);
    expect(seen.at(-1)).toEqual({ key: "key-two", model: MODELS.analyst });
  });

  it("stops the moment a refusal is not about capacity", async () => {
    process.env.GROQ_API_KEY = "key-one,key-two";
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push((JSON.parse(String(init.body)) as { model: string }).model);
      // A bad key is not a busy one, and eight round trips to prove that would
      // eat the route's whole budget.
      return new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
    }) as typeof fetch;

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 50 });

    expect(outcome.ok).toBe(false);
    // The primary, then one sideways step that also 401s, and no further.
    expect(seen.length).toBeLessThanOrEqual(2);
  });
});
