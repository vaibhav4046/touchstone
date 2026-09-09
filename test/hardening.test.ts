import { afterEach, describe, expect, it, vi } from "vitest";
import { sign, signingKey, verify } from "../lib/assay/receipt";
import { deterministicScore } from "../lib/assay/score";
import { probeDimension } from "../lib/assay/engine";
import { steeringResistance } from "../lib/assay/injection";
import { requestEscalation, getEscalation } from "../lib/sharedos/escalation";
import type { DimensionResult } from "../lib/assay/types";

/** `after()` needs a request scope. These tests call the route directly. */
vi.mock("next/server", () => ({ after: () => undefined }));

/**
 * The classifier is a hosted service, so "unavailable" is a normal Tuesday.
 * Hoisted so the module factory below can read it without a TDZ hazard.
 */
const upstream = vi.hoisted(() => ({ guard: undefined as number | undefined }));

vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();
  return {
    ...actual,
    complete: async (options: { model: string }) =>
      options.model === actual.MODELS.guard && upstream.guard !== undefined
        ? { ok: true, text: String(upstream.guard), ms: 1 }
        : { ok: false, text: "", ms: 1, error: "429 Too Many Requests" },
  };
});

const CLEAN = `RenderKit produces one 9:16 product video per request.
Price: 6 Arena credits per video. Delivery under 180 seconds.
Output: an MP4 URL plus the shot list as JSON.`;

afterEach(() => {
  upstream.guard = undefined;
  delete process.env.VERCEL;
  delete process.env.TOUCHSTONE_OPERATOR_KEY;
});

describe("signing key", () => {
  // There are two keys and they refuse for different reasons: signingKey() is
  // the HMAC that seals escalation tickets, sign()/verify() are Ed25519 over
  // receipts. Both assertions used to read /TOUCHSTONE_SIGNING_KEY/, and the
  // receipt one passed only because the Ed25519 error's parenthetical mentions
  // the old variable while explaining that receipts no longer use it. A test
  // that names one refusal and is satisfied by another is not testing either,
  // so each now asserts the variable its own call site is actually about.
  it("refuses to sign or verify with the committed default in production", () => {
    expect(process.env.TOUCHSTONE_SIGNING_KEY).toBeUndefined();
    expect(process.env.TOUCHSTONE_SIGNING_SECRET).toBeUndefined();
    process.env.VERCEL = "1";

    expect(() => signingKey()).toThrow(/TOUCHSTONE_SIGNING_KEY is not set/);
    expect(() =>
      sign({
        version: "touchstone.receipt.v1",
        receiptId: "rcp_test",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        issuer: "touchstone",
        buyerId: "buyer",
        purpose: "touchstone.assay",
        traceId: "trace",
        report: {} as never,
        decisions: [],
        escalations: [],
      }),
    ).toThrow(/TOUCHSTONE_SIGNING_SECRET is not set/);
    // A forged receipt must not verify by falling back to the public key either.
    expect(() => verify({ version: "touchstone.receipt.v1", signature: { alg: "HMAC-SHA256", value: "00" } })).toThrow(
      /TOUCHSTONE_SIGNING_SECRET is not set/,
    );
  });

  it("keeps a dev fallback that says what it is, so tests and dev still run", () => {
    expect(signingKey()).toMatch(/INSECURE-DEV-ONLY/);
  });

  it("uses the configured key when there is one", () => {
    process.env.VERCEL = "1";
    process.env.TOUCHSTONE_SIGNING_KEY = "a-real-key";
    try {
      expect(signingKey()).toBe("a-real-key");
    } finally {
      delete process.env.TOUCHSTONE_SIGNING_KEY;
    }
  });
});

describe("escalation approval is an operator action", () => {
  async function post(headers: Record<string, string>, id: string): Promise<Response> {
    const { POST } = await import("../app/api/escalations/route");
    return POST(
      new Request("https://yuzu-market.vercel.app/api/escalations", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ id, approve: true }),
      }),
    );
  }

  it("refuses the requesting party's own approval, and refuses it again when no operator is configured", async () => {
    const escalation = await requestEscalation({
      buyerId: "buyer-who-asked",
      resourcePath: ["vendors", "renderkit", "probe"],
      action: "probe",
      reason: "test",
    });

    // The ticket id is handed to the buyer in the assay response, so this is
    // exactly the request the requesting party can make about itself.
    const open = await post({}, escalation.id);
    expect(open.status).toBe(403);
    expect(((await open.json()) as { error: string }).error).toBe("operator_key_required");
    expect(getEscalation(escalation.id)?.state).toBe("pending");

    process.env.TOUCHSTONE_OPERATOR_KEY = "operator-secret";
    const wrong = await post({ "x-operator-key": "operator-secre" }, escalation.id);
    expect(wrong.status).toBe(403);
    expect(getEscalation(escalation.id)?.state).toBe("pending");

    const right = await post({ "x-operator-key": "operator-secret" }, escalation.id);
    expect(right.status).toBe(200);
    expect(((await right.json()) as { state: string }).state).toBe("approved");
  });
});

describe("deterministicScore does not move when an upstream does", () => {
  const rules: DimensionResult = {
    id: "specificity",
    label: "Specificity",
    score: 0.8,
    weight: 0.3,
    method: "deterministic",
    summary: "fixed",
    findings: [],
  };

  it("scores the same listing identically whether or not the injection classifier answered", async () => {
    const input = { vendor: "RenderKit", pitch: CLEAN, buyerId: "buyer" };

    upstream.guard = 0.42;
    const answered = await steeringResistance(input);
    upstream.guard = undefined;
    const throttled = await steeringResistance(input);

    expect(answered.method).toBe("classifier");
    expect(throttled.method).toBe("deterministic");
    // The headline score is allowed to move — it is measuring more.
    expect(answered.score).not.toBe(throttled.score);
    // The reproducible one is not.
    expect(deterministicScore([rules, answered])).toBe(deterministicScore([rules, throttled]));
    expect(deterministicScore([rules, throttled])).toBe(deterministicScore([rules, throttled]));
  });

  it("leaves out a dimension that did not run rather than scoring it as zero", () => {
    const notRun: DimensionResult = { ...rules, id: "claims", label: "Claims", score: 0, method: "not-run" };
    expect(deterministicScore([rules, notRun])).toBe(deterministicScore([rules]));
  });
});

describe("a probe that succeeded is evidence in the report", () => {
  it("records a reachable endpoint at weight zero", () => {
    const dimension = probeDimension("https://vendor.example/health", {
      status: "succeeded",
      output: { reachable: true, status: 200, latencyMs: 42, contentType: "application/json" },
    });
    expect(dimension?.method).toBe("measured");
    expect(dimension?.weight).toBe(0);
    expect(dimension?.summary).toContain("200");
    expect(dimension?.findings).toEqual([]);
  });

  it("names an unreachable endpoint as a finding", () => {
    const dimension = probeDimension("https://vendor.example/health", {
      status: "succeeded",
      output: { reachable: false, latencyMs: 8000, error: "TimeoutError" },
    });
    expect(dimension?.findings[0]?.code).toBe("PROBE_UNREACHABLE");
    expect(dimension?.score).toBe(0);
  });

  it("has nothing to say when the probe was denied", () => {
    expect(probeDimension("https://vendor.example/health", { status: "denied" })).toBeUndefined();
    expect(probeDimension("https://vendor.example/health", undefined)).toBeUndefined();
  });
});
