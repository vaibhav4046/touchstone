/**
 * Which cut of a plate this display deserves.
 *
 * The films were rendered at 1080p, so there is no honest 4K master to serve —
 * upscaling would cost bandwidth and add nothing but interpolation. What there
 * is to fix is the opposite mistake: shipping a 1280-wide downscale to a screen
 * with four times the pixels, which is what makes a background look soft on a
 * retina laptop or a 4K panel.
 *
 * So there are two cuts. The default is 1280 at a lean bitrate. The `@2x` cut is
 * the full 1920 master at roughly four times the bitrate, and it is served only
 * when the device actually has the pixels to resolve it.
 */
export function plateCut(): "" | "@2x" {
  if (typeof window === "undefined") return "";

  const density = window.devicePixelRatio || 1;
  const effective = window.innerWidth * density;

  // Below this, a 1280 cut already exceeds the pixels available and the larger
  // file is pure cost. `saveData` and a metered connection override everything:
  // nobody on a capped plan asked for a nicer sky.
  const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData === true) return "";
  if (connection?.effectiveType !== undefined && /2g|3g/.test(connection.effectiveType)) return "";

  return effective >= 1700 ? "@2x" : "";
}
