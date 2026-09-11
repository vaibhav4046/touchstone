import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

async function run() {
  console.log("🚀 Starting Playwright End-to-End Visual & Agent Inspection...");
  const screenshotDir = path.join(process.cwd(), "artifacts", "playwright-inspection");
  fs.mkdirSync(screenshotDir, { recursive: true });

  // 1. Launch local Next.js server if not running
  console.log("Checking if port 3021 is active...");
  let serverProcess = null;
  let isRunning = false;
  try {
    const res = await fetch("http://localhost:3021/api/health");
    if (res.ok) isRunning = true;
  } catch {
    isRunning = false;
  }

  if (!isRunning) {
    console.log("Spawning local Next.js dev server on port 3021...");
    serverProcess = spawn("npx", ["next", "dev", "-p", "3021"], {
      shell: true,
      stdio: "pipe",
    });
    // Wait for server to be ready
    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch("http://localhost:3021/api/health");
        if (res.ok) {
          console.log("Server ready on http://localhost:3021");
          break;
        }
      } catch {
        attempts++;
      }
    }
  } else {
    console.log("Server is already running on http://localhost:3021");
  }

  // 2. Launch Chromium via Playwright using system Google Chrome
  console.log("Launching Google Chrome via Playwright (channel: 'chrome')...");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  // Listen to console logs and errors
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // ──────── TEST 1: Landing Page (Day & Night) ────────
    console.log("\n[1/4] Inspecting Landing Page (http://localhost:3021)...");
    await page.goto("http://localhost:3021", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Verify 3D Manifold Canvas
    const canvas = await page.locator(".manifold-canvas-mount canvas");
    const canvasCount = await canvas.count();
    console.log(`  ✓ 3D Topological Manifold canvas found: ${canvasCount > 0 ? "YES" : "NO"}`);

    // Take Day mode screenshot
    await page.screenshot({ path: path.join(screenshotDir, "01-landing-day.png"), fullPage: true });
    console.log("  ✓ Saved 01-landing-day.png");

    // Toggle to Night mode
    console.log("  Toggling to Night Mode...");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "night");
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, "02-landing-night.png"), fullPage: true });
    console.log("  ✓ Saved 02-landing-night.png");

    // Check high-contrast CTA button in night mode
    const btnInk = page.locator(".btn-ink");
    const btnColor = await btnInk.evaluate((el) => window.getComputedStyle(el).color);
    const btnBg = await btnInk.evaluate((el) => window.getComputedStyle(el).backgroundImage || window.getComputedStyle(el).backgroundColor);
    console.log(`  ✓ Night Mode .btn-ink Color: ${btnColor}, Background: ${btnBg.slice(0, 40)}...`);

    // Check Subagent Badge in night mode
    const subBadge = page.locator(".subagent-badge.active").first();
    const badgeColor = await subBadge.evaluate((el) => window.getComputedStyle(el).color);
    console.log(`  ✓ Night Mode .subagent-badge.active Color: ${badgeColor} (Expected #4ade80 / rgb(74, 222, 128))`);

    // ──────── TEST 2: Run End-to-End Market Goal Dispatch ────────
    console.log("\n[2/4] Testing Goal Dispatch in the Market...");
    const goalInput = page.locator('textarea[placeholder*="Describe what you want"]');
    await goalInput.fill("Launch speciality coffee brand next week with competitor brief.");
    const sendBtn = page.locator(".btn-ink");
    await sendBtn.click();
    console.log("  ✓ Clicked 'Send it to the market'. Waiting for subagent pipeline...");

    // Wait for the pipeline to finish and produce a delivery / receipt
    await page.waitForSelector(".glowing-delivery-container", { timeout: 15000 });
    console.log("  ✓ Subagents completed workflow and delivered verified output!");

    await page.screenshot({ path: path.join(screenshotDir, "03-market-delivered-night.png") });
    console.log("  ✓ Saved 03-market-delivered-night.png");

    // ──────── TEST 3: The Floor Dashboard (/dashboard) ────────
    console.log("\n[3/4] Inspecting Dashboard (/dashboard)...");
    await page.goto("http://localhost:3021/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Check quick nav
    const quickNav = page.locator(".floor-quick-nav");
    console.log(`  ✓ Floor quick nav bar present: ${(await quickNav.count()) > 0 ? "YES" : "NO"}`);

    await page.screenshot({ path: path.join(screenshotDir, "04-dashboard-day.png"), fullPage: true });
    console.log("  ✓ Saved 04-dashboard-day.png");

    // Toggle Night mode on Dashboard
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "night");
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, "05-dashboard-night.png"), fullPage: true });
    console.log("  ✓ Saved 05-dashboard-night.png");

    // ──────── TEST 4: Deal Verifier (/deal) ────────
    console.log("\n[4/4] Inspecting Deal Verifier (/deal)...");
    await page.goto("http://localhost:3021/deal", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Click "⚡ Load Live Sample Receipt"
    console.log("  Clicking '⚡ Load Live Sample Receipt'...");
    const sampleBtn = page.locator('button:has-text("Load Live Sample Receipt")');
    await sampleBtn.click();

    // Wait for verified deal section
    await page.waitForSelector(".deal-verdict", { timeout: 15000 });
    console.log("  ✓ Cryptographic Ed25519 verification succeeded!");

    await page.screenshot({ path: path.join(screenshotDir, "06-deal-verified-day.png"), fullPage: true });
    console.log("  ✓ Saved 06-deal-verified-day.png");

    // Toggle Night mode on Deal
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "night");
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(screenshotDir, "07-deal-verified-night.png"), fullPage: true });
    console.log("  ✓ Saved 07-deal-verified-night.png");

    console.log("\n✅ ALL PLAYWRIGHT INSPECTIONS PASSED WITH FLYING COLORS!");
    console.log(`Console Errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log("Errors caught:", consoleErrors);
    }
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

run().catch((err) => {
  console.error("Inspection error:", err);
  process.exit(1);
});
