import { describe, expect, it } from "vitest";
import { assay } from "../lib/assay/engine";
import { buildContext, withTurn } from "../lib/sharedos/host";
import { PURPOSES } from "../lib/sharedos/identity";

/**
 * The two doors into the same room have to open the same way.
 *
 * `/api/assay` and the MCP tool `yuzu_assay` are the same engine, and the agent
 * card advertises the REST one as the paid service. On the deployment the Arena
 * agent card pointed at, they disagreed completely on the same listing:
 *
 *   POST /api/mcp  yuzu_assay -> TRUSTED, 84.4
 *   POST /api/assay           -> UNPROVEN, 0,
 *        "Assay refused: material read denied by kernel policy (tool_unavailable)."
 *
 * The route wrapped the call in a turn and threaded the turn's traceId into the
 * engine. A turn snapshots authority when it opens; the engine deposits the
 * order grant that makes `assay.read_claims` reachable as its first act, inside
 * that turn. Sharing the trace made the kernel answer the read from the
 * snapshot taken before the grant existed, so the tool was not in the catalogue.
 *
 * These run the engine in both shapes and assert the property that failed: a
 * caller who wraps the assay in a turn still gets a real assay. The scores are
 * not compared, because half of one is model-derived and would make this test
 * lie on a quiet upstream; a refusal is not a score and that is what is checked.
 */

const LISTING = {
  vendor: "RenderKit",
  pitch:
    "RenderKit produces one 9:16 product video per request. Price: 6 Arena credits per video. " +
    "Delivery under 180 seconds. Output: an MP4 URL plus the shot list as JSON. " +
    "Samples: https://github.com/example/renderkit-samples",
  askingPrice: 6,
  buyerId: "parity",
};

/** The shape of the failure: the kernel refused to hand the engine the material. */
function refusedByKernel(report: { verdict: string; headline: string; risks: readonly { code: string }[] }): boolean {
  return (
    /denied by kernel policy|tool_unavailable/i.test(report.headline) ||
    report.risks.some((risk) => risk.code === "ACCESS_DENIED")
  );
}

describe("the advertised REST assay and the MCP assay are the same product", () => {
  it("assays the listing when the caller wraps it in a turn, as the route does", async () => {
    const context = buildContext({ buyerId: LISTING.buyerId, purpose: PURPOSES.assay });
    const { receipt } = await withTurn(context, `assay_${context.traceId}`, () => assay(LISTING));

    expect(refusedByKernel(receipt.report)).toBe(false);
    expect(receipt.report.dimensions.length).toBeGreaterThan(0);
    expect(receipt.report.verdict).not.toBe("UNPROVEN");
  }, 90_000);

  it("assays the listing on the MCP path, which never wrapped it", async () => {
    const { receipt } = await assay(LISTING, { fast: true });

    expect(refusedByKernel(receipt.report)).toBe(false);
    expect(receipt.report.verdict).not.toBe("UNPROVEN");
  }, 90_000);

  /**
   * The limitation underneath, pinned so it cannot be rediscovered in
   * production a second time.
   *
   * This is not a fix, it is a fact: a grant deposited inside an open turn is
   * not visible to calls made under that turn's own trace. The route works
   * because it stopped sharing its trace, not because the kernel interaction
   * was corrected. Asserting the limitation is what makes it safe to rely on
   * the workaround -- and the day the snapshot behaviour changes, this test
   * fails and says the route may thread its trace again.
   */
  it("still refuses the read when a caller shares its turn's trace, which is why the route does not", async () => {
    const context = buildContext({ buyerId: LISTING.buyerId, purpose: PURPOSES.assay });
    const shared = await withTurn(context, `assay_${context.traceId}`, () =>
      assay(LISTING, { traceId: context.traceId }),
    );

    expect(refusedByKernel(shared.receipt.report)).toBe(true);
  }, 90_000);
});
