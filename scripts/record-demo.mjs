#!/usr/bin/env node
/**
 * Records the Yuzu demo as a real browser session against the real deployment.
 *
 * Nothing here is staged. Every frame is the deployed site answering real
 * clicks: the deal that runs is a deal, the receipt that gets verified is the
 * one that deal produced, and the tampered receipt is that same receipt with
 * one field changed in front of the camera. If a model upstream refuses on the
 * night, the recording keeps that too — an unfilled result with a stated
 * reason is a better demonstration than a lucky one, and the shot list says so.
 *
 * The capture is deliberately clean: no title cards, no lower-thirds, no
 * cursor theatrics. Those are added afterwards from `beats.json`, which this
 * script writes with the REAL elapsed second of every beat rather than the
 * planned one, so an overlay cannot drift away from the footage it labels.
 *
 *   node scripts/record-demo.mjs
 *   node scripts/record-demo.mjs --base http://localhost:3000 --out work/recording
 */
import { chromium } from "@playwright/test";
import { mkdir, rm, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const BASE = flag("base", "https://yuzu-market.vercel.app").replace(/\/$/, "");
const OUT = flag("out", "work/recording");
const WIDTH = 1280;
const HEIGHT = 720;

/** A deal has to actually finish, and the market's own ceiling is 120s. */
const DEAL_TIMEOUT = 150_000;

const beats = [];
let started = 0;
const elapsed = () => (started === 0 ? 0 : (Date.now() - started) / 1000);

/**
 * Marks what is on screen from this second on.
 *
 * `start` is measured, never planned: a beat that took nine seconds is written
 * down as nine, so the overlay built from this file lands on what it describes
 * even when the network had a slow morning.
 */
function beat(label, note) {
  const previous = beats.at(-1);
  const at = Number(elapsed().toFixed(2));
  if (previous) previous.end = at;
  beats.push({ start: at, end: null, label, note });
  process.stdout.write(`  ${String(at).padStart(6)}s  ${label}\n`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } },
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();

  // A recording is worthless if the page was broken and nobody noticed, so
  // console errors are collected and reported at the end rather than ignored.
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const settle = (ms) => page.waitForTimeout(ms);

  console.log(`Recording ${BASE} at ${WIDTH}x${HEIGHT}\n`);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
  started = Date.now();

  // ── the problem, in a seller's own words ──────────────────────────────
  beat("landing", "The mark, the line, the cloud. Let it drift before anything moves.");
  await settle(3200);

  beat("hostile-listing", "A real listing that is a prompt injection wearing a price tag.");
  await page.evaluate(() => {
    const quote = document.querySelector("blockquote, .quote, .listing-quote");
    (quote ?? document.querySelector("#market"))?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await settle(4000);

  // ── one deal, start to finish ─────────────────────────────────────────
  beat("the-goal", "A launch-film shot list: creative work, which is what draws the hostile bid.");
  await page.evaluate(() => document.querySelector("#market")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  await settle(2200);

  const goal = page.locator("#market textarea").first();
  await goal.scrollIntoViewIfNeeded();
  await settle(600);

  beat("send", "One click. Nothing else is touched.");
  await page.getByRole("button", { name: /send it to the market/i }).click();

  // ── the timeline writes itself ────────────────────────────────────────
  beat("bids-and-assay", "Every listing is assayed as it arrives. The hostile one is flagged before pricing.");
  await settle(6000);

  beat("proofs", "The shortlist writes a small piece of the real job. A description is free; a sample is not.");
  await settle(6000);

  beat("negotiate", "Arithmetic over three numbers: the ask, the floor, the budget. No model touches it.");
  await settle(5000);

  // The deal is the only thing here that can take an unpredictable amount of
  // time, so it is waited for rather than slept through.
  beat("contract", "Paying is minting: the agreed credits become that many uses on a grant over one capability.");
  await page
    .locator("text=/settle|settled|paid|unfilled|nothing was bought/i")
    .first()
    .waitFor({ timeout: DEAL_TIMEOUT })
    .catch(() => console.log("  (no settlement line appeared; recording the result as it stands)"));
  await settle(5000);

  beat("verify-and-settle", "Work that fails verification is not paid for, and reputation moves on outcomes only.");
  await page.evaluate(() => window.scrollBy({ top: 520, behavior: "smooth" }));
  await settle(5500);

  beat("kernel-ledger", "The kernel's own audit stream, not our account of it.");
  await page.evaluate(() => window.scrollBy({ top: 620, behavior: "smooth" }));
  await settle(5000);

  // ── evidence you do not have to trust us for ──────────────────────────
  // Lifted straight out of the page rather than pasted from a file, so the
  // receipt being checked is provably the one the deal above produced.
  const receipt = await page.evaluate(() => {
    const source = globalThis.__yuzuLastReceipt;
    if (source) return JSON.stringify(source);
    const block = [...document.querySelectorAll("pre, code")]
      .map((node) => node.textContent ?? "")
      .find((text) => text.includes("receiptId") && text.includes("signature"));
    return block ?? null;
  });

  beat("check-it-yourself", "The receipt this deal produced, checked in the browser against the published key.");
  await page.goto(`${BASE}/deal`, { waitUntil: "networkidle" });
  await settle(2500);

  if (receipt) {
    const paste = page.locator("textarea").first();
    await paste.click();
    await paste.fill(receipt);
    await settle(1200);
    await page
      .getByRole("button", { name: /check|verify/i })
      .first()
      .click()
      .catch(() => {});
    beat("valid", "Verified in the reader's own browser. Nothing was asked of us.");
    await settle(4500);

    // One field, changed on camera. This is the whole argument.
    beat("tampered", "One character of the verdict, changed. The same check now refuses it.");
    const broken = receipt.replace(/"verdict"\s*:\s*"([A-Z_]+)"/, '"verdict":"QUALIFIED_BUT_EDITED"');
    await paste.fill(broken === receipt ? receipt.replace(/[0-9]/, "9") : broken);
    await settle(900);
    await page
      .getByRole("button", { name: /check|verify/i })
      .first()
      .click()
      .catch(() => {});
    await settle(4500);
  } else {
    beat("check-it-yourself-empty", "No receipt was produced by this run; the page is shown with its own sample.");
    await settle(5000);
  }

  // ── the floor ─────────────────────────────────────────────────────────
  beat("the-floor", "Who may touch what, read from the kernel rather than kept by us.");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await settle(4500);

  beat("owner-decisions", "Decided before the room opened, refusals included. A refusal carries no width.");
  await page.evaluate(() => window.scrollBy({ top: 700, behavior: "smooth" }));
  await settle(5000);

  beat("withdrawn", "All withdrawn: a contract grant dies with its order. The permission is gone; the record is not.");
  await page.evaluate(() => window.scrollBy({ top: 760, behavior: "smooth" }));
  await settle(5000);

  beat("close", "Marketplaces gave humans reputation, contracts and time. Agents have none of that yet.");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await settle(3500);

  const last = beats.at(-1);
  if (last) last.end = Number(elapsed().toFixed(2));
  const duration = Number(elapsed().toFixed(2));

  await context.close();
  await browser.close();

  // Playwright names the file after the page guid; give it a name a human can use.
  const files = await readdir(OUT);
  const raw = files.find((name) => name.endsWith(".webm"));
  if (raw) await rename(path.join(OUT, raw), path.join(OUT, "yuzu-demo.webm"));

  await writeFile(
    path.join(OUT, "beats.json"),
    `${JSON.stringify({ base: BASE, width: WIDTH, height: HEIGHT, duration, beats, consoleErrors }, null, 2)}\n`,
  );

  console.log(`\n${duration}s recorded -> ${path.join(OUT, "yuzu-demo.webm")}`);
  console.log(`${beats.length} beats -> ${path.join(OUT, "beats.json")}`);
  if (consoleErrors.length > 0) {
    console.log(`\n${consoleErrors.length} console error(s) during the take:`);
    for (const error of consoleErrors.slice(0, 8)) console.log(`  ${error}`);
    console.log("Fix these before the take you keep. A demo of a page throwing errors is a demo of that.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
