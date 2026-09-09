import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "../lib/api";

/** `after()` needs a request scope. These tests call the route directly. */
vi.mock("next/server", () => ({ after: () => undefined }));

/**
 * No model on this bench.
 *
 * The plain-language path asks one to split a paragraph into listings. These
 * tests are about what happens at the boundary before and instead of that, so
 * the model is held unavailable and the fallback path is exercised as it would
 * be on a throttled day.
 */
vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();
  return { ...actual, complete: async () => ({ ok: false, text: "", ms: 1, error: "no_key" }) };
});

const { POST } = await import("../app/api/assay/route");
const { POST: BROKER } = await import("../app/api/broker/route");

const LISTING = "RenderKit returns one MP4 URL per request. Price: 6 Arena credits. Delivery under 180 seconds.";

async function post(body: string | object): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const response = await POST(
    new Request("https://yuzu.test/api/assay", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "validation-suite" },
      body: raw,
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  resetRateLimits();
});

/**
 * Malformed input used to succeed silently.
 *
 * Measured against the live site: truncated JSON came back 200 with the broken
 * JSON scored *as the pitch*; `{"vendor":"X"}` came back QUALIFIED 66 with no
 * pitch at all; `budget:"twenty"` quietly became 25 and ran a whole deal
 * against money nobody authorised. An agent cannot tell a scored listing from a
 * scored typo, and it will act on both.
 */
describe("a body that is not a listing is refused, not scored", () => {
  it("refuses truncated JSON instead of assaying the broken text", async () => {
    const { status, body } = await post('{"vendor":"CinematicAgent","pitch":"We deliver 3 videos in 5 sec');
    expect(status).toBe(400);
    expect(body.error).toBe("malformed_json");
    expect(body.verdict).toBeUndefined();
    expect(body.score).toBeUndefined();
    expect(String(body.message)).toMatch(/NOT read as vendor material/i);
  });

  it("refuses a body with a vendor name and no pitch", async () => {
    const { status, body } = await post({ vendor: "X" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_listing");
    expect(body.field).toBe("pitch");
    // Names the missing field, rather than reporting the absence as a type error.
    expect(String(body.message)).toMatch(/has no `pitch`/);
    expect(body.verdict).toBeUndefined();
  });

  it("refuses an empty pitch rather than scoring the absence of one", async () => {
    const { status, body } = await post({ vendor: "Ghost", pitch: "" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_listing");
    expect(String(body.message)).toMatch(/empty `pitch`/);
  });

  it("refuses a whitespace-only pitch", async () => {
    const { status, body } = await post({ vendor: "Ghost", pitch: "   \n\t " });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_listing");
  });

  it("refuses a pitch that is not a string", async () => {
    const { status, body } = await post({ vendor: "X", pitch: { text: LISTING } });
    expect(status).toBe(400);
    expect(String(body.message)).toMatch(/not a string/);
  });

  it("refuses a JSON object carrying no vendor material at all", async () => {
    const { status, body } = await post({ goal: "launch my coffee brand", budget: 25 });
    expect(status).toBe(400);
    expect(body.error).toBe("no_vendor_material");
    expect(body.verdict).toBeUndefined();
  });

  it("refuses an empty body", async () => {
    const { status, body } = await post("");
    expect(status).toBe(400);
    expect(body.error).toBe("no_vendor_material");
  });

  it("refuses a listing past the size cap rather than scoring half of it", async () => {
    const { status, body } = await post({ vendor: "Filler", pitch: "We deliver shotlists. ".repeat(24_000) });
    expect(status).toBe(400);
    expect(body.error).toBe("listing_too_long");
    expect(String(body.message)).toMatch(/refused rather than truncated/);
  });
});

describe("an amount is authorised or it is refused", () => {
  it("refuses a budget that is not a number instead of inventing 25", async () => {
    const { status, body } = await post({ vendor: "X", pitch: LISTING, budget: "twenty" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_budget");
    expect(String(body.message)).toMatch(/nobody authorised/);
    expect(body.verdict).toBeUndefined();
  });

  it("refuses a negative budget", async () => {
    const { status, body } = await post({ vendor: "X", pitch: LISTING, budget: -40 });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_budget");
  });

  it("refuses a zero budget", async () => {
    const { status } = await post({ vendor: "X", pitch: LISTING, budget: 0 });
    expect(status).toBe(400);
  });

  it("refuses an askingPrice that is not a number", async () => {
    const { status, body } = await post({ vendor: "X", pitch: LISTING, askingPrice: "twelve" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_listing");
    expect(body.field).toBe("askingPrice");
  });

  it("accepts a budget it can actually spend", async () => {
    const { status } = await post({ vendor: "RenderKit", pitch: LISTING, budget: 25, askingPrice: 6 });
    expect(status).toBe(200);
  }, 60_000);
});

describe("a vendors field that is not a list of vendors", () => {
  it("refuses an object where an array was required", async () => {
    const { status, body } = await post({ vendors: { vendor: "X", pitch: LISTING } });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_vendors");
    expect(String(body.message)).toMatch(/must be an array/);
  });

  it("refuses an empty array", async () => {
    const { status, body } = await post({ vendors: [] });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_vendors");
  });

  it("refuses the whole request when one entry is unreadable, naming which", async () => {
    const { status, body } = await post({
      vendors: [{ vendor: "A", pitch: LISTING }, { vendor: "B" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_vendor_entry");
    expect(String(body.message)).toMatch(/Entry 1/);
    expect(String(body.message)).toMatch(/1 of 2/);
  });

  it("refuses a bare array body with the shape it wanted", async () => {
    const { status, body } = await post([{ vendor: "A", pitch: LISTING }]);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_body");
  });

  it("sends a multi-vendor body to the route that ranks them", async () => {
    const { status, body } = await post({
      vendors: [
        { vendor: "A", pitch: LISTING },
        { vendor: "B", pitch: LISTING },
      ],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("too_many_vendors");
    expect(String(body.message)).toMatch(/\/api\/shortlist/);
  });
});

describe("what still works", () => {
  it("assays a well-formed structured listing", async () => {
    const { status, body } = await post({ vendor: "RenderKit", pitch: LISTING, askingPrice: 6 });
    expect(status).toBe(200);
    expect(body.verdict).toBeDefined();
    expect((body.meta as { interpretation: string }).interpretation).toBe("structured");
  }, 60_000);

  it("keeps plain-text goals working, model or no model", async () => {
    const { status, body } = await post(
      "I need a video agent. CinematicAgent says it delivers three videos in five seconds for twelve credits.",
    );
    expect(status).toBe(200);
    expect(body.verdict).toBeDefined();
    expect((body.meta as { interpretation: string }).interpretation).toBe("plain-language-fallback");
  }, 60_000);

  it("reads a listing sent as {text: ...}", async () => {
    const { status } = await post({ text: `CinematicAgent listing: ${LISTING}` });
    expect(status).toBe(200);
  }, 60_000);
});

describe("every refusal is one an agent can act on", () => {
  const bad: ReadonlyArray<readonly [string, string | object]> = [
    ["truncated", '{"pitch":"abc'],
    ["no pitch", { vendor: "X" }],
    ["empty pitch", { vendor: "X", pitch: "" }],
    ["bad budget", { vendor: "X", pitch: LISTING, budget: "twenty" }],
    ["bad vendors", { vendors: { a: 1 } }],
    ["nothing usable", { goal: "hello" }],
  ];

  for (const [label, body] of bad) {
    it(`names the field and says nothing was scored: ${label}`, async () => {
      const result = await post(body);
      expect(result.status).toBe(400);
      expect(typeof result.body.error).toBe("string");
      expect(String(result.body.message).length).toBeGreaterThan(60);
      expect(String(result.body.message)).toMatch(/Nothing was scored|NOT read|refused/i);
      // The failure this replaces was a 200 with a verdict in it.
      expect(result.body.verdict).toBeUndefined();
      expect(result.body.score).toBeUndefined();
      expect(result.body.receipt).toBeUndefined();
    });
  }
});

/**
 * The same refusal, on the route that spends money.
 *
 * The service card says a non-numeric or non-positive budget is "refused with
 * 400 rather than replaced with a default you did not authorise", and it says
 * it about `yuzu.broker`. Every case above proves it about `/api/assay`. They
 * share the parser, which is exactly the reason to check the other end: a
 * shared helper is only as good as the route remembering to call it, and the
 * route that can spend a budget is the one where forgetting costs something.
 */
describe("the route that spends money refuses an unauthorised budget too", () => {
  async function broker(body: object): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await BROKER(
      new Request("https://yuzu.test/api/broker", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "validation-suite-broker" },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it.each([
    ["not a number", "twenty"],
    ["negative", -40],
    ["zero", 0],
  ])("refuses a %s budget instead of substituting the default", async (_label, budget) => {
    const result = await broker({ goal: "I need a competitor brief.", budget });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_budget");
    // Nothing may have been bought on the way to refusing.
    expect(result.body.contract).toBeUndefined();
    expect(result.body.settlement).toBeUndefined();
    expect(result.body.receipt).toBeUndefined();
  });
});
