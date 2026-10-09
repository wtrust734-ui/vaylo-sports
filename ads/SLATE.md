# Vaylo Sports — 5-ad social slate

**Status: 5 ads planned, 5 ads built.** Every ad is a running, frame-accurate animated file in this
folder. Open one, press play, scrub, hit record. No footage was available, so the ads are built as
**type-and-UI motion ads** using the app's real design tokens and real screen copy — the one format
that is fully deliverable today with zero assets.

---

## 0. The strategic problem, and the one lever that solves it

The audit is unambiguous: **every AI surface in this product fails closed right now.**
`generate-plan`, `coach-chat`, `ai-analyze`, `video-form-analysis` all throw on a missing
`OPENAI_API_KEY` ([generate-plan/index.ts:29-30](supabase/functions/generate-plan/index.ts)). So
"AI-powered", "personalised plan", "AI coach", "form analysis" are all **unadvertisable**.

But one flagship claim is *not* AI-gated:

> **VPR — the Vaylo Performance Rating — is computed locally, in the browser, from the athlete's
> own logged metrics** ([vprSystem.ts:18](src/lib/vprSystem.ts) → `calculateVPR`), across six
> weighted domains, weighted per sport.

`calculateVPR` is pure math over rows the athlete logged themselves. **It works today, with no
provider key, no fair-usage gate, and no flag.** It is the only thing in the product that is
simultaneously (a) unique, (b) verifiable, and (c) live.

So the entire slate is built on one argument:

> **Everyone tracks. Nobody scores you. Vaylo does.**

"Generic gets you nowhere" (ad 1) is the emotional hook. The score is the proof. That is a claim we
can defend in a comment section, which is the only test that matters.

### Shippable claim ledger

| Surface | Status | Usable in ads? |
|---|---|---|
| **VPR rating** (6 domains, sport-weighted) | Local math, live | **YES — hero claim** |
| **Multi-sport** (16+ sports incl. football, rugby, golf, MMA) | Static config, live | **YES** |
| **Learning library** (16 technique / 13 training / 9 strength / 7 recovery lessons) | Real content | **YES** |
| **Event Packs** (10–20wk, 17+ sports) | Real catalog | **YES — duration/realism only, no price** |
| **Log-your-own-metrics model** | Local + Supabase reads | **YES — the mechanism** |
| AI training plan | `generate-plan` fails closed | **NO** |
| AI coach / chat | `coach-chat` fails closed | **NO** |
| Form / video analysis | `video-form-analysis` fails closed | **NO** |
| Injury-risk engine | Credit-gated + AI scaffold | **NO** |
| Nutrition planning | AI-gated | **NO** |
| Price / subscription | `/subscription` = "Checkout coming soon" | **NO — no price, ever** |
| Wearables, coach marketplace | Feature flags OFF | **NO** |

**Global compliance line** (burned into every ad's end card, small, 2 lines max):
> VPR is calculated from metrics you log. Vaylo Sports is not a medical device and is not
> professional advice. Train to your own ability.

**Also note:** two app screens still say "Premium plan" for a retired tier
([Mental.tsx:72](src/pages/Mental.tsx), [FormAnalysis.tsx:215](src/pages/FormAnalysis.tsx)). Those
screens are **not** used as ad source material until fixed.

### What the device UI in these ads is

The app screens are **reconstructed in HTML from the real rendered copy in
`.freebuff/ui-audit/report.json`**, populated with plausible training data. They are **not
screenshots** and the 47 captured PNGs are unusable commercially (empty review account). When real
populated screenshots exist, they drop straight into the same slots — every UI slot in the ads is a
swappable layer. Tracked in `ads/README.md`.

---

## 1. The five ads

Deliberately **five different formats**, not five edits of one video. One campaign, five jobs, five
different failure modes to test.

| # | Ad | Format | Aspect | Dur | Job | Primary placement |
|---|---|---|---|---|---|---|
| 1 | **THE SCORE** | Vertical brand film, typographic | 9:16 1080×1920 | 25.0s | Brand + product comprehension | Reels, TikTok, Shorts |
| 2 | **6-SECOND STOP** | Interruption bumper, one number | 9:16 1080×1920 | 6.0s | Stop the scroll, brand name only | Paid social, Shorts |
| 3 | **THE SCORE, EXPLAINED** | 4-frame motion carousel | 4:5 1080×1350 | 4×3.0s | Test copy with no video spend | Meta feed, IG, X |
| 4 | **ONE SPORT** | Sport-specific vertical slice | 9:16 1080×1920 | 12.0s | Prove multi-sport with football alone | Football interest targeting |
| 5 | **HOW THE SCORE IS BUILT** | Mechanism explainer | 1:1 1080×1080 | 18.0s | Trust the mechanism; retargeting | Feed, retargeting, site |

**Why this mix.** Ad 1 is the asset. Ad 2 is the interruption. Ad 3 is the cheap test — if the
carousel copy converts, that copy goes into ad 1's hook. Ad 4 is the vertical-specificity bet: one
sport, real football content, no dilution. Ad 5 is the one that survives a sceptic, and it is the
only ad whose claims are pure product mechanics with zero puffery.

### Ad 1 — THE SCORE (25.0s)
**Hook:** "YOU'VE BEEN TRACKING FOR YEARS. SCORED BY NOTHING." (the wound)
**Turn:** the counter climbs while the app logs nothing, and a number lands.
**Argument:** six domains, one number, your sport's weighting.
**Proof:** real VPR screen, 62 rating, all six bars filled, sport "Football · weighted by sport profile".
**End card:** "YOUR SPORT. YOUR SCORE." + compliance.
No VO. Sound design only.

### Ad 2 — 6-SECOND STOP (6.0s)
One number. No app UI. No product tour.
`0.0` black → `0.3` **0** → `1.4` counter races **0→62** → `3.0` **"AND YOU'VE NEVER BEEN SCORED."** →
`4.4` wordmark. Cut on the beat. Built to be the retargeting creative that costs 6 seconds of a scroll.

### Ad 3 — THE SCORE, EXPLAINED (4 frames, 4:5)
Frame 1 the wound. Frame 2 the six domains. Frame 3 the sport weighting. Frame 4 the score + CTA.
Feed-native, readable with sound off, no video required — the cheapest way to find out which line
earns the tap.

### Ad 4 — ONE SPORT (12.0s)
Football only. Real app content: "football finishing technique", Striker Finishing event pack, sport
filter chips, "Sport: Football · Weighted by sport profile". Proves the multi-sport claim by
committing to the hardest one, without claiming breadth we can't show in 12 seconds.

### Ad 5 — HOW THE SCORE IS BUILT (18.0s)
The ad for people who don't believe marketing. Shows the actual mechanism end to end: log a metric →
six domains fill → sport weighting applied → VPR. **No adjectives at all.** Every claim is
something the viewer can verify themselves. This is the ad to run against the sceptic, and the
safest asset in the set — it has no claim that can age badly.

---

## 2. Rules every ad obeys

1. **No AI claim.** Not "AI-powered", not "AI coach", not "personalised by AI". Ever.
2. **No price.** No £, no "/month", no "free trial" (there is no checkout). "Start free" only,
   because the Free tier and 85 welcome credits are real and the app is genuinely usable.
3. **No medical claims.** No injury prediction, no rehab, no "prevent injury".
4. **No price/feature that lives behind a flag** — wearables, coach marketplace, subscription.
5. **Compliance line on every end card.**
6. **Subtitled by construction.** All type is burned-in; nothing depends on sound.
7. **No athlete likeness.** No real people, no real faces, no stock bodies presented as users.

---

## 3. Files

```
ads/
  SLATE.md      this plan
  README.md     how to run, how to export, asset swap list, honest limitations
  core.css      brand tokens + motion primitives (mirrors src/index.css exactly)
  core.js       frame-accurate timeline engine + player UI
  ad1-the-score.html      25.0s  9:16
  ad2-6-second-stop.html   6.0s  9:16
  ad3-explained.html      4×3.0s 4:5
  ad4-one-sport.html     12.0s  9:16
  ad5-how-built.html     18.0s  1:1
  build.mjs     inlines core.* into standalone per-ad HTML in dist/
```

## 4. Still to do before these run for money

- Regenerate app screenshots from a **populated** account (the audit account is empty).
- Fix the "Premium plan" copy in `Mental.tsx` and `FormAnalysis.tsx`.
- Replace `src/assets/logo.jpg` (14 KB raster — it cannot be animated; needs vector or ≥1000px PNG).
- Resolve BE-37 before any paid spend lands on a signup flow.
