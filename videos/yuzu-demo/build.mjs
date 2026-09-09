#!/usr/bin/env node
/**
 * Generates index.html from ../../work/recording/beats.json.
 *
 * Every card's timing is derived from the measured beats. Re-record, re-run
 * this, and the graphics move with the footage. No second is hardcoded.
 *
 * Run `node build.mjs` to rebuild, `node build.mjs --check` to assert only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BEATS = resolve(HERE, "../../work/recording/beats.json");
const MARK = resolve(HERE, "../../public/art/yuzu-mark.svg");
const OUT = resolve(HERE, "index.html");

/* ---------------------------------------------------------------- timing */

const OPEN_HOLD = 2.5; // full-bleed open before the footage appears
const OPEN_FADE = 0.4; // open dissolves over the first frames of footage
const CLOSE_LEAD = 0.4; // close dissolves in over the last frames of footage
const CLOSE_HOLD = 3.0; // close held alone after the footage ends

const LEAD = 0.35; // a lower-third enters this long after its beat starts
const TAIL = 0.4; // and leaves this long before its beat ends
const MIN_CARD = 2.0; // shorter than this is a flash, not a caption
const MAX_CARD = 5.0; // long beats do not get a card parked on them
const MAX_EMPHATIC = 6.5;
const EMPHATIC_SHARE = 0.55; // the emphatic card takes the tail of its beat

const IN_DUR = 0.42;
const OUT_DUR = 0.32;
const RISE = 14; // px of translate on entry — the whole motion vocabulary
const RISE_EMPHATIC = 22;

/* ------------------------------------------------------------------ copy */
/* One sentence per beat, tightened from that beat's `note`. Nothing here
   claims anything the note does not. */

const COPY = {
  landing: { kicker: "LANDING", line: "The mark, the line, the cloud." },
  "hostile-listing": {
    kicker: "HOSTILE LISTING",
    line: "A real listing: a prompt injection wearing a price tag.",
  },
  "the-goal": {
    kicker: "THE GOAL",
    line: "A launch-film shot list. Creative work draws the hostile bid.",
  },
  send: { kicker: "SEND", line: "One click. Nothing else is touched." },
  "bids-and-assay": {
    kicker: "BIDS AND ASSAY",
    line: "Every listing is assayed on arrival. The hostile one is flagged before pricing.",
  },
  proofs: {
    kicker: "PROOFS",
    line: "The shortlist writes a piece of the real job. A description is free; a sample is not.",
  },
  negotiate: {
    kicker: "NEGOTIATE",
    line: "Arithmetic over the ask, the floor and the budget. No model touches it.",
  },
  contract: {
    kicker: "CONTRACT",
    line: "Paying is minting. The credits become that many uses on one capability.",
  },
  "verify-and-settle": {
    kicker: "VERIFY AND SETTLE",
    line: "Work that fails verification is not paid for. Reputation moves on outcomes only.",
  },
  "kernel-ledger": {
    kicker: "KERNEL LEDGER",
    line: "The kernel's own audit stream, not our account of it.",
  },
  "check-it-yourself": {
    kicker: "CHECK IT YOURSELF",
    line: "The receipt this deal just produced, opened in the page that checks it.",
  },
  valid: {
    kicker: "VALID",
    line: "Checked in the reader's own browser against the published key.",
  },
  tampered: {
    kicker: "TAMPERED",
    line: "One authorisation flipped from allowed to denied.",
    quote: '"outcome": "allowed"   ->   "denied"',
    under: "The same check refuses it.",
    emphatic: true,
  },
  "the-floor": {
    kicker: "THE FLOOR",
    line: "Who may touch what, read from the kernel rather than kept by us.",
  },
  "owner-decisions": {
    kicker: "OWNER DECISIONS",
    line: "Decided before the room opened, refusals included.",
  },
  withdrawn: {
    kicker: "WITHDRAWN",
    line: "A contract grant dies with its order. The permission is gone; the record is not.",
  },
  close: {
    kicker: "CLOSE",
    line: "Marketplaces gave humans reputation, contracts and time.",
  },
};

const OPEN_LINE = "The market where agents hire agents.";
const CLOSE_LINE =
  "Marketplaces gave humans reputation, contracts and time. Agents have none of that yet.";

/* ----------------------------------------------------------------- build */

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r3 = (n) => Number(n.toFixed(3));

function mark(suffix, px) {
  // Inline so nothing is fetched at render time; ids are namespaced so the two
  // instances do not collide in the assembled document.
  let svg = readFileSync(MARK, "utf8").trim();
  for (const id of ["peel", "leaf"]) {
    svg = svg.split(`id="${id}"`).join(`id="${id}-${suffix}"`);
    svg = svg.split(`url(#${id})`).join(`url(#${id}-${suffix})`);
  }
  return svg.replace("<svg ", `<svg class="mark" width="${px}" height="${px}" `);
}

function plan() {
  const data = JSON.parse(readFileSync(BEATS, "utf8"));
  const beats = data.beats;
  const footageStart = OPEN_HOLD;
  const footageDur = data.duration;

  const known = new Set(Object.keys(COPY));
  for (const b of beats) {
    if (!known.has(b.label)) throw new Error(`beats.json has an unknown beat: ${b.label}`);
  }

  const cards = [];
  const skipped = [];
  for (const b of beats) {
    const copy = COPY[b.label];
    const span = b.end - b.start;
    const avail = span - LEAD - TAIL;
    if (avail < MIN_CARD) {
      skipped.push({ label: b.label, span: r3(span) });
      continue;
    }
    // Lower-thirds label a stage, so they enter just after their beat opens.
    // The emphatic card instead names a refusal that the page has not made
    // yet when the beat opens, so it is anchored to the beat's END: it takes
    // the last stretch of the beat and lands on the verdict, whatever the
    // exact second a re-record puts that verdict at.
    let dur, start;
    if (copy.emphatic) {
      dur = Math.min(avail, MAX_EMPHATIC, EMPHATIC_SHARE * span);
      start = footageStart + b.end - TAIL - dur;
    } else {
      dur = Math.min(avail, MAX_CARD);
      start = footageStart + b.start + LEAD;
    }
    // The load-bearing invariant: a card never spans a beat boundary.
    const lo = footageStart + b.start;
    const hi = footageStart + b.end;
    if (start < lo - 1e-9 || start + dur > hi + 1e-9) {
      throw new Error(
        `card "${b.label}" [${r3(start)}, ${r3(start + dur)}] escapes its beat [${r3(lo)}, ${r3(hi)}]`,
      );
    }
    // data-track-index is only a Studio display lane; spreading the cards over
    // four of them keeps any one lane readable.
    cards.push({
      ...copy,
      label: b.label,
      start: r3(start),
      dur: r3(dur),
      track: 1 + (cards.length % 8),
    });
  }

  const closeStart = r3(footageStart + footageDur - CLOSE_LEAD);
  const total = r3(footageStart + footageDur + CLOSE_HOLD);
  if (total > 120) throw new Error(`runtime ${total}s exceeds the two-minute ceiling`);

  return { footageStart, footageDur: r3(footageDur), cards, skipped, closeStart, total };
}

function html(p) {
  const openGone = r3(OPEN_HOLD + OPEN_FADE); // the open is fully dissolved here
  const openDur = r3(openGone + 0.25); // clip window holds a little past it
  const closeDur = r3(p.total - p.closeStart);

  const cardEls = p.cards
    .map((c) => {
      const body = c.emphatic
        ? `
          <p class="lt-line lt-line-big">${esc(c.line)}</p>
          <p class="lt-quote" id="q-${c.label}">${esc(c.quote)}</p>
          <p class="lt-under" id="u-${c.label}">${esc(c.under)}</p>`
        : `
          <p class="lt-line">${esc(c.line)}</p>`;
      return `      <div class="clip card" id="card-${c.label}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="${c.track}">
        <div class="lt${c.emphatic ? " lt-emphatic" : ""}" id="lt-${c.label}">
          <p class="lt-kicker"><i class="dot"></i>${esc(c.kicker)}</p>${body}
        </div>
      </div>`;
    })
    .join("\n");

  const tweens = p.cards
    .map((c) => {
      const rise = c.emphatic ? RISE_EMPHATIC : RISE;
      const end = r3(c.start + c.dur);
      // The card is fully gone a beat before its clip window closes, so the
      // fade never straddles the boundary and nothing is sampled mid-dissolve.
      const outEnd = r3(end - Math.max(0.36, 0.08 * c.dur));
      const out = r3(outEnd - OUT_DUR);
      if (out <= c.start + IN_DUR) throw new Error(`card "${c.label}" has no hold between its fades`);
      let s = `tl.fromTo("#lt-${c.label}", { opacity: 0, y: ${rise} }, { opacity: 1, y: 0, duration: ${IN_DUR}, ease: "power2.out" }, ${c.start});
  tl.to("#lt-${c.label}", { opacity: 0, y: -8, duration: ${OUT_DUR}, ease: "power1.in" }, ${out});
  tl.set("#lt-${c.label}", { opacity: 0 }, ${outEnd});`;
      if (c.emphatic) {
        // Weight without new vocabulary: the same fade + rise, arriving in steps.
        s += `
  tl.fromTo("#q-${c.label}", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.36, ease: "power2.out" }, ${r3(c.start + 0.3)});
  tl.fromTo("#u-${c.label}", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.36, ease: "power2.out" }, ${r3(c.start + 0.52)});`;
      }
      return "  " + s;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Yuzu — submission film</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      /* Fonts are the product's own, subset and served from disk so a render
         never reaches the network. */
      @font-face {
        font-family: "Fraunces";
        font-style: normal;
        font-weight: 300 700;
        font-display: block;
        src: url("assets/fonts/fraunces.woff2") format("woff2");
      }
      @font-face {
        font-family: "JetBrains Mono";
        font-style: normal;
        font-weight: 400;
        font-display: block;
        src: url("assets/fonts/jetbrains-mono.woff2") format("woff2");
      }
      @font-face {
        font-family: "JetBrains Mono";
        font-style: normal;
        font-weight: 600;
        font-display: block;
        src: url("assets/fonts/jetbrains-mono.woff2") format("woff2");
      }

      :root {
        --parchment: #faf7f2;
        --ink: #171310;
        --ink-3: #5f564f;
        --accent: #6d4bd4;
        --mark: #f0a04b;
        --serif: "Fraunces", Georgia, serif;
        --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--parchment); }
      body { font-family: var(--serif); color: var(--ink); }

      .clip { position: absolute; inset: 0; width: 1920px; height: 1080px; }

      #footage { object-fit: cover; z-index: 0; }

      /* ---- lower-thirds: the lower-left eighth, never the centre ---- */
      .card { display: flex; align-items: flex-end; padding: 0 0 72px 72px; z-index: 2; }

      .lt {
        max-width: 760px;
        background: var(--parchment);
        border: 1px solid #e4ddd2;
        border-left: 3px solid var(--accent);
        padding: 24px 34px 27px 30px;
        box-shadow: 0 10px 34px rgba(23, 19, 16, 0.13);
      }

      .lt-kicker {
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--mono);
        font-weight: 600;
        font-size: 15px;
        letter-spacing: 0.16em;
        color: var(--ink-3);
        margin-bottom: 13px;
      }
      .dot {
        display: block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--mark);
        flex: 0 0 auto;
      }

      .lt-line {
        font-family: var(--serif);
        font-weight: 400;
        font-size: 34px;
        line-height: 1.3;
        letter-spacing: -0.012em;
        color: var(--ink);
      }

      /* ---- the one emphatic moment ---- */
      .lt-emphatic { max-width: 1080px; border-left-width: 6px; padding: 30px 44px 34px 38px; }
      .lt-emphatic .lt-kicker { color: var(--accent); font-size: 17px; margin-bottom: 17px; }
      .lt-line-big { font-size: 58px; line-height: 1.16; letter-spacing: -0.02em; }
      .lt-quote {
        font-family: var(--mono);
        font-weight: 400;
        font-size: 26px;
        letter-spacing: 0.01em;
        color: var(--ink);
        background: #f1ebe0;
        border: 1px solid #e4ddd2;
        padding: 12px 18px;
        margin-top: 22px;
        display: inline-block;
      }
      .lt-under {
        font-family: var(--serif);
        font-size: 30px;
        line-height: 1.3;
        color: var(--ink-3);
        margin-top: 20px;
      }

      /* ---- full-bleed open and close, on the same ground as the footage ---- */
      .bleed { z-index: 5; }
      .bleed-inner {
        width: 100%;
        height: 100%;
        background: var(--parchment);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .mark { display: block; }
      .wordmark {
        font-family: var(--serif);
        font-weight: 400;
        font-size: 116px;
        letter-spacing: -0.03em;
        line-height: 1;
        margin-top: 26px;
        color: var(--ink);
      }
      .bleed-line {
        font-family: var(--serif);
        font-weight: 400;
        font-size: 40px;
        line-height: 1.4;
        letter-spacing: -0.008em;
        color: var(--ink-3);
        text-align: center;
        max-width: 1180px;
        margin-top: 26px;
      }
      .rule { width: 96px; height: 2px; background: var(--accent); margin-top: 34px; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${p.total}"
      data-width="1920"
      data-height="1080"
    >
      <video
        id="footage"
        class="clip"
        src="assets/yuzu-demo.webm"
        data-start="${p.footageStart}"
        data-duration="${p.footageDur}"
        data-track-index="0"
        muted
        playsinline
      ></video>

${cardEls}

      <div class="clip bleed" id="open" data-start="0" data-duration="${openDur}" data-track-index="9">
        <div class="bleed-inner" id="open-inner">
          <div id="open-stack">
            ${mark("open", 132)}
            <p class="wordmark">Yuzu</p>
          </div>
          <p class="bleed-line" id="open-line">${esc(OPEN_LINE)}</p>
        </div>
      </div>

      <div class="clip bleed" id="close" data-start="${p.closeStart}" data-duration="${closeDur}" data-track-index="10">
        <div class="bleed-inner" id="close-inner">
          ${mark("close", 108)}
          <div class="rule" id="close-rule"></div>
          <p class="bleed-line" id="close-line">${esc(CLOSE_LINE)}</p>
        </div>
      </div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      /* open: fade + a small rise, then a short dissolve into the footage */
      tl.fromTo("#open-stack", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.15);
      tl.fromTo("#open-line", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 0.6);
      tl.to("#open-inner", { opacity: 0, duration: ${OPEN_FADE}, ease: "power1.inOut" }, ${OPEN_HOLD});
      tl.set("#open-inner", { opacity: 0 }, ${openGone});

      /* lower-thirds */
${tweens}

      /* close: the same dissolve, run backwards out of the footage */
      tl.fromTo("#close-inner", { opacity: 0 }, { opacity: 1, duration: ${CLOSE_LEAD}, ease: "power1.inOut" }, ${p.closeStart});
      tl.fromTo("#close-rule", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${r3(p.closeStart + 0.75)});
      tl.fromTo("#close-line", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, ${r3(p.closeStart + 0.95)});

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

const p = plan();
if (!process.argv.includes("--check")) writeFileSync(OUT, html(p), "utf8");

console.log(`beats      ${p.cards.length + p.skipped.length}`);
console.log(`cards      ${p.cards.length}`);
for (const s of p.skipped) console.log(`skipped    ${s.label} (beat is only ${s.span}s)`);
console.log(`footage    ${p.footageStart}s -> ${r3(p.footageStart + p.footageDur)}s`);
console.log(`runtime    ${p.total}s`);
