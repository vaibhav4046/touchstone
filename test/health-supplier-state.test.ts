import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { supplierHealth } from "../lib/assay/llm";
import { GET } from "../app/api/health/route";

/**
 * The claim under test: health reports what the suppliers did, not what the
 * environment file says.
 *
 * The defect was `ok: true` while Groq was rate limited, OpenRouter was out of
 * credit and Gemini was rate limited — three keys present, nothing answering,
 * green light. An agent reading that spent twelve credits to be told no. So
 * these tests drive the tracked state directly and check the field an agent
 * would actually branch on.
 */

const KEYS = ["GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"] as const;

/**
 * The store `lib/assay/llm` records every call into. Seeding it stands in for a
 * live outage, which is the only way to exercise this without either a network
 * call or a fake clock. Reached through a cast rather than a second `declare
 * global`, because redeclaring it here would fork the type.
 */
interface SupplierRecord {
  answered: number;
  refused: number;
  lastOk?: boolean;
  lastCode?: string;
  lastAt?: string;
}

function store(): Map<string, SupplierRecord> {
  const global = globalThis as unknown as { __yuzuSupplierHealth?: Map<string, SupplierRecord> };
  return (global.__yuzuSupplierHealth ??= new Map());
}

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    process.env[key] = "test-key";
  }
  store().clear();
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  store().clear();
});

function seed(states: Readonly<Record<string, { ok: boolean; code?: string }>>): void {
  for (const [supplier, { ok, code }] of Object.entries(states)) {
    store().set(supplier, {
      answered: ok ? 1 : 0,
      refused: ok ? 0 : 1,
      lastOk: ok,
      lastCode: code,
      lastAt: new Date().toISOString(),
    });
  }
}

async function health(): Promise<Record<string, unknown>> {
  return (await (await GET()).json()) as Record<string, unknown>;
}

describe("health reflects supplier reality", () => {
  it("reports down, not ok, when every configured supplier is refusing", async () => {
    // Exactly the production outage: rate limit, no credit, rate limit.
    seed({
      groq: { ok: false, code: "http_429" },
      openrouter: { ok: false, code: "openrouter_http_402" },
      gemini: { ok: false, code: "gemini_429" },
    });

    const body = await health();

    // The defect, in the one field a monitor looks at.
    expect(body.ok).toBe(false);
    expect(body.status).toBe("down");
    // And the field an agent should branch on before spending.
    expect(body.fulfilment).toBe("house-template");
    expect(String(body.fulfilmentNote)).toContain("charged nothing");
    // Which supplier refused, and with what. "It is broken" is not actionable.
    const summary = body.supplierSummary as { refusing: string[]; answering: string[] };
    expect(summary.answering).toEqual([]);
    expect(summary.refusing).toEqual([
      "groq (http_429)",
      "openrouter (openrouter_http_402)",
      "gemini (gemini_429)",
    ]);
    // No model is reachable, so no model-derived analysis may be advertised.
    expect(body.analysis).toBe("deterministic");
  });

  it("reports degraded, and still ok, when one supplier still answers", async () => {
    seed({
      groq: { ok: false, code: "http_429" },
      openrouter: { ok: false, code: "openrouter_http_402" },
      gemini: { ok: true },
    });

    const body = await health();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("degraded");
    // A seller can still be asked, so a deal still goes to a seller.
    expect(body.fulfilment).toBe("seller");
    expect((body.supplierSummary as { answering: string[] }).answering).toEqual(["gemini"]);
  });

  it("says untested rather than inventing a green light on a cold instance", async () => {
    const body = await health();
    expect(body.status).toBe("untested");
    expect((body.supplierSummary as { untested: string[] }).untested).toHaveLength(3);
    expect(String(body.fulfilmentNote)).toContain("No call has gone through this instance yet");
  });

  it("is down when no supplier is configured at all", async () => {
    for (const key of KEYS) delete process.env[key];
    const body = await health();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("down");
    expect(body.fulfilment).toBe("house-template");
  });

  it("does not count a missing key as a supplier that let us down", async () => {
    delete process.env.GEMINI_API_KEY;
    const configured = supplierHealth().filter((supplier) => supplier.configured);
    expect(configured.map((supplier) => supplier.supplier)).toEqual(["groq", "openrouter"]);
    expect(supplierHealth().find((supplier) => supplier.supplier === "gemini")?.state).toBe("untested");
  });
});
