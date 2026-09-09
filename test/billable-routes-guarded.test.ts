import { describe, expect, it } from "vitest";

/**
 * Every route that spends money on a model must refuse before it reads a body.
 *
 * Two did not. `/api/broker` had no admission at all — the most expensive route
 * in the product, fanning out an assay per bidder, a challenge per shortlisted
 * seller, a delivery and a verification on one unauthenticated POST. And
 * `/api/arena` imported `admit` and never called it, which is the worse shape
 * of the same bug because the import makes it read as guarded.
 *
 * CORS is deliberately open on `/api/*` so agents can reach us from anywhere,
 * which means any web page could have fired either of these from every visitor
 * it had, against our own funded keys.
 *
 * This test is deliberately structural rather than behavioural: driving the
 * real handlers to exhaustion would spend the very budget it is protecting.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every route file under app/api. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

/** Routes whose POST reaches a model, and therefore our bill. */
const BILLABLE = ["broker", "arena", "assay", "shortlist", "sellers", "mcp"];

describe("a route that spends money refuses before it reads the body", () => {
  const files = routeFiles(join("app", "api"));

  it("finds every route file", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  for (const name of BILLABLE) {
    it(`${name} calls admit, not merely imports it`, () => {
      const file = files.find((path) => path.includes(join("api", name)) && !path.includes("stream"));
      expect(file, `no route file for ${name}`).toBeDefined();
      const source = readFileSync(file as string, "utf8");
      if (!source.includes("export async function POST")) return; // no POST, nothing to guard

      // Importing it is not calling it. That distinction is the whole bug.
      expect(source, `${name} does not call admit()`).toMatch(/admit\(request\)/);
      expect(source, `${name} does not act on the verdict`).toMatch(/rateLimited\(/);
    });
  }

  it("guards the streaming broker too, which is the same spend by another door", () => {
    const file = files.find((path) => path.includes("stream"));
    expect(file).toBeDefined();
    expect(readFileSync(file as string, "utf8")).toMatch(/admit\(request\)/);
  });
});
