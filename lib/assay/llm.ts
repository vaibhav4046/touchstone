/**
 * Groq transport.
 *
 * Every call is bounded and every failure is a value, never a throw. Touchstone
 * is bought by agents that are themselves on a clock; a hung upstream must
 * degrade the report, not lose it.
 */

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

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
  const key = process.env.GROQ_API_KEY;
  return typeof key === "string" && key.length > 0;
}

export async function complete(options: {
  readonly model: string;
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}): Promise<LlmOutcome> {
  // Two retries with a widening gap, and only for the failures that are about
  // the upstream being busy rather than the request being wrong. A burst of
  // assay calls followed by proof challenges is exactly the shape that trips a
  // rate limit, and a dropped call there does not just lose a dimension — it
  // fails a seller for something the seller did not do.
  let last = await attempt(options);
  for (const wait of [700, 2200]) {
    if (last.ok || !RETRYABLE.test(last.error ?? "")) return last;
    await new Promise((resolve) => setTimeout(resolve, wait));
    const again = await attempt(options);
    if (again.ok) return again;
    last = again;
  }

  /**
   * A second supplier, for the hour that matters.
   *
   * Retrying a rate limit harder is still asking the same exhausted account.
   * The Arena runs for two hours under sustained load from every agent in the
   * room, and a market that stops trading because one provider is busy is not a
   * market. Gemini answers the analyst calls when Groq will not.
   *
   * The classifier has no second supplier — prompt-guard is a specific model,
   * not a capability — so when Groq is out the injection score is simply
   * missing, and the report says so rather than substituting a general model's
   * opinion for a measurement.
   */
  if (RETRYABLE.test(last.error ?? "") && options.model === MODELS.analyst) {
    const fallback = await viaGemini(options);
    if (fallback.ok) return fallback;
    // Both suppliers are out. Reporting only the first one's error says
    // "http_429" and hides the fact that a second account was asked and also
    // refused, which reads as a provider having a bad minute rather than as a
    // capacity problem with the whole chain. The receipt should be able to tell
    // an operator which of those it is.
    return { ...last, error: `${last.error ?? "unknown"}+${fallback.error ?? "unknown"}` };
  }

  return last;
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

const RETRYABLE = /^http_(429|5\d\d)$/;

async function attempt(options: {
  readonly model: string;
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}): Promise<LlmOutcome> {
  const key = process.env.GROQ_API_KEY;
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
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
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
      return { ok: false, text: "", ms: Date.now() - started, error: `http_${response.status}` };
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
      error: text.length > 0 ? undefined : "empty",
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
