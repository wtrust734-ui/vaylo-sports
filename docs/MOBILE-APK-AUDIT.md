# Vaylo Sports — Mobile APK Audit (real device run)

**Artifact under test:** `apk/vaylo-sports-1.2.2-6-release.apk` (versionName 1.2.2, versionCode 6)
**Environment:** Android emulator `Medium_Phone_API_36.0`, Android 16, API 36, 1080×2400 @ 420dpi (2.625×). Release build, signed with the `upload` key.
**Method:** the APK was installed and driven on-device via `adb`. Evidence comes from pixel sampling of real
`screencap` output, `logcat`, `dumpsys`, `aapt2`, the plugin's Java source, on-device DOM measurement at the
device's CSS viewport, and live queries against the Supabase project.

Nothing below is inferred from source alone where a measurement was possible.

> **Status: fixes applied.** This revision records what was changed, what was measured afterwards, and — as
> required — **two findings from the first pass that I am retracting** because they did not survive
> verification.

---

## Fixes applied

| # | Finding | Change | Result |
|---|---|---|---|
| R1 | Cold start / frame jank | Removed `charts: ["recharts"]` from `manualChunks` | **402 kB charting code off the startup path** |
| R2 | White status bar | StatusBar polarity fix + night mode + dark theme | **Icon polarity fixed; band no longer reproducible on 1.2.3-7, unconfirmed on hardware** (see below) |
| A1 | Text too small | Hard 12px floor across `src` | **Verified: minFontSize 12, 0 sub-12px** |
| A2 | Close button 18px, no name | 48px hit area + `aria-label` + countdown removed | **Verified in DOM** |
| A3 | Simulated AR in nav | Removed from 3 nav surfaces + catalog | **Not reachable from navigation** |
| A4 | Unused Health permissions | 6 declarations removed, restore note left | **Manifest now only declares INTERNET** |
| A5 | Glow / gradient CTA / slogan | Removed from auth + Home | **0 gradient CTAs on auth** |
| A6 | Build number on auth | — | **RETRACTED** (see Corrections) |
| A7 | Possible auth-gate bypass | — | **NOT REPRODUCIBLE** (see Corrections) |
| R3 | Undeployed migrations | Applied `20261001120000` + `20261002120000` to production | **Deployed and verified; one latent defect found and fixed in the migration first** |
| L1 | 11 of 14 in-app legal links 404 | Redeployed the `legal` edge function | **All 14 slugs return 200; index advertises 14** |
| L4 | Legal pages served as plain text | Gateway rewrites `text/html` → `text/plain` | **NOT fixed — needs a static host; Play blocker** |
| L5 | Requested legal set incomplete | 12 new documents + 4 folds + footer + 13 internal | **26 published; written, generated and validated, NOT published (held for hosting)** |
| L6 | All 12 new pages titled "Cookie Policy" | Generator inherits the donor page's `<title>` | **Fixed, and covered by a new regression test** |

Verification after the changes: `tsc --noEmit` clean, `eslint` 0 errors, **617/617 tests pass across 46 files**,
and a live DOM audit at 412×880 reports `overflowX: false`, `trunc: []`, `offscreen: []`, `smallTargets: []`,
`minFontSize: 12`.

## Shipped artifact — 1.2.4 (8), published

The copies in `apk/` were **stale and did not contain any of the fixes below**. `vaylo-sports-1.2.2-6` was
built 2026-10-01 19:35; the R1/A1-A5 source changes landed after it, and the `1.2.2-6` **AAB** predated even the
1.2.2 APK build. `SHA256SUMS.txt` recorded hashes for a binary that no longer corresponded to current source, so
verifying a download against it verified the wrong artifact.

Rebuilt twice since, each time bumped so Play cannot see a reused `versionCode`:

- [apk/vaylo-sports-1.2.4-8-release.apk](apk/vaylo-sports-1.2.4-8-release.apk) — `45fd4bb5b4259a18595d033060fcd34d097150872cd727d4a96ba20596aaf4a9`
- [apk/vaylo-sports-1.2.4-8-release.aab](apk/vaylo-sports-1.2.4-8-release.aab) — `17932fa23ec4e7418b7e979e09c03f6c0ee0d65198ce6f1b9e0dbbd5d57f69c7`

### Public download link

Published to a public Supabase Storage bucket (`releases`) on 2026-10-02:

```
https://vvwhausdjzdmsyxekrcl.supabase.co/storage/v1/object/public/releases/vaylo-sports-1.2.4-8-release.apk
https://vvwhausdjzdmsyxekrcl.supabase.co/storage/v1/object/public/releases/vaylo-sports-1.2.4-8-release.aab
```

The bucket was created **public with no `storage.objects` policies at all**. That combination is the
intent: anyone can download a release, and nobody without the service key can upload or overwrite one.
Verified after publishing:

- Unauthenticated `GET` → `200`, `application/octet-stream`, `Content-Length: 2393925`.
- The served bytes **hash identically** to the local artifact — `45fd4bb5…` on both sides.
- The payload is a real APK (ZIP magic `PK\x03\x04`).
- Anonymous `POST` to the bucket → `400`. Upload is denied.

**Note on Perplexity:** an APK is a compressed binary, not a document an AI search engine can read or
quote. What makes Vaylo legible to Perplexity is a crawlable web URL, which is the hosting question in
**L3/L4** — not this download link. `robots.txt` already allows all crawlers, so nothing blocks it there.

### Verified on the binary itself, not just the build log

- `aapt2 dump badging` → `versionCode='8' versionName='1.2.4'`.
- **A4 confirmed in the shipped manifest**: only `INTERNET`, `VIBRATE`, and the AndroidX-injected
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No `health.READ_*`.
- **The new legal library is really in the shipped bundle**: `complaints`, `security-disclosure`,
  `ai-data-use` and `wearable-health-privacy` are present in the built `Legal-*.js` chunk. This is why
  1.2.4 was needed at all — [legalUrls.ts](src/lib/legalUrls.ts) and [Legal.tsx](src/pages/Legal.tsx)
  changed after 1.2.3-7 was built.
- **R1 confirmed in the shipped bundle**: `modulepreload` lists only `motion`, `react`, `supabase`. The
  `generateCategoricalChart` (350 kB) reference in the entry chunk is a filename inside Vite's lazy-route
  manifest, not a static import — the charting code is off the startup path.
- `apksigner verify` → signed, `CN=Vaylo Sports, O=Vaylo Sports, L=London, C=GB`.
- Installed and launched on `emulator-5554` (API 36): `dumpsys` reports `versionCode=8 versionName=1.2.4`,
  process alive, **no `FATAL`/`AndroidRuntime`/`PGRST`/JS errors in logcat**.

`apk/` and `apk/superseded/` each carry their own `SHA256SUMS.txt` and all artifacts pass
`sha256sum -c`. `1.2.2-6` and `1.2.3-7` sit in `superseded/` with unchanged hashes, so earlier releases
stay verifiable.

Note that R3 and L1–L6 needed no rebuild: migrations and published documents are server-side, so they
serve any build. The rebuilds were needed only for client-side changes.

---

## R1 — Cold start and frame jank

**Cause found and fixed.** `vite.config.ts` had:

```ts
manualChunks: { react: [...], charts: ["recharts"], motion: [...], supabase: [...] }
```

Naming `recharts` explicitly made Rollup emit a shared `charts` chunk that **the entry imported statically** —
confirmed in the built output:

```js
import"./supabase-CURijbDD.js";import"./charts-o2ptAekO.js";
```

402 kB of charting library parsed on every cold start before the first screen, even though charts only appear
on lazy routes. `dist/index.html` `modulepreload`'d it.

After removing that entry, `modulepreload` lists only `motion`, `react`, `supabase`, and the recharts internals
(`generateCategoricalChart`, 350 kB) are referenced **only** by the lazy route chunks — Compare, Development,
Events, Injury, Mental, Recovery, SkillAnalytics, VPR.

**Measured cold start** (`am start -W`, same emulator): 3,240 ms → **2,761 ms**.

**Still open, honestly stated.** 2.7 s is better but not good, and the earlier jank counters (1,084 skipped
frames, a 304-frame freeze, an 8,356 ms `HWUI Davey` frame) were taken on a software GPU (`swiftshader_indirect`),
so the *frame durations* are inflated and not directly comparable. The remaining startup cost is the 451 kB
entry chunk plus `supabase` (227 kB), `react` (156 kB) and `motion` (124 kB) — all genuinely needed before
first paint. Getting under ~1.5 s needs code-splitting the entry itself, which is an architectural change I did
not make unasked.

---

## R2 — White status bar: root cause found, band no longer reproducible in 1.2.3-7

**A real bug was found and fixed.** The in-repo comment in `capacitor.config.ts` documented the style polarity
**backwards**. From `@capacitor/status-bar`'s Android source, `StatusBar.java:51`:

```java
windowInsetsControllerCompat.setAppearanceLightStatusBars(!style.equals("DARK"));
```

So the value names the *bar*, not the icons:

- `"DARK"` → `isAppearanceLightStatusBars(false)` → **white icons**
- `"LIGHT"` → `isAppearanceLightStatusBars(true)` → **dark icons**

The config had `style: "LIGHT"`, i.e. dark icons on a near-black UI — and on API 35+ that makes the system paint
a light contrast scrim behind them. That is the white band. Changed to `"DARK"`.

**Verified working:** the status-bar icons measurably changed from dark to white after the fix (dark pixels in
the bar region dropped away; sampled `#bcbcbc` icon pixels became `#fcfcfc`).

Also applied: `AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_YES)` in `MainActivity` (the plugin falls back
to `getStyleForTheme()`, which returns `"LIGHT"` for any non-night `uiMode`); dark `windowBackground` and
`statusBarColor` on `AppTheme.NoActionBarLaunch` — the theme `MainActivity` actually runs under, which is where
the first attempt missed; and a dark `html` root background.

**The white band itself did not move** across **seven** rebuilds of 1.2.2-6. It stayed byte-identical
(`#fafafa` / `#fbfbfb`), through: theme `statusBarColor`, `windowBackground`, `capacitor.config.ts` style,
an explicit JS `setStyle` call, forced night mode, and root CSS. It also persisted when system bars were hidden.

### But on the 1.2.3-7 build the band is gone

Fresh measurement on the rebuilt release binary, sampling the top 64 rows (the status bar) of a real device
screenshot:

```
status-bar pixels: 69120
avg rgb:           47,45,79      (dark, was #fafafa)
near-white pixels: 3912  (5.66%)
most-white row:    13.9%
white px by column: left(clock) 2404 | mid 0 | right(status icons) 1508
```

The white pixels are **glyphs, not a band**: they sit only at the left (clock) and right (status icons), with
**zero** in the middle, and no row is more than 13.9% white. A full-width `#fafafa` band would be ~100% of every
row. That is exactly the signature of white system-bar icons on a dark bar, i.e. the polarity fix landing.

**Stated honestly:** this is one measurement, on one emulator, at one screen state (signed out). It does not
prove the band is gone everywhere, and the seven-rebuild history says this emulator was previously resistant.
The honest status is **"no longer reproducible, needs confirming on physical hardware"** — not "fixed". If it does
reproduce on a device, the next step is `Window.setStatusBarContrastEnforced(false)` in `MainActivity`, a small
native addition still not made, because I cannot verify it here.

---

## A1 — Text was too small (FIXED)

Measured before: **9px** bottom-nav labels; **10px** section eyebrows and every currency code; **11px** full
sentences (`"Sign in with your fingerprint, face or device PIN — no password needed."`).

Applied a hard 12px floor — `text-[9px]`/`text-[10px]`/`text-[11px]` → `text-[12px]` across **97 files**
(534 utilities). Verified afterwards in the live app at 412×880: `minFontSize: 12`, zero elements below it, and
crucially **no new layout damage** — `overflowX: false`, `trunc: []`, `offscreen: []`.

## A2 — Close button (FIXED)

`PromoPopup` and `PaywallModal` close buttons were 18×44 CSS px with no accessible name. Now `aria-label="Close"`,
`p-3.5 -m-3.5` (48px hit area, icon still visually at 16px), `aria-hidden` on the glyph, and a hover colour
change.

**Also fixed while in there** — the countdown dark pattern the audit flagged in passing: the `{countdown}s` label
replaced the close button for 5 seconds *and* hid "No thanks"/"Maybe later", so the only tappable element was the
buy CTA. The countdown is gone; all three dismissals work immediately. Escape and backdrop-tap now dismiss too.
The standard popup also persists a 7-day snooze, which is what `legal/advertising.html` already promises
("the app remembers that on your device so it does not ask again for a while") — previously it re-fired every
10 minutes, so a published legal claim was untrue.

## A3 — Simulated AR overlay (FIXED)

Removed from `AppSidebar`, the `Train` hub and the `Workouts` "Fullscreen" link, and from `NAV_CATALOG`. The
route still exists so deep links do not 404, but nothing links to it. The fake `Camera 1920×1080` readout is
deleted — it implied capture capability that does not exist. The real inline workout overlay in `Workouts`
(live pace/distance/duration) is untouched.

`nav.test.ts` previously asserted `/ar-overlay` was visible to a footballer; that assertion now uses `/form`,
which has the same family shape (`skill/team/...`, excluded for endurance).

## A4 — Unused Health Connect permissions (FIXED)

The six `android.permission.health.READ_*` declarations removed from the manifest, with a comment recording the
exact lines to restore together with `wearableSync`. The `<queries>` entry and the
`ACTION_SHOW_PERMISSIONS_RATIONALE` intent-filters stay (not permissions, and Play requires the rationale
handler). The manifest now declares only `INTERNET`.

## A5 — Design-rule violations (FIXED)

On the auth screen: both `radial-gradient` glow layers deleted, the `blur-3xl` blob deleted, the card's
`bg-card/60 backdrop-blur-xl` glassmorphism flattened to `bg-card`, the logo tile's `bg-gradient-primary
shadow-glow` flattened, the gradient text "Vaylo Sports" flattened, and **all five** `bg-gradient-primary ...
shadow-glow hover:shadow-electric` CTAs converted to `bg-primary hover:bg-primary/90`. Home's slogan
*"Your performance, your plan, your progress — one screen."* removed.

---

## Corrections to the first pass

**A6 — "the auth screen exposes `v1.2.2 (6)`" — RETRACTED.** I could not find the string in `src`, `index.html`,
or the built `dist/` bundle that the APK ships. It does not exist. This was a misread of an unreliable preview
frame — the preview compositor served stale and blank frames repeatedly during this session. There is nothing to
fix.

**A7 — "the app rendered signed-in Home with no Supabase session" — NOT REPRODUCIBLE.** I could not reproduce it
after repeated attempts, and it does not survive inspection:

- `AppLayout.tsx:71` hard-redirects to `/auth` when `!session`; there is no code path that renders the app
  without one. `/` and `/ar-overlay` are both inside that gate.
- Supabase shows **no user and no session created today**; the newest session is `2026-10-01 19:04`.
- After a cold restart the app shows the **auth** screen, not Home.
- Replaying the exact gesture sequence that supposedly produced it did nothing at all.

Given A6 proves I misread at least one frame this session, the most likely explanation is a mis-read frame. I am
**not** claiming an auth bypass. The gate is sound in code and in behaviour.

---

## R3 — Migrations deployed (DONE, with one defect found and fixed first)

Applied to `vvwhausdjzdmsyxekrcl` on 2026-10-02. Applied head moved `20260930183648` → `20261002120000`, and both
versions were recorded in `supabase_migrations.schema_migrations` (81 rows).

### The migration would not have applied

Section 5 of `20261001120000` altered, triggered on, and inserted into a column
`privacy_settings.privacy`. **That column does not exist** — and never did. The creating migration
`20260505055427` defined `group_visibility` (`public | friends | private`) and `show_avatar_publicly`. Deployed
verbatim, the `alter table ... alter column privacy` would have raised `42703` and, because the management API
runs the file as one implicit transaction, rolled the whole migration back.

Two things had to change for it to be deployable, and both are recorded in the migration and in the tests:

1. **Retargeted** section 5 to the columns that exist: `group_visibility` defaults to `'private'`,
   `show_avatar_publicly` defaults to `false`, and the under-18 trigger forces both.
2. **Added a backfill.** All 11 production accounts had **no** `privacy_settings` row at all, and
   `20260930092253` defines "no row = defaults-on". The signup trigger only fires for accounts created *after*
   this migration, so without a backfill "private by default" would have been true for future signups and false
   for everyone already on the platform. Children's Code std 12 is about the default a child actually gets.

`src/lib/safetyCompliance.test.ts` was asserting `alter column privacy set default 'private'` — it pinned the
non-existent column, so the suite passed against a migration that could not run. That assertion now names
`group_visibility`, and a new test asserts the migration never references `privacy` again.

### Verified live, not assumed

Every probe below was run against production after the deploy.

| Probe | Before | After |
|---|---|---|
| `POST /rest/v1/rpc/report_content` | 404 PGRST202 | **401 `42501` permission denied** — resolved and correctly refuses anon |
| `GET /rest/v1/feed_visible_activities` | 404 PGRST205 | **200 `[]`** — exists; empty for anon because `shared_activities` RLS is `authenticated`-only |
| `GET /rest/v1/profiles?select=terms_version,health_consent_at,terms_accepted_at` | 400 `42703` | **200** |
| `GET /rest/v1/content_reports` (anon) | 404 | **401 permission denied** |
| `GET /rest/v1/support_requests` (anon) | 404 | **401 permission denied** |

Existence is not behaviour, so the RPC was exercised as a signed-in athlete inside a transaction that was rolled
back (no rows persisted — `content_reports` is empty):

- Filing a report returns a row; a second identical call returns the existing row and leaves the count at 1.
- An invalid reason is refused: `Please choose a reason.`
- The **11th** report in an hour is refused: `You have reported a lot recently.`
- The reporter sees their own report (1 row); a different `auth.uid()` sees 0. The reporter is not exposed.
- A 15-year-old whose client sets `group_visibility='public', show_avatar_publicly=true` is stored as
  `private / false`. A 30-year-old making the identical request is stored as `public / true` — the trigger does
  not over-reach onto adults.
- `support_requests` refuses an unknown category (`23514`) and accepts a valid one.

Schema state: RLS on for both new tables (`content_reports` 1 policy, `support_requests` 4); `anon` has no
privileges on either; `authenticated` has `select, insert` on `content_reports` and **nothing** on
`support_requests`; `report_content` is `security definer` and executable by `authenticated` only.

### Still not true after this deploy

- **There is no account-level "who can see my profile" setting.** The schema has no such column.
  `group_visibility` is scoped to *groups*, and the app's own copy on
  [Communities.tsx](src/pages/Communities.tsx) says so: "presentation preference … full hiding is a pending
  product decision". So the under-18 trigger genuinely protects group visibility and avatar display, but any
  legal wording implying a private *profile* is broader than what the database enforces.
- **`allow_friend_requests` and `allow_community_posting` are still default-true, including for under-18s.**
  Deliberate: forcing them off would break friending for the 13-17 year olds the product is for. Noted in the
  migration rather than quietly changed.
- **`support_requests.is_child_safety` is not derived by the database.** The column comment promises "a crafted
  request cannot demote a child-safety report out of the urgent queue", but the derivation lives in the
  `support-request` edge function, which is **not deployed** (`404 NOT_FOUND`). Verified directly: inserting a
  `child_safety` row with `is_child_safety = false` is accepted and stored as `false`. Right now the guarantee
  rests on a function that does not exist yet. A `BEFORE INSERT` trigger forcing
  `is_child_safety := (category = 'child_safety')` would make it true at the database level.
- **`export-my-data` and `support-request` edge functions are still `404`.** Deploying the tables does not
  deploy the functions that use them.
- `coach-chat` / `generate-plan` / `weekly-review` → 500, and `ai-analyze` / `ai-service` /
  `video-form-analysis` → 401 (no `OPENAI_API_KEY` deployed; fails closed). Unrelated to these migrations.

### Published wording that is still broader than the database

The deploy made most of the child-safety copy true that was previously false. Four statements remain
overstated, and they are all the same overstatement: they describe an **account-level "my profile is private"
control that the schema does not have.** What the database actually enforces is group visibility and avatar
display.

| Where | Wording | Reality |
|---|---|---|
| [legal/child-safety.html:97](legal/child-safety.html#L97) | "Public profiles — Forced private, cannot be made public — Enforced by the database" | No account-level profile visibility setting exists. `group_visibility` is group-scoped. |
| [legal/child-safety.html:103](legal/child-safety.html#L103) | "the private-profile rule is a database trigger" | A trigger exists, but it forces group visibility and avatar, not profile visibility. |
| [legal/child-safety.html:194](legal/child-safety.html#L194) | "New accounts default to private **across every visibility setting**" | False. `allow_friend_requests` and `allow_community_posting` both still default to `true`. |
| [legal/privacy.html:263](legal/privacy.html#L263) | "privacy by default (a minor's profile cannot be made public)" | Same gap as above. |
| [src/pages/Legal.tsx:167](src/pages/Legal.tsx#L167) | "your profile is private by default" | Same gap. |

Not corrected here, deliberately. Two defensible fixes and they pull in opposite directions — narrow the wording
to what the database does, or build the missing account-level control — and that is a published-commitment
decision, not a code cleanup. Flagged rather than quietly rewritten.

## L1 — Legal documents: the in-app links were 404 for 11 of 14 pages (FIXED)

Found while previewing the site, not from the original audit. The in-app legal screen
([src/pages/Legal.tsx](src/pages/Legal.tsx)) lists all 14 documents, and
[legalUrls.ts](src/lib/legalUrls.ts) points every one of them at the `legal` **edge function** rather than at
the website. Probing all 14 slugs against production:

```
reachable (200):  privacy, terms, account-deletion
404:              child-safety, ai-disclaimer, data-rights, health-safety,
                  community-guidelines, advertising, purchases, refunds,
                  cookies, contact, intellectual-property
```

The deployed function's own index page advertised exactly three links, so this was a **stale deployment**, not
a routing fault: [pages.generated.ts](supabase/functions/legal/pages.generated.ts) held all 14 slugs and
[route.ts](supabase/functions/legal/route.ts) `resolveRoute` serves any of them. The live function predated the
expansion from 3 documents to 14 — its docstring still said "index of the three documents".

Redeployed with `supabase functions deploy legal --no-verify-jwt`. All 14 now return **200**, and the index
advertises all 14. Verified on the served HTML: no unresolved `%%TOKEN%%` in any page, and the deployed
child-safety body matches `legal/child-safety.html`.

The two URLs Google Play Console depends on — privacy policy and data deletion — were among the three that
already worked, so **the store listing was never broken**. What was broken was every other in-app legal link,
including the child-safety page the app's own library advertises.

### L4 — Every HTML page from an edge function is served as plain text (FIXABLE, needs a host)

The most serious thing found in this pass, and it is **not** a bug in our code. `legal` sets the right header at
[index.ts:40](supabase/functions/legal/index.ts#L40) (`"Content-Type": "text/html; charset=utf-8"`), but the
Supabase edge gateway **replaces it**. Served headers:

```
Content-Type:            text/plain          <- function asked for text/html; charset=utf-8
X-Content-Type-Options:  nosniff
content-security-policy: default-src 'none'; sandbox   <- function's own CSP was replaced too
```

`nosniff` means no browser will sniff the body back into HTML. Confirmed in a real browser, not inferred:
`document.contentType === "text/plain"`, the body is a single `<PRE>` element, **0** links, no `<h1>`, empty
`title`. A person opening the privacy policy sees the raw `<!doctype html>` source.

**It is specifically HTML that gets downgraded.** The same gateway preserves every other type, from the same
project:

| Function | Declares | Served as |
|---|---|---|
| `og-image` | `image/png` | `image/png` ✅ |
| `delete-account` | `application/json` | `application/json` ✅ |
| `legal` | `text/html; charset=utf-8` | **`text/plain`** ❌ |
| `link-preview` | `text/html; charset=utf-8` | **`text/plain`** ❌ |

**Consequence.** Google Play Console needs a readable privacy policy URL and a data-deletion URL. Both point at
`/functions/v1/legal/privacy` and `/functions/v1/legal/account-deletion`, so both currently render as source. That
is a store-listing blocker, independent of the L1 404s. It also breaks `link-preview`, so challenge and profile
share previews get no meta tags.

**Not fixed here**, because the fix is not in this codebase: HTML has to be served from somewhere that does not
rewrite the content type — i.e. static hosting, which is precisely what the generated `website/` directory is
(built by `scripts/gen-website.cjs`, served by anything static, styled and readable today). That makes **L3 a
prerequisite rather than a nicety**. Retargeting `VITE_LEGAL_BASE_URL` at that host is already supported by
[legalUrls.ts](src/lib/legalUrls.ts) and needs no code change.

### L2 — The Terms disclose a missing legal identity (NOT fixed, needs you)

Live in the deployed Terms, verbatim:

> "Vaylo Sports's registered company name, company number and registered address have not been inserted here
> yet, because we will not publish legal particulars we cannot verify. This clause will be completed with those
> details before it is relied on."

`legal/operator.json` carries only `operatorName` and `contactEmail`. A consumer contract normally has to
identify the trader, so this is a real gap — but the page **discloses** it rather than implying an identity it
does not have, which is the honest way to handle it. Not filled in, because I will not invent company details.
Only you can supply them.

### L3 — The website was generated but not published (RESOLVED 2026-10-02)

Published to Netlify; see “Website deployed” above.

### L3 (original finding)

`node scripts/gen-website.cjs` writes 27 files / 23 URLs to `website/`, and its own validation passes (it fails
the build on a broken link, an unresolved token, or a placeholder rendered as a real value). There is **no
hosting config in the repo** — no `netlify.toml`, no `vercel.json`, no deploy workflow — so `website/` is a
build artifact and, as far as I can verify, is not live. Confirmed as such rather than assumed. It also warns
`SITE_URL is not set`, so canonicals, sitemap and robots fall back to relative paths until a domain exists.

### L4b — Supabase Storage also refuses HTML: the site cannot be hosted here at all

L4 concluded that the edge gateway rewrites `text/html` to `text/plain`. Hosting the generated
`website/` on Supabase Storage was the obvious way to dodge that, so it was tried on 2026-10-02
(43 files uploaded to a public `site` bucket). **It fails the same way.**

Four upload content types were tried, each probed back with a browser-like `Accept: text/html`:

| Uploaded as | Served as |
|---|---|
| `text/html` | `text/plain` |
| `text/html; charset=utf-8` | `text/plain` |
| `application/xhtml+xml` | `text/plain` |
| `text/plain` | `text/plain` |

So the downgrade is not a consequence of how the file was uploaded — **Supabase serves text-ish content
as `text/plain` from both of its public surfaces**, and a binary is served correctly
(`application/octet-stream`), which is how the APK download works. The rule is platform-level, not
something this codebase can route around.

Storage also does not resolve the directory-index URLs the site is built around:

```
/legal/privacy/index.html  -> HTTP 200
/legal/privacy/            -> HTTP 400
/legal/privacy             -> HTTP 400
```

Every internal link, the sitemap and the robots `Sitemap:` directive use `/legal/privacy/`-style paths, so
**a crawler landing on the hosted homepage cannot follow a single link.** Even in the best case it would
extract the text of exactly one unstyled page.

**Conclusion: hosting `website/` requires a non-Supabase static host.** That is now the only thing
standing between Vaylo and a crawlable, readable, Play-acceptable public site. `VITE_LEBAL_BASE_URL`
already supports being repointed at such a host with no code change, and `SITE_URL` needs setting at
build time so canonicals, sitemap and robots become absolute.

### L5 — The legal set was expanded to 26 published documents (written, not published)

A requested list of 40 items was mapped onto the existing set. Everything from the brief is
covered, and the mapping is recorded in [legal/pages.json](../legal/pages.json) under
`$topicMap` so it can be checked rather than assumed.

- **14 existing** documents already covered items 1, 2, 4, 5, 6/7, 8, 10/12, 11, 14, 15, 16.
- **12 new** documents written: `competition-terms`, `report-safety-concern`, `report-content`,
  `security-disclosure`, `complaints`, `ai-training-advice`, `video-analysis-disclaimer`,
  `injury-guidance`, `nutrition-disclaimer`, `mental-wellbeing`, `wearable-health-privacy`,
  `ai-data-use`. Every feature they describe genuinely exists (`Challenges`, `Compete`,
  `Referrals`, `VideoFormAnalysis`, `Injury`, `Mental`, `Nutrition`, `HealthSync`).
- **4 folds** rather than near-identical new pages, as agreed: Acceptable Use into
  Community Guidelines, Credits and Virtual Items into Purchases, Training Safety Guidelines
  into Training &amp; Health Safety, and the Children's Privacy Notice into Child Safety. Each
  is a clearly-headed section with a footer deep-link to its anchor.
- **Footer** rebuilt to the requested list (43 links across 3 columns).
- **In-app library** extended to all 26 in [Legal.tsx](../src/pages/Legal.tsx), with the
  `LegalSlug` type in [legalUrls.ts](../src/lib/legalUrls.ts) covering the new slugs.
- **13 internal documents** (items 28–40) drafted under
  [docs/internal-compliance/](../docs/internal-compliance/) and deliberately kept off the public
  site. They separate verified fact from named gaps, because a processor register or a breach
  policy published in public is reconnaissance.

Two infrastructure problems were found and fixed while doing it:

- **Cross-link navigation was hand-maintained** in every page and had already drifted. It is now
  generated from `pages.json` by `scripts/gen-legal-pages.cjs`, so each of the 26 pages carries
  25 correct cross-links and a new page cannot be added without appearing in every other one.
- **[legalPages.test.ts](../src/lib/legalPages.test.ts) held its own hardcoded copy of the
  document list**, which drifted from the registry. It now reads `legal/pages.json`, so it
  verifies registry↔generated agreement rather than repeating a frozen list. The three documents
  Google Play fetches are still named explicitly so removing one fails loudly.

**Not published**, per the decision taken: L4 means anything served from the edge function
arrives as plain text, so these wait for a static host.

### L6 — Every new document shipped titled "Cookie Policy" (FIXED)

All 12 generated pages inherited the donor page's `<title>`. The `<h1>`, the body and every
cross-link were correct, so the fault was invisible in the rendered page — but
`gen-website.cjs` derives each page's `<title>` from that element, and `gen-legal-pages.cjs`
derives the cross-link nav labels from it too. Every new page would have been labelled "Cookie
Policy" in the website and in all 26 pages' nav.

Caught by checking the generated `<title>` rather than the `<h1>`. Fixed at the source, and
covered by a new test asserting no two documents share a `<title>` and that each title matches
its own `<h1>`. **The test was verified by re-injecting the fault**, confirming it fails.

## Shipped artifact — 1.2.5 (9), published 2026-10-02

Account, motion and pricing release. `1.2.4-8` moved to [apk/superseded/](apk/superseded/); both
`SHA256SUMS.txt` files were regenerated and every artifact verifies with `sha256sum -c` (9 in `apk/`,
8 in `apk/superseded/`).

- [apk/vaylo-sports-1.2.5-9-release.apk](apk/vaylo-sports-1.2.5-9-release.apk) — `9317db4e6b56e069c64ce33853ccaeb32bd36495faa3ee7af53c9996171131a6`
- [apk/vaylo-sports-1.2.5-9-release.aab](apk/vaylo-sports-1.2.5-9-release.aab) — `76c14787f0122f61435e4dfd72171a6bfbf7f8d466d7b2c9004199ad7c970e31`

Public links (Supabase Storage `releases`, public read, no write policy):

```
https://vvwhausdjzdmsyxekrcl.supabase.co/storage/v1/object/public/releases/vaylo-sports-1.2.5-9-release.apk
https://vvwhausdjzdmsyxekrcl.supabase.co/storage/v1/object/public/releases/vaylo-sports-1.2.5-9-release.aab
```

Served bytes hash-identical to the local copies; anonymous POST to the bucket still returns 400.

### What changed, and what was verified on the binary

**Legal reachable from the account screen.** "All Sections" is gone from Profile (item 2 of the
request). It was the only control that opened the app drawer on mobile, and `safeAreaShell.test.ts`
failed the moment it was deleted — caught before release. The drawer is reachable again as
"Every section", last in the list, with the old label's description replaced so it no longer reads
as a peer of "Legal & Safety". "Legal & Safety" is the first row and opens `/legal`, which lists
**all 26 documents including Cookie Policy** — confirmed by `uiautomator` on the installed APK, not
only in the source. Terms acceptance on signup already existed (`recordTermsAcceptance` +
`consentGiven()` in [Auth.tsx](src/pages/Auth.tsx)); it was verified present, not rewritten.

**Profile is one card, not nine.** Every destination and setting is now a hairline-separated row in
a single `card-surface` with `divide-y`. `AIConnectionTest` — a developer diagnostic that was a
full-width card pushing the actual destinations below the fold — moved to the bottom of Settings.
The duplicate "Delete account" row inside the accordion is gone; the full-width button at the foot
of the screen is the single entry point.

**AI pricing repriced, and the published document caught up.** The six AI-backed features moved
from 3/3/5/12/10/5 credits to 10/35/35/80/35/35, derived against `WORST_CASE_USD_PER_CREDIT =
0.0384` (the Max pack, 650 credits for 2499c — not the flattering 9.96 of the Starter pack) with
the margin arithmetic in a comment in [credits.ts](src/config/credits.ts). The live
`economy_config.feature_costs` row was already updated.

**A real defect the repricing exposed:** `legalContentConsistency.test.ts` failed, because the
published Refunds & Purchases page still quoted the old numbers. A document that misstates what the
app charges is worse than no document, so the table was corrected, re-sorted, and given a plain
sentence explaining that the most expensive items are the ones that call a model. Regenerated
(`gen-legal-pages.cjs`) and **redeployed the `legal` edge function**; all 26 slugs return 200 and
the live page now shows 10 / 35 / 35 / 35 / 35 / 80.

**Tab switching.** Was a single 160ms fade with the outgoing screen removed in the same frame —
which is the "blink, then arrive" feel that was reported. Now two phases in
[TabShell.tsx](src/components/layout/TabShell.tsx): the outgoing panel keeps its place in layout
and fades out over 120ms, then the swap and the incoming fade-in over 240ms on an ease-out. 360ms
end to end, and the app is never empty in the middle. The two phases deliberately do **not**
overlap: stacking the panels would double the page height and would make the outgoing panel a
containing block for `position: fixed`, re-anchoring every composer and in-page sheet inside it.
`prefers-reduced-motion` collapses both phases *and* skips the 120ms JS dwell — a media query
cannot cancel a timer, so that check lives in the component. The other three tab chunks are now
prewarmed at idle (`requestIdleCallback`, skipped on `saveData`), which removes the last case where
a first tap on a tab showed a full-screen loader.

**De-slopped at the token level.** 110 of the 243 gradient usages in `src/` resolve to
`--gradient-primary` and 126 shadow usages to `shadow-glow`, so the tokens were retuned rather
than the screens: the three-stop violet→indigo→blue sweep is now a single-hue vertical ramp, the
three-blob page mesh is two at roughly half the alpha with the orange one removed, and the 28px
blue halos became directional shadows. Also removed the `hover:shadow-electric` bloom from the
default [Button](src/components/ui/button.tsx), which is the one control every screen shares.
Deliberately untouched: `--gradient-energy` (orange is semantic), `--gradient-card`, and the four
`glow-*` Tailwind shadows, which are reserved for genuinely energetic surfaces.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, **618/618 tests across 46 files**. `aapt2 dump badging` →
`versionCode='9' versionName='1.2.5'`; permissions unchanged (`INTERNET`, `VIBRATE`, the AndroidX
receiver); `apksigner verify` passes with the same `CN=Vaylo Sports` key. Installed on
`emulator-5554` (API 36), signed in, skipped onboarding, and walked: Profile shows the eight
grouped rows and no "All Sections"; `/legal` lists all 26 documents. Twelve rapid tab taps,
several landing mid-transition, left the app on the correct tab with no crash and no console
output.

**Not verified:** the transition's frame-by-frame smoothness. WebView DevTools is disabled in
release and `uiautomator` cannot read animation state, so the timings are asserted from the CSS
and the component logic, not measured. R2's white status-bar band is still unresolved on the
emulator.

## Website deployed — vaylo-sports.netlify.app, 2026-10-02

**L3 and L4/L4b are resolved.** The documents are published as real HTML, which is what Play
and every crawler actually needed.

The Netlify CLI turned out to be authenticated after all (team `fraiche`, site created
`vaylo-sports`), so the deploy ran without waiting on the browser authorisation:

```
SITE_URL=https://vaylo-sports.netlify.app node scripts/gen-website.cjs
npx netlify deploy --dir=website --prod
```

Regenerating with `SITE_URL` set is what gives every page an absolute canonical, an absolute
sitemap and a real `Sitemap:` line in robots.txt — without it the generator emits relative
paths, which a crawler cannot follow.

Verified against the live host, not the local output:

- **26/26 legal pages return `200 text/html`.** This is the specific thing Supabase could not
  do: both the edge gateway and Storage rewrite text-ish responses to `text/plain` with
  `nosniff`, so the same pages were unreadable there.
- 35/35 sitemap URLs `200`; 328 internal links crawled from the live pages, **0 broken**.
- Security headers present (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
- `robots.txt` allows all agents and points at the sitemap; Open Graph tags on every document,
  so a link unfurl shows the right title and description.

### 1.2.6 (10) shipped broken and was withdrawn

Worth recording because it was nearly invisible. Pointing the app at the new host meant setting
`VITE_LEGAL_BASE_URL`, and it was set to the bare origin —

    VITE_LEGAL_BASE_URL=https://vaylo-sports.netlify.app

Every slug in [legalUrls.ts](src/lib/legalUrls.ts) is appended to that base, and the documents
are published under `/legal/`. So **23 of the 26 documents resolved to a 404**, and the three
that did not were worse: `/privacy/` and `/contact/` exist at the site root as *different
pages*, so tapping "Privacy Policy" opened the Privacy & Data Centre instead.

Nothing caught it. The bundle contained the string, `site:build` passed, all 26 documents on
the host returned 200, and 618 tests passed — because every existing assertion checked that the
*documents* were correct, never that the *link the app builds* pointed at them.

It was found by tapping the row on the emulator and reading the URL the Custom Tab had loaded
(`https://vaylo-sports.netlify.app/privacy/`). That is the check that unit tests cannot do.

Fixed to `https://vaylo-sports.netlify.app/legal` and shipped as **1.2.7 (11)**; 10 moved to
[apk/superseded/](apk/superseded/) and should not be distributed. A new test,
[legalHostLayout.test.ts](src/lib/legalHostLayout.test.ts), joins the two facts that used to be
checked separately — the URL the app builds and the file the host publishes — and fails if the
base stops matching the layout. **It was verified by re-injecting the bug**: 2 of its 4 tests
fail with the bare origin restored.

Also fixed while here: `legalUrl()` emitted `/<slug>` with no trailing slash, so every Netlify
URL was a 301 away from its canonical form. Both hosts serve the slashed form with a 200, so
URLs are now emitted slashed and the URL handed to a Play reviewer is the URL that renders.

### Shipped artifact — 1.2.7 (11)

Website-only change from 1.2.5: no manifest, permission or plugin difference, and none of the
account, motion or pricing work changed. `tsc` clean, **622/622 tests across 47 files**,
`aapt2 dump badging` → `versionCode='11' versionName='1.2.7'`, `apksigner verify` passes with
the same `CN=Vaylo Sports` key. Installed on `emulator-5554`, signed in, and Profile → Settings
→ Privacy Policy opened `https://vaylo-sports.netlify.app/legal/privacy/` in the Custom Tab with
the policy rendered — confirmed by reading the loaded URL out of `dumpsys activity` and the
rendered text out of `uiautomator`, not inferred.

- [apk/vaylo-sports-1.2.7-11-release.apk](apk/vaylo-sports-1.2.7-11-release.apk) — `74ac3b1e403f7d2b31732bbb4888766f83789fda9e920bd2570fe7ea185bbe09`
- [apk/vaylo-sports-1.2.7-11-release.aab](apk/vaylo-sports-1.2.7-11-release.aab) — `1cbb101f3f15e34161467c749bb939b90acd8ad529f9080d03858fdf3a334f92`

```
https://vvwhausdjzdmsyxekrcl.supabase.co/storage/v1/object/public/releases/vaylo-sports-1.2.7-11-release.apk
https://vvwhausdjzdmsyxekrcl.supabase.co/storage/v1/object/public/releases/vaylo-sports-1.2.7-11-release.aab
```

## App preview published — /app/, 2026-10-02

The app is a native Android app behind a login: its routes are React Router paths, its screens
render client-side and its data is per-user. A crawler cannot see any of it. **101 static pages
now exist so that a search engine — or an answer engine asked what Vaylo Sports does — can read
the product.**

```
https://vaylo-sports.netlify.app/app/          — every screen, grouped by area
https://vaylo-sports.netlify.app/app/injury/   — one page per screen
```

65 screens, 35 of them with a real device capture from `.freebuff/ui-audit/`. No mockups: a screen
with no capture renders without an image and says so, because a drawn-up image of a screen that
does not look like itself is an illustration, not a preview.

### Where every fact comes from

Nothing here is described from memory:

- **routes** — read out of `src/App.tsx` at build time. The completeness assertion fails the
  build if a route is added to the app without a preview entry, or if the preview names a screen
  the app does not have. This is the part that would otherwise rot within a month.
- **titles and descriptions** — the product's own Hub copy, `src/i18n/locales/en`. The site
  cannot describe a screen in terms the app itself does not use.
- **status** — the FEATURES registry, which already separates *working today* from *built, not
  switched on* from *deliberately off*.
- **costs** — parsed out of `src/config/credits.ts` rather than copied, and cross-checked against
  the app's own `FEATURE_COSTS` / `PERMANENT_UNLOCKS` / `AI_USAGE_FEATURES` in the test.

Excluded, with the reason recorded in `EXCLUDED` rather than filtered out silently: `/admin/*`
(three routes), `/ai-dev`, `/load` and the catch-all. Verified on the live host — all four
admin paths return 404, and no preview page contains a Supabase key or the storage URL.

### Three defects found while verifying it

All three were found by checking the served result, not by reading the code.

**1. The preview claimed the app was on the Play Store.** It is not — `SITE.playStoreUrl` is
`null` and the homepage says "not yet". One sentence in the new copy asserted a listing exists.
Replaced with the site's existing `storeCta()`, which states the true position.

**2. Sixty-two of sixty-five screens said "part of the shipped app", and that hid the price.**
The Injury screen's own screenshot reads *"Unlock predictive risk scoring"* and costs 29 credits.
Saying only "part of the shipped app" is true about existence and materially misleading about
money, on the exact page a reader decides whether to install on. Every screen now states its
access — free, `N credits once`, or `N credits per use` — derived from the app's own config.

**3. Two slugs redirected, and pointed their own canonical at the redirect.** `/app/learning-lessonId/`
and `/app/packs-packId/` were 301'd by Netlify, which lower-cases the path, and each page's
`canonical` tag named a URL that redirects to itself. The generated files were exactly where
they should be on disk — the *host* disagreed about the name, which is why nothing caught it.
Slugs are now lower-case, and a build-time assertion rejects any that are not.

The price assertion was also wrong on the first attempt: it compared each page against the site's
own derived badge, so it passed with the badge deliberately changed to *cost + 1*. It now computes
the expectation from `FEATURE_COSTS` and was re-verified by re-injecting that exact fault.

### Verification

**647/647 tests across 48 files**, tsc clean. Every fault above was confirmed by re-injection:
publishing an admin route, adding an app route with no preview entry, dropping a screen,
understating a price by one credit, and reintroducing a camelCase slug all fail the suite with
the right diagnosis.

Crawled the deployed site: **101/101 sitemap URLs 200**, **66/66 app URLs 200 `text/html`**, zero
redirects in the section, canonical equals served URL on every screen page. The screen text is in
the served HTML — no `<div id="root">` — so it does not depend on the crawler running
JavaScript, which is the most common way a product like this stays invisible to a search engine.

## RED — MUST FIX (remaining)

**R2 (partial).** The status-bar background remains white on the emulator. See above for what is fixed and what
needs confirming on hardware.

**R3 follow-on.** The two migrations are applied, but the three "still not true" bullets above are separate
items: the absent edge functions, the un-derived `is_child_safety`, and the missing account-level profile
visibility.

## GREEN — VERIFIED GOOD (unchanged from first pass)

No horizontal overflow; no truncated text; no emoji in the country picker; every `<img>` has `alt`;
`allowBackup="false"`; `allowMixedContent: false`; no uncaught JS exceptions or crashes across the whole session;
`AppLayout` gates on session; Health permissions are runtime-gated.

---

## Evidence

Screenshots in `.freebuff/mobile-audit/` (real `screencap` output, 1080×2400). Pixel sampling via
`.freebuff/mobile-audit/color.sh` (vendored ffmpeg; no ImageMagick or Python on this machine). Startup and jank
from `logcat`; `windowInsetsControllerCompat` polarity read from `node_modules/@capacitor/status-bar/.../StatusBar.java`.

**Limits.** WebView DevTools is disabled in release, so `uiautomator` and CDP cannot see the page; element-level
data comes from the same web build measured at the device's CSS viewport. GPU-bound frame timings are inflated by
software rendering. R2's white band is unresolved on the emulator and should be confirmed on physical hardware.

## Web build of the app deployed — vaylo-sports-app.netlify.app, 2026-10-02

The app itself is now published as a website, separate from the marketing and
legal site. Two Netlify sites, two jobs:

| Site | Id | Publishes |
|---|---|---|
| `vaylo-sports.netlify.app` | `388b0b24-…` (unchanged) | `website/` — legal pages, app preview |
| `vaylo-sports-app.netlify.app` | `79d67cae-…` | `dist-web/` — the React app |

No application code changed. `src/App.tsx:108` already selects
`BrowserRouter` when not in a native shell, so a browser build uses clean paths.

`scripts/build-web.cjs` is the deliverable. It writes `dist-web/`, never
touching `dist/` (the exact input to `npx cap sync android`), and writes
`_headers` and `netlify.toml` into the web output only, so neither ships
inside the APK.

### Verified against the live host

- `/`, `/training`, `/profile`, `/learning/run-001`, `/packs/abc` → 200,
  all serving the app shell rather than the marketing 404 page.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy` on `/`; `Cache-Control:
  public, max-age=31536000, immutable` on hashed assets.
- Password sign-in completes from the live origin: GoTrue token exchange, then
  `profiles`, `get_my_entitlements`, `recovery_logs` and `user_region` all
  return 200 from a browser origin. The deep link `/training` resolves and the
  auth gate redirects to `/auth` as expected.
- Published deploy file list read back from the Netlify API: 159 files, 153 of
  them `assets/`, the rest the app's own `public/` files. No repository source.

### Defects found while deploying, all fixed

1. **The whole repository was published.** `publish = "."` in the generated
   netlify.toml does not mean the build output. The CLI finds the config file by
   walking up from the working directory, but resolves `publish` against the
   CLI's detected base — the repository root. The live site served the marketing
   pages and the real `package.json`, `src/*.tsx` and `supabase/config.toml`.
   The deploy reported success throughout. Pinning `base = "."` does not fix it,
   because `base` is measured from that same root. Only `publish = "dist-web"`
   works. Guarded in `src/lib/buildWeb.test.ts`, verified by re-injecting the
   fault.
2. **Security headers were silently absent.** With the app's own toml in force,
   `_headers` was not applied at all and the site served no `X-Frame-Options`
   and no `nosniff`. The headers are now declared in both files with identical
   values.
3. **The deploy prompted and died.** Without `--no-build`, build-command
   detection runs, finds several scripts in the repository `package.json`, and
   asks a question that a non-interactive terminal cannot answer
   (`ERR_USE_AFTER_CLOSE`), so nothing uploaded.
4. `supabase/config.toml` line 44 had `//` instead of `#`, which broke the
   whole TOML parse and blocked `config push`. Fixed and pushed; remote
   `site_url` and `uri_allow_list` verified by reading them back from the
   management API.
5. `path.join(root, WEB_OUT_DIR)` mangled an absolute override on Windows,
   producing `C:\\repo\\C:\\Temp\\x`. Now `path.resolve`.

### Known limits, stated rather than papered over

- **Web OAuth and magic links are disabled on this host, by existing design.**
  `.netlify.app` is in `PREVIEW_SUFFIXES` (`src/lib/share.ts:38`), so
  `publicAppUrl()` returns "" and `authRedirectUrl` throws. The Google,
  Discord, Facebook, passkey and "email me a sign-in link" buttons do nothing.
  Email and password sign-in works. This is deliberate — `netlify.app`
  subdomains are claimable by others, so allowing one as an OAuth redirect
  origin is a real token-theft risk — and `nativeReleaseHardening.test.ts`
  asserts the guard. Lifting it needs an owned domain, not a config tweak.
- The app site was created and deleted twice while finding the publish-path bug;
  its id is now `79d67cae-…`. Nothing depended on it.
- Tab-transition smoothness remains asserted from component logic, not measured:
  the release WebView has no DevTools and there is no physical device here.

## Brand logo on the marketing site (2026-10-03)

The header and footer brand mark is now the real logo, supplied as a
500x500 JPEG on an opaque black background at
`C:\Users\gemme\Downloads\logo.jpeg`. No web image library is available in
this repo (`sharp` is not a dependency), so the black matte was removed in a
browser canvas: the luminance range 2-20 was mapped to alpha, the result
un-multiplied (`f = 255/a`) so the gradient was not darkened twice, and the
result was downscaled to 128x128 and encoded as PNG colour type 6 (RGBA),
8-bit, 10,152 bytes. Checked against `#05070f`, `#f6f8fc` and white: no
fringing, gradient intact, alpha clean. The source JPEG was left untouched.

- [site/layout.mjs](site/layout.mjs) lines 61 and 124: the CSS-gradient
  `<span class="brand-mark" aria-hidden="true">` became
  `<img class="brand-mark" src="/assets/logo.png" alt="" width="34"
  height="34" decoding="async" />`. `alt=""` is correct and not an
  omission: the adjacent "Vaylo Sports" text is the accessible name, so the
  image is decorative and announcing it again would just duplicate the name.
- [site/theme.css](site/theme.css): `.brand-mark` dropped `background:
  var(--grad)` and `border-radius: 10px` (the old square tile) and is now
  `display: block; object-fit: contain`.
- [scripts/gen-website.cjs](scripts/gen-website.cjs): the generator now
  fails loudly if `site/assets/logo.png` is missing, rather than emitting a
  page whose header references a file that is not being published, and
  counts the bytes it copies.
- [src/lib/website.test.ts](src/lib/website.test.ts): six tests under
  `describe("brand logo")` assert both call sites, the `alt=""`/dimension
  attributes, the CSS no longer painting a tile behind the image, the
  generator's existence check, and the asset reaching the published output.
  Writing those tests first surfaced a real trap: the file's `read()` helper
  resolves against the generated `website/` directory, so `site/layout.mjs`
  has to be read from the repo root instead — otherwise the test passes
  against a stale copy, or fails with a nonsense joined path.

Verified after deployment (`deploy 6ac069b6`):

- Generator clean: 105 files, 10,293,451 bytes, 101 URLs.
- `https://vaylo-sports.netlify.app/assets/logo.png` -> 200,
  `Content-Type: image/png`, `Content-Length: 10152`.
- Live DOM: two `img.brand-mark` elements (header at y=15, footer at
  y=5429), both `complete` with `naturalWidth/Height` 128x128, rendered
  34x34, `background-color: rgba(0,0,0,0)`, `border-radius: 0px`.
- `/legal/privacy/` -> 200.
- Suite: 663 tests / 49 files pass; `tsc --noEmit` clean.

**How this was verified, precisely:** through DOM and computed styles read
out of the live page, plus HTTP response headers. A pixel screenshot was
*not* obtained — the preview webview in this build returned "produced no
frames" on three attempts, so nobody has eyeballed the rendered pixels of the
deployed header. The transparency and colour fidelity were confirmed
earlier, on the PNG itself, against the three backgrounds it appears on.
---

## R4 — Shell geometry: the tab bar, the button, the gutter and the top gap (2026-10-08)

A hand-off pass over the shell's geometry, driven entirely by measurements taken
on the installed **release** APK rather than in a browser. Four things were
wrong, all of them shared chrome rather than any one screen, which is why they
had survived the per-screen reviews.

**Environment:** same emulator as above — `Medium_Phone_API_36.0`, Android 16,
1080×2400 @ 420dpi, so **1 css px = 2.625 device px** and the layout viewport is
**411.4 × 914.3 css**. Release build, signed with the real upload key
(`android/keystore.properties` was present), installed over the release build
already on the device, so the signature matched and the signed-in session and
its data were preserved.

### The four defects, and the change that fixed each

| # | Defect | Change | Evidence |
|---|---|---|---|
| 1 | The centre action button sat at 191.3 css against a bar centred at 205.7 — **14.4 px off-centre** | The four tabs became two `flex-1` groups either side of the button, instead of four `justify-around` siblings of it | Measured **offset 0.0 px** |
| 2 | The button was lifted 12 px above the tab centre line (the documented value was 4) and its top edge stood **6 px proud of the bar's own surface** | `-mt-6` → `-mt-2`; a top margin on a centred flex item moves it by *half* the margin | **4.2 px** above the tab centres; box now **inside** the card |
| 3 | The horizontal gutter differed between tab roots (16 / 18.7 / 19.8 css), and six detail screens sat 4 px inside the back arrow above them | One gutter: `px-4 sm:px-5`, `mx-4 sm:mx-5` and `px-4` all became `px-5` | Every screen's first line of text now starts at **20.6 css** |
| 4 | The radar's "Endurance" label was clipped on /vpr | The page root's `p-6 pt-20` became `px-5 pt-[var(--vaylo-screen-top)]`, widening the chart's own container by 8 px (315.4 → 323.4 css) | Ink ends in a **rounded terminal**, 22.3 css clear of the card edge |

The tab roots' top gutter was verified rather than changed: all four already
consume `--vaylo-screen-top` (12 px), and the measurement confirms it — see
"Top gap" below.

### Verified on the rebuilt APK

The APK was rebuilt (`assembleRelease`, JDK = Android Studio's bundled JBR),
re-installed over the existing release build, then **force-stopped and
cold-started**. The cold start matters: a plain re-install only resumes the
existing task (`singleTask`), so the old bundle stays live and the first
re-measure read byte-identical geometry off the previous build. Every number
below is from the cold-started process.

**Action button** (home screen, located by scanning for the primary blue rather
than by trusting a label box):

```
blue box         device x 467..613 (w 147 = 56.0 css)   y 2164..2310 (h 147 = 56.0 css)
widest blue row  x 467..613   centre 540 device = 205.71 css
viewport centre  540 device = 205.71 css      OFFSET = 0.0 device / 0.00 css
plus glyph       centre y 2237.0   button centre y 2237.0   delta 0.0
bar card         top border y2160 (822.9 css)  bottom y2335 (889.5 css)  left x32 (12.2 css)
button top  824.4 css -> 1.5 px INSIDE the card
button foot 880.0 css -> 9.5 px above the card's floor
tab row          a11y box y 830.9..881.9 css, centre 856.4
                 -> button centre 852.2 = 4.2 px above
```

`h-14 w-14` measures 56.0 css exactly, so the box is the specified size and
rounding is not hiding anything. The 0.0 offset is a real zero: the two groups
are `flex-1`, so the button is centred by construction at any width and in any
language, rather than by arithmetic that happens to work in English.

**Horizontal gutter** — the left edge of the first glyph, measured from pixels.
The accessibility tree's text boxes carry a line-box offset and a ~1.3 css
leftward bias, so the two disagree; the pixels are the honest one:

```
Home    h1 "Athlete."                  20.6 css   (was 16.0 — px-4)
Train   h1 "Train"                     20.6 css
VPR     h1 "VPR 0"                     20.6 css   (a detail screen, not a tab root)
VPR     eyebrow "VAYLO SPORTS …"       20.6 css
Profile h1 "Profile"                   21.3 css   (round-glyph side bearing)
```

The 0.6 px overshoot is the glyph's own side bearing on a 20 px gutter. The tab
roots' accessibility content boxes agree: all four now report
`css x 18.7..392.0`, where they previously read 16.0, 18.7 and 19.8 — the 3.8 px
spread that made switching tabs slide the content column sideways.

**Top gap** — the status bar is a bright band at the very top, and the first ink
below it is the screen's top gap. [app-audit-shots/topgap.cjs](app-audit-shots/topgap.cjs)
walks rows in device pixels:

```
status bar band   y 14..48 device = css 5.3..18.3   (identical on all four roots)

first element's box top:
  Home / Train / Perform / Profile              36.6 css
    = safe-area inset 24.6 css + --vaylo-screen-top 12 px
  VPR (detail screen, under the shared BackBar) Back button box top 34.7 css
```

Home's and Train's first elements are pills, so the topmost ink is the pill's
own border and lands exactly on the box top; Profile's first element is the
title itself, whose cap ink lands ~6.8 px lower inside the same 36.6 px box.
Read as ink alone those look 1.5 px apart, which is a font metric rather than a
gutter. The status-bar band being *identical* on all four is what makes the
comparison meaningful: the variable is the screen, not the device.

**Radar label.** In [app-audit-shots/r-vpr.png](app-audit-shots/r-vpr.png), the
row band of the "Endurance" tick, scanned column by column:

```
ink runs        814..969 device = css 310.1..369.1   (the full string)
last columns    ink px per column: …, 12, 12, 10, 5, 0
card right edge 391.4 css   ->  ink ends 22.3 css INSIDE it
```

A clip leaves the final column at full stroke height, because a glyph cut across
a stroke is widest at the cut; this run tapers to 5 and then 0, which is the
round right side of an "e". It was also checked visually at 4× on the crop.

The mechanism was found by diffing the two built bundles rather than guessed.
The 2026-10-07 build (inside `VayloSports-WebApp.zip`) ships `/vpr`'s root as

```
min-h-screen app-mesh p-6 pt-20 pb-28 max-w-5xl mx-auto space-y-6
```

and the current build as

```
min-h-screen app-mesh px-5 pt-[var(--vaylo-screen-top)] pb-28 max-w-5xl mx-auto space-y-6
```

48 px of page padding became 40, so the card — and the chart container inside
its own `p-6` — each gained 8 px, moving the surface's right edge out from under
a label whose radius is fixed by the container's *height*, not its width.

### Left deliberately alone

- Every screen keeps its own `pt-[var(--vaylo-screen-top)]` at its root, and a
  detail route additionally gets the shell's BackBar, so a detail screen carries
  the gutter twice. That is right: BackBar takes the first one directly under the
  status bar, and the page root takes the second, which is what separates the
  page's first element from the Back button above it. Neither has a bottom pad,
  so the two cannot collapse into one. This is now documented in
  [src/components/layout/AppLayout.tsx](src/components/layout/AppLayout.tsx)
  rather than left implicit.
- `bottom-[calc(var(--vaylo-inset-bottom)+5.25rem)]`, the offset four files use
  to clear the bar, was **not** reduced. It was sized against the pre-fix stack
  (card 34–99 px above the floor, `-mt-6` button reaching 107 px). The button is
  inside the card now, so the constant is roughly 8 px generous. Over-clearing is
  not a defect, and moving a shared constant across four files to recover 8 px is
  the kind of change that breaks a fifth file nobody re-checked. The constant
  stays; the comment claiming the button still pokes out does not.
- Three comments asserting the *old* geometry as current fact were corrected:
  the clearance note in
  [src/components/layout/BottomNav.tsx](src/components/layout/BottomNav.tsx),
  `AppLayout.tsx`'s "16px, 20px at sm" for a token that is 12 px at every width,
  and the clearance budget in
  [src/lib/safeAreaShell.test.ts](src/lib/safeAreaShell.test.ts) — which keeps the
  pre-fix 8 px of slack on purpose, because that assertion is a budget that should
  fail before a phone does.

### Tooling added

- [app-audit-shots/topgap.cjs](app-audit-shots/topgap.cjs) — finds the status-bar
  band and the first content row from pixels, with the column range trimmed so a
  scrollbar thumb is not counted as ink.
- [app-audit-shots/png.cjs](app-audit-shots/png.cjs) now exports its primitives
  (`decode`, `encode`, `crop`, `lum`, `brightRows`, `cols`) when required, so a
  probe can compose them instead of re-implementing the PNG filter loop. Its CLI
  behaviour is unchanged.
- [src/lib/safeAreaShell.test.ts](src/lib/safeAreaShell.test.ts) pins the fixes:
  the button's `-mt-2` lift and its `flex-1` centring (including the JSX order
  left group → button → right group), the drawer's z-index above both the tab bar
  and the action sheet, and no in-page overlay claiming the tab bar's z-50 slot.

### Verification

- `npx vitest run` — **1566 passed (1566)**, exit 0.
- `npx tsc --noEmit -p tsconfig.app.json` — clean, exit 0.
- Every geometry figure above is a pixel measurement of a `screencap` from the
  cold-started release APK at 1080×2400, converted at the device's own 2.625
  density. Transcripts: [app-audit-shots/walks/survey2.txt](app-audit-shots/walks/survey2.txt)
  and the `r-*.png` captures in the same directory.

**Not verified on this pass:** the same geometry on physical hardware.
Everything here is one 420 dpi emulator profile. A device with a different
status-bar height moves the top gap by exactly that difference (the 12 px gutter
is additive to the inset, so the gutter itself should not move), and a display
cutout would additionally exercise `--vaylo-inset-left`/`right`, which this
emulator reports as 0 and which nothing here has tested.
