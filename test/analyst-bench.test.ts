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
const ORIGINAL_BAZAAR = process.env.BAZAARLINK_API_KEY;
const ORIGINAL_OPENROUTER = process.env.OPENROUTER_API_KEY;
const ORIGINAL_GEMINI = process.env.GEMINI_API_KEY;

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
  if (ORIGINAL_BAZAAR === undefined) delete process.env.BAZAARLINK_API_KEY;
  else process.env.BAZAARLINK_API_KEY = ORIGINAL_BAZAAR;
  if (ORIGINAL_OPENROUTER === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER;
  if (ORIGINAL_GEMINI === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI;
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

/**
 * BazaarLink's free tier, and the two things it needs to be usable.
 *
 * Free in the literal sense — the response carries `cost: 0` — but not
 * unlimited, and worth pinning down before anyone builds on the assumption. The
 * refusal reads "The site-wide free-model capacity is currently full. This is
 * not your personal quota", and the headers say `x-ratelimit-limit: 10` with
 * `x-ratelimit-scope: global`. Ten slots shared with every other user.
 *
 * Two contract details that are easy to get wrong and silent when you do: the
 * free tier only routes `auto:free` (every named model answers 402 without
 * credit), and the model it resolves to spends its entire budget reasoning
 * unless told not to — a 400-token call returned 400 reasoning tokens and an
 * empty `content`.
 */
describe("the BazaarLink fallback asks for the only thing its free tier serves", () => {
  it("sends auto:free with reasoning disabled, after the Groq bench is spent", async () => {
    process.env.GROQ_API_KEY = "key-one";
    process.env.BAZAARLINK_API_KEY = "bazaar-key";
    const sent: { host: string; model: string; reasoning: unknown }[] = [];

    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string; reasoning?: unknown };
      const host = new URL(String(url)).host;
      sent.push({ host, model: body.model, reasoning: body.reasoning });
      if (host.includes("groq")) return rateLimited(body.model);
      if (host.includes("bazaarlink")) return answered("answered by bazaarlink");
      return rateLimited(body.model);
    }) as typeof fetch;

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 800 });

    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain("bazaarlink");

    const bazaar = sent.find((call) => call.host.includes("bazaarlink"));
    expect(bazaar).toBeDefined();
    // The named models all answer 402 on the free tier; auto:free is the only
    // thing that routes.
    expect(bazaar?.model).toBe("auto:free");
    // Without this the whole budget goes to reasoning and content comes back
    // empty, which this code would report as the supplier answering nothing.
    expect(bazaar?.reasoning).toEqual({ enabled: false });

    // And it is asked only after Groq's own bench is spent, because free
    // capacity shared with strangers cannot be the backbone.
    expect(sent.filter((call) => call.host.includes("groq"))).toHaveLength(4);
  });
});
describe("external suppliers carry the load when Groq is exhausted or absent", () => {
  it("names bazaarlink/auto:free on the outcome when BazaarLink answers", async () => {
    process.env.GROQ_API_KEY = "key-one";
    process.env.BAZAARLINK_API_KEY = "bazaar-key";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      const host = new URL(String(url)).host;
      if (host.includes("groq")) return rateLimited(body.model);
      if (host.includes("bazaarlink")) return answered("bazaar answer");
      return rateLimited(body.model);
    }) as typeof fetch;

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 100 });
    expect(outcome.ok).toBe(true);
    expect(outcome.model).toBe("bazaarlink/auto:free");
  });

  it("reaches OpenRouter and reports its model when Groq has no key", async () => {
    delete process.env.GROQ_API_KEY;
    process.env.OPENROUTER_API_KEY = "openrouter-key";

    globalThis.fetch = (async (url: string, _init: RequestInit) => {
      const host = new URL(String(url)).host;
      if (host.includes("openrouter")) return answered("openrouter answer");
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const outcome = await complete({ model: MODELS.analyst, user: "anything", maxTokens: 100 });
    expect(outcome.ok).toBe(true);
    expect(outcome.model).toBe("openrouter/openai/gpt-oss-120b");
  });
});
