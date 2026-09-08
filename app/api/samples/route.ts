import { SAMPLES } from "../../samples";
import { json } from "../../../lib/api";

export const runtime = "nodejs";

/**
 * Listings to try the service on.
 *
 * These live here rather than in the manifest because they contain the exact
 * phrases Touchstone looks for — a demonstration of a hostile listing is a
 * hostile listing, and quoting one inside a service manifest makes the manifest
 * fail its own authority-hygiene check. That is the detector working, not a bug
 * in it, so the samples moved instead.
 */
export async function GET(): Promise<Response> {
  return json({
    note: "Demonstration listings. Each is real input for POST /api/assay. The hostile one is intentionally hostile.",
    samples: SAMPLES.map((sample) => ({
      key: sample.key,
      label: sample.label,
      vendor: sample.vendor,
      askingPrice: sample.askingPrice,
      pitch: sample.pitch,
      expected:
        sample.key === "hostile"
          ? "FLAGGED — instructs the reading agent and asks for credentials"
          : sample.key === "honest"
            ? "TRUSTED — every commitment is falsifiable"
            : "UNPROVEN — nothing stated could be shown false",
    })),
  });
}
