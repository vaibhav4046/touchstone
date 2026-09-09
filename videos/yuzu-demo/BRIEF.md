---
workflow: general-video
flow: automation
storyboard: no
message: "Paying is minting: a credit is a grant use, so the money and the permissions cannot disagree"
destination: hackathon-submission
aspect: 1920x1080
language: en
length: 100s
angle: product-demo
---

## Intent

The submission film for Yuzu, a market where AI agents hire other AI agents,
entered in the SharedOS Arena. It plays to hackathon judges who will watch a
lot of these back to back and who are, correctly, sceptical of anything a demo
asserts about itself.

So the footage does the arguing and the graphics only label it. The capture is
a real browser session against the live deployment: a real deal runs, a real
seller is paid, and the receipt that deal produced is opened in the page that
verifies it — then one field of that receipt is edited on camera and the same
check refuses it. Nothing is staged and nothing is re-enacted.

There is no narration. Every word the viewer gets is on the screen, so the
type has to carry the argument on its own: short, flat, declarative. Nothing
that reads like a product video. Closer to a lab notebook than a launch.

## Assets

- ../../work/recording/yuzu-demo.webm — the screen capture, produced by
  `scripts/record-demo.mjs` against https://yuzu-market.vercel.app. The only
  footage in the piece.
- ../../work/recording/beats.json — the measured second of every beat in that
  capture, written by the same script. Every card in this composition is timed
  from this file and never from a guess; re-record and the timings move with
  it.
- ../../public/art/yuzu-mark.svg — the mark, for the open and the close.

## Customizations

- Title cards at the beat boundaries `beats.json` names, each holding one
  sentence. The sentence is the beat's `note`, tightened.
- A lower-third label during the deal beats naming the stage on screen, since
  the timeline in the product moves faster than a first-time viewer reads.
- The tampered-receipt beat gets the only emphatic moment in the piece: the
  verdict flips from valid to refused, and the card names what changed.
- Cold open on the mark, cold close on the mark and one line.

## Notes

- Palette comes from the product, which is cream and ink with a purple accent
  and a warm orange mark: `--parchment #faf7f2`, ink `#171310`, accent
  `#6d4bd4`, mark orange `#f0a04b`. The footage is the light theme, so cards
  must sit on the same ground rather than cutting to black.
- Serif for the display type, monospace for anything quoted out of the
  product. The site pairs those two and the film should not introduce a third.
- No transitions that draw attention to themselves: no swipes, no 3D, no
  glows. A cut and a short fade are the whole vocabulary.
- Never put a number on screen that is not in the footage under it. This
  project has an audit trail for a reason and a film that invents a statistic
  would be the one dishonest artefact in it.
- The capture is 1920x1080 and roughly 78 to 100 seconds. The piece should not
  exceed two minutes.
