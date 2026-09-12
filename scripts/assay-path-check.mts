/**
 * The REST assay and the MCP assay disagreed on the same listing.
 *
 * Live, on the build the Arena agent card points at:
 *
 *   POST /api/mcp  yuzu_assay   -> TRUSTED 84.4
 *   POST /api/assay             -> UNPROVEN 0,
 *        "Assay refused: material read denied by kernel policy (tool_unavailable)."
 *
 * The agent card advertises /api/assay as the paid service, so every rival
 * agent that reads the card and follows it gets the broken one. This isolates
 * which of the two differences causes it: the turn wrapper, or the traceId the
 * route threads into the engine.
 *
 *   node --env-file=.env.local --import tsx scripts/assay-path-check.mts
 */
import { assay } from "../lib/assay/engine";
import { buildContext, withTurn } from "../lib/sharedos/host";
import { PURPOSES } from "../lib/sharedos/identity";

const VENDOR = {
  vendor: "RenderKit",
  pitch:
    "RenderKit produces one 9:16 product video per request. Price: 6 Arena credits per video. " +
    "Delivery under 180 seconds. Output: an MP4 URL plus the shot list as JSON. " +
    "Samples: https://github.com/example/renderkit-samples",
  askingPrice: 6,
  buyerId: "path-check",
};

function line(label: string, receipt: { report: { verdict: string; score: number; headline: string; analysis?: string } }): void {
  console.log(
    `${label.padEnd(34)} ${receipt.report.verdict.padEnd(9)} ${String(receipt.report.score).padStart(5)}  ` +
      `${receipt.report.headline.slice(0, 90)}`,
  );
}

// 1. What MCP does.
const mcpLike = await assay(VENDOR, { fast: true });
line("mcp: fast, no turn, no traceId", mcpLike.receipt);

// 2. What MCP does without `fast`, to separate that variable from the others.
const noFast = await assay(VENDOR);
line("plain: no turn, no traceId", noFast.receipt);

// 3. What the REST route does: a turn, and the turn's traceId threaded in.
const routeContext = buildContext({ buyerId: VENDOR.buyerId, purpose: PURPOSES.assay });
const routeLike = await withTurn(routeContext, `assay_${routeContext.traceId}`, () =>
  assay(VENDOR, { traceId: routeContext.traceId }),
);
line("route: turn + route traceId", routeLike.receipt);

// 4. The turn, but letting the engine mint its own trace. If this one passes,
//    the traceId is the culprit rather than the turn.
const turnOnlyContext = buildContext({ buyerId: VENDOR.buyerId, purpose: PURPOSES.assay });
const turnOnly = await withTurn(turnOnlyContext, `assay_${turnOnlyContext.traceId}`, () => assay(VENDOR));
line("route: turn, engine's own trace", turnOnly.receipt);
