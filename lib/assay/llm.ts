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
  const first = await attempt(options);
  // One retry, and only for the two failures that are about the upstream being
  // busy rather than the request being wrong. A dropped dimension changes the
  // score's denominator, so losing one to a transient 429 is a worse outcome
  // than waiting 700ms.
  if (first.ok || !RETRYABLE.test(first.error ?? "")) return first;
  await new Promise((resolve) => setTimeout(resolve, 700));
  const second = await attempt(options);
  return second.ok ? second : first;
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
      choices?: ReadonlyArray<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return { ok: text.length > 0, text, ms: Date.now() - started, error: text.length > 0 ? undefined : "empty" };
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
