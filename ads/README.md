# Vaylo Sports — ad creative

Five social ads. All five are **running, frame-accurate motion files**, not mockups.
Read [SLATE.md](SLATE.md) first for the strategy and the claim ledger.

## Run them

Open `ads/dist/index.html` for the contact sheet, or any `ads/dist/adN-*.html` directly.

> The contact sheet embeds each ad in an iframe, so it works when the folder is opened from disk.
> Some sandboxed preview servers only serve a single registered file and will show empty frames
> there — open the individual `adN-*.html` files directly if that happens.

Each file is **fully self-contained** — CSS and JS are inlined, fonts come from Google,
there are no image assets. Email one to an editor and it works on their machine.

### Player controls

| Control | Action |
|---|---|
| `Space` | play / pause |
| `R` | restart |
| `←` `→` | step one frame (hold `Shift` for one second) |
| `G` | toggle safe-area guides |
| `Clean` | hide all chrome — this is the record mode |
| drag the scrubber | the timeline is fully scrubbable, pixels and all |

Click the stage to play/pause. The amber ticks on the scrubber are the cut points.

### Frame addressing — every ad is also a still

Any ad can be opened frozen on an exact timecode, which is what makes the keyframe
contact sheets and a frame-by-frame video export possible:

```
ad1-the-score.html?t=12.6         freeze on 12.6s
ad1-the-score.html?t=12.6&play    start there and run
ad1-the-score.html?t=12.6&clean=1 chrome off — a clean still for a deck
ad1-the-score.html?t=12.6&guides=1  with the Reels safe areas drawn on
```

`ads/dist/frames-*.html` are generated shot lists — each ad's own cut points rendered
as stills. They are built from the same data the ad runs on, so a storyboard can never
drift from the edit.

## The compliance audit is built in

Every ad ships with `vayloAudit()`. Open the console on any ad and run it. It walks all 30fps
of the timeline and checks:

- no copy sits under Reels/TikTok chrome (bottom bar, right rail)
- nothing overflows the canvas
- nothing is below a 20px legibility floor at rest (15px inside device mocks — that is
  imagery, not copy; a scale-in transient is not counted against it)
- exactly one scene is live at a time, so no cut double-exposes
- **every cue actually arrives** — a show-cue that quietly never lands is invisible, and
  geometry checks cannot see it
- **the frame is genuinely on screen** — a stage scaled about its centre inside a smaller
  wrapper renders off-screen while every element-relative measurement still looks perfect

All five currently return **`CLEAN`**, and that result is only meaningful because the audit
grew out of four real bugs it initially failed to catch. Re-run it after any edit.

### One engine rule

All movement is driven by `element.animate()` and seeked with `animation.currentTime`.
There are **no CSS `@keyframes` and no `.anim-*` utilities** in `core.css`, on purpose: a CSS
animation runs on the document timeline, so it cannot be seeked to a timecode and would
desynchronise a frame-by-frame export. If you add a move, add a cue to the ad file.

## The slate

| # | File | Format | Aspect | Dur | Job |
|---|---|---|---|---|---|
| 1 | `ad1-the-score.html` | Vertical brand film | 9:16 | 25.0s | Brand + product comprehension |
| 2 | `ad2-6-second-stop.html` | Interruption bumper | 9:16 | 6.0s | Stop the scroll, brand name only |
| 3 | `ad3-explained.html` | 4-frame motion carousel | 4:5 | 12.0s | Test copy with no video spend |
| 4 | `ad4-one-sport.html` | Football-only cutdown | 9:16 | 12.0s | Vertical specificity bet |
| 5 | `ad5-how-built.html` | Mechanism explainer | 1:1 | 18.0s | Retargeting; no adjectives |

## Exporting to video

There is no ffmpeg or Puppeteer in this workspace, so the ads ship as HTML rather than MP4.
Any of these produces frame-perfect video, because the timeline is deterministic:

```bash
# 1. Playwright (simplest)
npm i -D playwright && npx playwright install chromium
node -e "
const {chromium} = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + process.cwd() + '/ads/dist/ad1-the-score.html');
  await p.waitForTimeout(2500);                       // let fonts settle
  await p.evaluate(() => { ad.pause(); ad.seek(0); });
  await p.evaluate(() => document.querySelector('.deck').setAttribute('hidden-soft',''));
  await p.evaluate(() => { document.getElementById('stage').style.transform = 'none'; });
  await p.video ? null : null;
  await b.close();
})();"
# then drive page.screenshot() at 1/30s steps and stitch with ffmpeg -framerate 30

# 2. Screen record in Chrome: open the ad, press Clean, record the window.
```

Because every cue is positioned in **seconds** and seeked via `animation.currentTime`, a
frame-by-frame export lands on exactly the frames you see when scrubbing. Nothing depends on
wall-clock timing.

### Audio

There is no audio in any of these. That is a deliberate choice, not an omission: ~85% of feed
views are muted, so the ads are built to work silent and the music bed is a finishing pass.
Suggested cue points are on the amber scrubber ticks.

## Editing

| What | Where |
|---|---|
| Brand colour, gradient, type | `core.css` top block — mirrors `src/index.css` exactly |
| Copy and structure | the `.scene` blocks in each ad file |
| Timing | the `ad.add(...)` / `ad.count(...)` calls at the bottom of each ad file |
| Cut points | the `[[seconds, 'label']]` arrays feeding `ad.beat()` |

Change the tokens in `core.css` and all five ads move together. **Do not** hard-code a colour
in an ad file.

```bash
node ads/build.mjs     # re-inline core.* into dist/
```

`ads/adN-*.html` are the sources and link `core.*` relatively (works with a local server).
`ads/dist/*.html` are the build output and are what you ship. Never hand-edit `dist/`.

## What still has to happen before these run for money

These are not stylistic notes. Each one is a blocker.

1. **The app screens in ads 1 and 4 are reconstructions, not screenshots.** They are rebuilt in
   HTML from the real rendered copy in `.freebuff/ui-audit/report.json`, because the 47 captured
   PNGs are from an **empty** review account and would be embarrassing in an ad. Populate an
   account, capture real screens, and drop them over `.phone` — the copy inside is verbatim, and
   the numbers are plausible placeholders (`62`, `71/84/58/66/49/61`) that must be replaced with
   a real athlete's real data.
2. **Fix the "Premium plan" copy** in [Mental.tsx:72](../src/pages/Mental.tsx) and
   [FormAnalysis.tsx:215](../src/pages/FormAnalysis.tsx) before any screen reaches a customer.
3. **Replace `src/assets/logo.jpg`.** It is a 14 KB raster and cannot be animated or scaled up.
   The ads deliberately use a type-only wordmark instead. A vector lockup would let you animate it.
4. **Resolve BE-37** (`manage-subscription.activate_legacy_disabled` grants 30 days of elite to
   any authenticated caller) before any paid spend lands on a signup flow.
5. **Ad 2 carries the short compliance line only** — `VPR is calculated from metrics you log.` —
   because a 6-second bumper cannot legibly hold a full disclaimer. The full line belongs in the
   ad's primary text / caption. Do not ship ad 2 without it there.

## Copy that must not be added

These are forbidden in any Vaylo ad until the underlying thing works:

- **anything AI** — "AI-powered", "AI coach", "personalised by AI". Every AI edge function
  hard-fails without a provider key, so these claims are currently false.
- **any price** — no £, no "/month", no "free trial". There is no checkout: `/subscription`
  toasts "Checkout coming soon".
- **wearables / health sync / coach marketplace** — all three are feature-flag off.
- **injury prediction, prevention or rehabilitation** — credit-gated and AI-scaffolded.
- **"clinically proven", "diagnostic"** — never.

The one claim all five ads stand on: **VPR is computed locally, on the athlete's device, from
the metrics they log.** That is the only flagship claim that is simultaneously unique and
verifiable today, and it is the reason the whole slate hangs on a number.
