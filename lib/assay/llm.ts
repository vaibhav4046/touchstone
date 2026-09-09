/**
 * Groq transport.
 *
 * Every call is bounded and every failure is a value, never a throw. Touchstone
 * is bought by agents that are themselves on a clock; a hung upstream must
 * degrade the report, not lose it.
 */

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const MODELS = {
  /** General analyst. Large context, strong instruction-following. */
  analyst: "openai/gpt-oss-120b",
  /** Purpose-built prompt-injection / jailbreak classifier. Returns a probability. */
  guard: "meta-llama/llama-prompt-guard-2-86m",
} as const;

export interface LlmOutcome {
  readonly ok: boolean;
  readonly text: string;
  readonly ms: number;
  readonly error?: string;
  /** The provider stopped because it ran out of budget, not because it was done. */
  readonly truncated?: boolean;
}

export function llmAvailable(): boolean {
  // Any supplier on the bench counts. Gating on Groq alone meant a deployment
  // with only the fallbacks configured reported itself as having no model at
  // all and skipped every dimension it could in fact have run.
  return [process.env.GROQ_API_KEY, process.env.OPENROUTER_API_KEY, process.env.GEMINI_API_KEY].some(
    (key) => typeof key === "string" && key.length > 0,
  );
}

export async function complete(options: {
  readonly model: string;
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}): Promise<LlmOutcome> {
  // Retry the upstream being briefly unwell; fail over when it is out.
  //
  // These are different facts and they used to share a branch. A 5xx or a
  // timeout is worth asking again, because the next call may well land. A 429
  // is the account saying it has no room, and asking it twice more on a
  // widening backoff spends about three seconds proving that — three seconds
  // per call, against a route that has to finish eight stages inside 120.
  // Under the load the Arena actually produces, that was most of the budget
  // spent on being told no.
  let last = await attempt(options);
  if (!last.ok && TRANSIENT.test(last.error ?? "")) {
    for (const wait of [700, 2200]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      const again = await attempt(options);
      if (again.ok) return again;
      last = again;
      if (!TRANSIENT.test(last.error ?? "")) break;
    }
  }
  if (last.ok || !RETRYABLE.test(last.error ?? "") || options.model !== MODELS.analyst) return last;

  /**
   * The rest of the bench, in the order that changes the answer least.
   *
   * Retrying a rate limit harder is still asking the same exhausted account.
   * The Arena runs for two hours under sustained load from every agent in the
   * room, and a market that stops trading because one provider is busy is not a
   * market.
   *
   * OpenRouter comes first because it serves the *same* analyst model, so a
   * failover there costs nothing but latency: the scores stay comparable with
   * the ones Groq produced a minute earlier. Gemini is a different model with
   * different opinions, so it is the supplier of last resort rather than the
   * second choice — a score that silently changed model is a score nobody can
   * compare to the one before it.
   *
   * The classifier has no substitute at all — prompt-guard is a specific model,
   * not a capability — so when Groq is out the injection score is simply
   * missing, and the report says so rather than substituting a general model's
   * opinion for a measurement.
   */
  const codes = [last.error ?? "unknown"];
  for (const supplier of [viaOpenRouter, viaGemini]) {
    const next = await supplier(options);
    if (next.ok) return next;
    codes.push(next.error ?? "unknown");
  }

  // Every supplier refused. Reporting only the first one's code says "http_429"
  // and hides that the whole bench is out, which reads as one provider having a
  // bad minute rather than as a capacity problem an operator has to fix.
  return { ...last, error: codes.join("+") };
  return last;
}

/**
 * OpenRouter, over the identical wire protocol Groq uses.
 *
 * Same model, same request shape, same response shape — the only differences
 * are the host, the key and the error prefix. Writing the transport twice would
 * be two places for a parsing bug to live.
 */
async function viaOpenRouter(options: {
  readonly model: string;
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}): Promise<LlmOutcome> {
  const key = process.env.OPENROUTER_API_KEY;
  if (key === undefined || key.length === 0) return { ok: false, text: "", ms: 0, error: "no_openrouter_key" };
  return attempt(options, {
    endpoint: OPENROUTER_ENDPOINT,
    key,
    prefix: "openrouter",
    // OpenRouter asks callers to identify themselves, and a market that will
    // not say who it is has no business lecturing sellers about listings.
    headers: {
      "http-referer": "https://yuzu-market.vercel.app",
      "x-title": "Yuzu",
    },
  });
}

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.6-flash";

async function viaGemini(options: {
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}): Promise<LlmOutcome> {
  const key = process.env.GEMINI_API_KEY;
  const started = Date.now();
  if (key === undefined || key.length === 0) return { ok: false, text: "", ms: 0, error: "no_fallback_key" };

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: options.user }] }],
        ...(options.system === undefined ? {} : { systemInstruction: { parts: [{ text: options.system }] } }),
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 1400,
          temperature: options.temperature ?? 0,
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    });

    if (!response.ok) return { ok: false, text: "", ms: Date.now() - started, error: `gemini_${response.status}` };

    const body = (await response.json()) as {
      candidates?: ReadonlyArray<{ content?: { parts?: ReadonlyArray<{ text?: string }> }; finishReason?: string }>;
    };
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return {
      ok: text.length > 0,
      text,
      ms: Date.now() - started,
      error: text.length > 0 ? undefined : "gemini_empty",
      truncated: candidate?.finishReason === "MAX_TOKENS",
    };
  } catch (error) {
    return { ok: false, text: "", ms: Date.now() - started, error: error instanceof Error ? error.name : "unknown" };
  }
}

/** Worth asking the whole bench about. */
const RETRYABLE = /^http_(429|5\d\d)$/;
/** Worth asking the same supplier about again. A 429 is not: it has no room. */
const TRANSIENT = /^(?:http_5\d\d|TimeoutError|AbortError)$/;

/** Where an OpenAI-compatible call goes, and how its failures are named. */
interface Supplier {
  readonly endpoint: string;
  readonly key: string;
  /** Prefixes the status code, so a receipt says which bench refused. */
  readonly prefix?: string;
  readonly headers?: Record<string, string>;
}

async function attempt(
  options: {
    readonly model: string;
    readonly system?: string;
    readonly user: string;
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly timeoutMs?: number;
  },
  supplier?: Supplier,
): Promise<LlmOutcome> {
  const key = supplier?.key ?? process.env.GROQ_API_KEY;
  const endpoint = supplier?.endpoint ?? ENDPOINT;
  const tag = supplier?.prefix === undefined ? "http" : `${supplier.prefix}_http`;
  const started = Date.now();
  if (key === undefined || key.length === 0) {
    return { ok: false, text: "", ms: 0, error: "no_api_key" };
  }

  const messages = options.system
    ? [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ]
    : [{ role: "user", content: options.user }];

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...(supplier?.headers ?? {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        max_completion_tokens: options.maxTokens ?? 1400,
        // Zero, because this number ends up in a score someone is asked to
        // trust. It does not make the model deterministic — sampling is only
        // one source of drift — but it removes the one this code controls.
        temperature: options.temperature ?? 0,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    });

    if (!response.ok) {
      return { ok: false, text: "", ms: Date.now() - started, error: `${tag}_${response.status}` };
    }

    const body = (await response.json()) as {
      choices?: ReadonlyArray<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? "";
    return {
      ok: text.length > 0,
      text,
      ms: Date.now() - started,
      error: text.length > 0 ? undefined : `${supplier?.prefix ?? "groq"}_empty`,
      truncated: choice?.finish_reason === "length",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    return { ok: false, text: "", ms: Date.now() - started, error: reason };
  }
}

/** Extracts the first JSON object or array in a model response. */
export function parseJson<T>(text: string): T | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  const opener = candidate[start];
  const closer = opener === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
