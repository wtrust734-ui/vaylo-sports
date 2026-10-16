# Vaylo Sports — Pre-Testing & Pre-Launch Checklist

**Created 2026-10-15.** Everything to do before you hand the APK to testers, and before
the store listing goes public. Status markers: ✅ done (verified in this repo) · 🔶
partially done · ⬜ not started · ⛔ owner decision/human only. Every ✅ cites how it was
verified; every ⬜/⛔ says where it lives and what blocks it.

Ground-truth sources: [PLAY_STORE.md](../PLAY_STORE.md),
[docs/RELEASE-AUDIT.md](RELEASE-AUDIT.md), [docs/AUDIT-2026-10-15.md](AUDIT-2026-10-15.md),
[docs/LEGAL-MISSING-FACTS.md](LEGAL-MISSING-FACTS.md), [MONEY.md](../MONEY.md),
legal research on current (2025–26) Google Play policy, FTC/FDA guidance, GDPR/CCPA and
sweepstakes law (sources inline).

---

## Execution pass — 15 October 2026 (what moved today)

| Area | Outcome |
|---|---|
| Reviewer account | Verified live (sign-in + email confirmed); topped 0 → 260 credits; kept at 260 after `ai:health` probes |
| AI surface | `ai:health` **8/8 ALIVE with real provider calls** — incl. video-form-analysis on a stock clip, 200 OK in 37s, −45 credits |
| **Migration drift (the big one)** | **21 migrations had never been applied to the live DB** — incl. the subscription reprices (Unlimited £8.99 → £19.99, Credit-Lifetime £129.99 → £349.99 landed server-side only today) and the referral gate. All applied in order via `scripts/apply-drift-migrations.cjs`, recorded in history, objects probe-verified | |
| Support/e-mail probes | `support-request` stored + `emailed: true` (VYL-D7TNMX78) — item 2 & 3 of LEGAL-MISSING-FACTS resolved operationally |
| Moderation escalation | New: DB trigger → `content-report-escalate` → operator inbox; live probe HTTP 200; secret rotation script (`scripts/set-report-escalation-secret.sh`); `moderationEscalation.test.ts` 7/7 |
| Competition legal | Official-rules appendix + free-entry commitment added to `legal/competition-terms.html` (v1.1), regenerated, deployed, live-verified |
| New docs | [`docs/PLAY-DECLARATIONS.md`](PLAY-DECLARATIONS.md) — copy-ready Play Console answers; [`docs/INCIDENT-RUNBOOK.md`](INCIDENT-RUNBOOK.md) — incl. FTC HBNR ≤60-day + EU 72-hour dual clocks and key rotation playbook |
| PLAY_STORE.md | Refreshed to v1.2.43/46, live AI/secrets status, reviewer-account facts |
| Verification | Full battery green: tests (after `gen-website` regen for the new legal page — one stale-artifact test caught and fixed at the cause), typecheck clean, lint clean, build clean |
| Still owner-only | Netlify token redeploy (stale legal site), PITR/paid backups, operator identity, moderation *staffing*, screenshots, device tests (no Pixel attached), Data safety form entry, Play Billing money path |

---

## Part A — BEFORE YOU START TESTING (the APK on the Pixel)

### A1. Account & backend state

- [✅ 2026-10-15] **Reviewer/test account is still valid and reachable.** `ui.review.20260928@example.com`
  signs in (session + confirmed email verified via supabase-js), but it held **0 credits** —
  it predated the 260-credit economy — so it was topped up to 260 (idempotency-keyed grant,
  balance read back 260; later replenished to 260 again after ai:health probes). Password lives in
  `.freebuff/ui-audit.local.json`. Rotate it the day the store review is done.
- [✅] **Password minimum is 8** — set live in the Supabase Dashboard on 2026-10-15;
  re-verified by `npm run auth:posture` (6-char probe refused).
- [✅] **Email confirmation required** — set live; free-trial farming route closed.
- [✅] **Rate limits set to 10/min** — strictest value the API exposes (residual platform
  behavior documented in docs/AUDIT-2026-10-15.md).
- [✅] **All `authposture.*@example.com` probe accounts deleted** from `auth.users` (count verified 0).
- [⬜] **Testers' accounts get the granted-basket experience:** confirm a brand-new account
  receives the 260-credit grant in the closed test (free credits during testing are a
  deliberate Play-policy-compliant design — basket behaves like the billing version, only
  the money step is skipped). Verify once with a fresh signup on the Pixel.
- [⬜] **Decide test-account credit horizon.** 260 credits ≈ full 8-week plan + scan +
  3 coach messages + form analysis + nutrition plan. Plan how testers who burn through it
  get more (idle top-up script or `economy_config` bump) — `⛔ owner: how generous is the test?`.

### A2. The APK itself

- [✅] **v1.2.43 (versionCode 46) built and verified** — `sh scripts/build-apk.sh` exit 0;
  upload-key signature, 6 health read / 0 write permissions, targetSdk 36, 0 JWTs and
  0 source maps in the bundle, AAB signature verifies, version matches build.gradle.
- [✅] **All 2026-10-15 audit fixes are in the bundle** — the 320px 404 escape chip, 44px
  tap floors (Market pills, trend pill), explicit-column plan queries, single-call weekly
  morning reminders, VPR disabled-submit reason, trend-nudge deep link.
- [⬜] **Install on the Pixel and smoke-test in order:** cold start → sign in → onboarding
  (equipment step) → plan generation (watch the honest-wait progress) → plan week renders →
  log a workout → recovery check-in → VPR save → Market browse (no purchase in test).
- [⬜] **Notifications on-device:** local notifications only (push deliberately
  unconfigured). Trigger: test button on Notification Prefs (`v1.2.43` posts the morning
  briefing at 07:10; heads-up HIGH channel). Check the shade, lock screen, and that the
  channel perceives full content.
- [⬜] **Health Connect consent flow on a real device** — the six read permissions, the
  `wearableSync` pop-up on sign-up, onboarding "Wear a watch?" row, Profile → Wearables.
  Confirm a real read-import shows on Workouts.
- [⬜] **Wearable OAuth round-trip** — Strava / Fitbit / Oura real callbacks (server-side
  state now in DB, so cross-instance callbacks work). Test each; record any
  `not_configured`.
- [⬜] **Form analysis photo path** — camera capture (no CAMERA permission; FileProvider
  cache URI + EXIF downscale), upload, Gemini verdict renders.
- [⬜] **Offline behavior** — airplane mode: offline write queue keeps workouts,
  OfflineBanner appears, sync works on reconnect.
- [⬜] **Back behavior on a real device** — hardware back on detail screens, sheets,
  and the 404 escape chip at 320px width emulation (`ui-audit` verified geometry;
  confirm finger feel).
- [⬜] **Both language families** — run the app in one of the 12 shipped locales
  (i18n parity test exists at build time; eyeball one real locale for cutoffs).

### A3. Backend secrets/config for the AI features under test

- [⬜] **`OPENAI_API_KEY` set** (OpenAI-backed features).
- [⬜] **`GOOGLE_API` set** (Gemini video analysis).
- [⬜] Run `npm run ai:health` after tests — expect 7/7 features alive; note any credit
  spend the probe reports.
- [⬜] **`supabase secrets list`** — confirm no orphaned/overshared keys and that the
  Stripe webhook / unsubscribe / legal functions keep their exempt `verify_jwt` status each
  documented.

---

## Part B — BEFORE PUBLIC LAUNCH (store + legal + money)

### B1. Google Play Console declarations (ordering per PLAY_STORE.md §3–§5)

- [⬜] **Screenshots captured** — the one item the store doc lists as not done. Pixel
  screenshots per device class Play wants (phone, 7", 10"); this needs human hands.
- [⬜] **Target audience: 13+, not designed for families** (§0a). App enforces the
  "I am 13 or older" tick; under-13 would pull in COPPA/Families policy — do not select it.
- [⬜] **Ads declaration: "Yes"** — sponsor placements count as ads under Play policy
  even with no ad SDK. Answering "No" is a misrepresentation risk.
- [⬜] **Content rating (IARC):** declare user-generated content (friends messaging,
  shared sessions) and social features — mandatory; credits/coins as simulated rewards;
  expect Teen-ish.
- [⬜] **Health apps declaration: YES** — current Play policy applies the declaration on
  testing tracks too, and Google requires it even for "no health features". Declare
  Activity/Fitness + Nutrition/Weight-management per
  support.google.com/googleplay/android-developer/answer/14738291. Also justify each
  Health Connect data type against the user-facing feature (Android publish guide:
  developer.android.com/health-and-fitness/health-connect/publish).
- [⬜] **Data safety form per actual code behavior** (PLAY_STORE.md has the verified
  answers): health/fitness types for workouts/weight; **photos** collected (transmitted to
  AI provider — not ephemeral); AI prompt contents classified by what users send;
  SDK transmissions included; don't declare private storage you don't upload from;
  Firebase installation IDs if Firebase ships (see B5).
- [⬜] **Account deletion: yes, in-app + URL** `[legal]/account-deletion` — currently
  the Supabase function URL; see B2 for why that URL must change for the listing.
- [⬜] **App access:** demo credentials from A1 in the declaration (and rotate/delete
  after launch).
- [⬜] **Closed-test graduation:** ⛔ if your Play account is **personal (post-Nov 2023)**:
  12 testers opted in continuously 14 days before you can apply for production access
  (support.google.com/googleplay/android-developer/answer/14151465). Organisation
  account skips this. Google may still require further testing; tester engagement counts.
- [⬜] **Release notes ≤500 chars**, yourself first as tester, verify the opt-in link works
  before inviting anyone else.

### B2. Published legal pages (where Play's reviewer actually lands)

- [⛔→⬜] **Netlify site is stale and must be redeployed** (docs/RELEASE-AUDIT.md B1c —
  still the operative blocker). The store listing must point at
  `vaylo-sports.netlify.app/legal/…`, and that host is currently serving Terms **without**
  Version 1.4. `node scripts/deploy-web.cjs` needs your Netlify token — I cannot run it here.
- [⬜] **Stop pointing Play at the Supabase function URLs** — the gateway rewrites
  `Content-Type: text/plain` and sandboxes them; they are a mirror, not a policy page. Use
  the Netlify URLs in Privacy policy + Data deletion fields. (PLAY_STORE.md §1 still shows
  the function URLs — update that doc when you switch.)
- [⬜] **Keep legal in-app links pointed at one host** (`src/lib/legalUrls.ts`) so store
  copy cannot drift from what Play reviewed.
- [✅] **26 legal documents, script-free, in-app viewer at `/legal/:slug`** — present since
  v1.2.9; verify the in-app viewer still opens each doc after 46.

### B3. Get-sued checklist (legal exposure, researched current 2025–26)

**Identity & contracts (blocking, from docs/LEGAL-MISSING-FACTS.md):**

- [⛔] **Registered company name, number, registered address** → `legal/operator.json`.
  The Terms' governing-law clause currently reads as evasive; a consumer contract must
  identify the trader (Art 13(1)(a) wants a postal address). Item 1 in LEGAL-MISSING-FACTS.
- [⛔] **ICO registration number + country of establishment** → fixes regulator, governing
  law, transfer regime in Terms/Privacy/Complaints.
- [⛔] **DPO or the documented decision that one isn't required.**
- [✅ 2026-10-15] **Transactional email provider is configured and delivery verified** (item 2):
  `GMAIL_USER`/`GMAIL_APP_PASSWORD` are set as function secrets and the support pipeline
  demonstrably delivers — probe `VYL-D7TNMX78` returned `emailed: true` on 2026-10-15.
  Time-to-arrive in the Gmail inbox is the last owner visual check; inbox ownership stays ⛔.
- [✅ 2026-10-15] **Web forms: option (a), deployed and verified live** (item 3):
  `support-request` was already active (v27, deployed 2026-10-10 — the audit doc was
  stale on this point) and a labelled probe stored a row and reported the email handed
  to SMTP (`emailed: true`). Inbox arrival is the remaining owner visual check.

**Health claims / FTC / FDA (US):**

- [⬜] **Substantiation for every express or implied claim** — FTC judges the overall
  message including store listing copy and AI output wording, not just the disclaimer
  (ftc.gov/business-guidance/advertising-marketing/health-claims). Audit store listing
  text and in-app benefit copy against this.
- [✅→⬜] **Scope disclaimers present** (ai-disclaimer, nutrition-disclaimer, injury-guidance,
  health-safety pages exist) — audit that the **AI outputs themselves** (scan verdicts,
  plan copy, injury scaffolds, coach messages) consistently hedge: "estimates visible
  movement, not injury or medical risk; can be wrong; stop for pain; consult a clinician."
  A disclaimer label doesn't cure an implied medical claim.
- [⬜] **Stay inside the general-wellness line** (21st Century Cures; FDA general-wellness
  guidance): no disease-specific treatment plans, no injury *diagnoses*, no "detects a
  medical condition" in the video/photo scan copy. Re-read VPR, Injury and FormAnalysis copy
  for this specifically.
- [✅] **Diet plans are refused to under-18s** (v1.2.12 age-proofing; verified in migration).
- [⬜] **FTC Health Breach Notification Rule applies to you** — multi-source health app,
  not HIPAA-covered: write a breach runbook (notice to users + FTC, generally ≤60 days)
  before launch (ftc.gov HBNR guide). You have `AdminErrorReports` for app errors but no
  **data breach** procedure.
- [⬜] **"AI" marketing** — Operation AI Comply posture: don't over-promise "AI coach"
  accuracy; present provider limits and non-retention claims as verified facts only.

**Privacy / GDPR / US states:**

- [⬜] **Article 9 legal bases per data type, documented** (doc 34/37 exist as scaffolds):
  explicit purpose-specific consent is the safe route for health-derived data, photo
  analysis, and marketing; contract covers core account/service; legitimate interest only
  for narrow security/reliability after a balancing test. Record in doc 37 and reflect in
  the published privacy notice.
- [⬜] **Art 8 minors' consent ages vary by member state (13–16)** — your 13+ / no-COPPA
  positioning plus 18+ diet gate helps but doesn't settle children's safeguards; decide
  doc 35 items: AI features for under-18s? friend-requests and community-posting defaults?
  Parents controls (Children's Code)?
- [⬜] **DPAs signed with processors** (doc 33 register): Supabase, OpenAI, Google (Gemini),
  Resend/Gmail relay, Netlify, Play — Art 28 terms with sub-processor notice, deletion,
  security, assistance. Classify each role (Play may be a platform, not a processor, per
  activity — decide per activity).
- [⬜] **International transfers:** pick and record the correct 2021 SCC module + transfer
  assessment where a vendor is US-based; add to doc 37.
- [⬜] **Rights flows verified end-to-end** (in-app already: delete-account, export-my-data,
  exercise them in the closed test): Art 15 copy + processing info, Art 17 erasure incl.
  processor deletion and confirmation trail, Art 20 structured export.
- [⬜] **DPIA decision documented** — health data + photos + profiling likely triggers one;
  write the why/not memo now even if conclusion is "not yet required".
- [✅→⬜] **CCPA threshold not yet met (rev >$26.625M / 100k Californians)** — likely out of
  scope at launch; re-check as you grow, and audit any future ad SDK under sale/share rules.
- [⬜] **Washington My Health My Data** — if any US-WA users possible at launch: consent
  before collecting consumer health data and a separate consumer-health-data privacy policy
  linked prominently. Decide market restriction vs compliance.
- [⬜] **EU digital-goods refund policy:** 14-day withdrawal right requires **prior express
  consent to immediate download + acknowledgment that the right is lost** — verify the
  purchase flow records exactly that; `legal/purchases.html` has under-18 refund language,
  check the direct-for-sale path.

**Promotions & sweepstakes (challenges, referrals):**

- [⬜] **Analyze each promotion for prize/chance/consideration.** Random draws for credits
  tied to a purchase or a paid referral can be a lottery; skill-judged competitions are
  different but still need official rules. A purchase-based entry needs a meaningful free
  alternate entry route.
- [⬜] **Official rules before any prize goes live**: sponsor, eligibility/age/locations,
  dates, entry methods, judging, prize value, fulfillment, taxes, privacy use, void states.
- [⬜] **NY/FL filing awareness** (> $5,000 total prize value thresholds; FL needs
  filing ≥7 days ahead + bond/trust; NY registration) — decide to exclude those states
  until prize value is capped, or engage counsel. "No cash value" credits are *not* an
  automatic safe harbor; in-app utility still confers value.
- [⛔] **Promotions counsel review before public challenges/referrals with real prizes**
  (referral code exists; competition-terms.html exists).

**Content / community / platform:**

- [🔶 partially closed 2026-10-15] **MODERATION IS THE BIGGEST OPERATIONAL GAP** (docs/RELEASE-AUDIT.md §4). The
  escalation path is now wired and verified live: every new `content_reports` row fires a
  pg_net trigger → `content-report-escalate` → the operator inbox (probe returned HTTP 200;
  wiring pinned by `src/lib/moderationEscalation.test.ts`, 7/7). What remains ⛔: who staffs
  the queue and the SLA — the email guarantees *reach*, not *response*.
- [✅→⬜] **Child-safety risk assessment doc** (39) exists — verify the published child-safety
  route is monitored after the email fix lands.
- [⬜] **DMCA/counter-notice path** for user-shared media (formVideo, shared sessions).
- [⬜] **Report/block/unfriend re-verify in the closed test** (friends surface restored
  2026-10-08; rules enforced DB-side per docs/FRIENDS.md).

**Insurance / corporate:**

- [⛔] **Liability insurance quote** (product/tech E&O) — health-adjacent app with minors
  and messaging.
- [⛔] **Entity + bank + taxes** (formation is fact-specific; startup counsel).
- [⬜] **Trademark search for "VAYLO"** in Nice class 9/41/44 before you spend on listings.

### B4. Features actually working, verified against the LIVE API (public-launch test plan)

Each row = feature, how to verify, and current known state.

| # | Feature | Verify by | Status |
|---|---|---|---|
| 1 | Sign-up (+email confirm) → onboarding | fresh account, Pixel | ⬜ closed test |
| 2 | Plan generation (8-week) + credits spend | run once, watch balance −160 | ✅ model verified; ⬜ live device |
| 3 | Honest-wait progress on overrun | force slow net / large plan | ✅ v1.2.37 fixed; ⬜ device |
| 4 | Recovery check-in → adaptive rewrite | submit HRV/sleep; confirm adjusted_session | ⬜ save not exercised 10-15 |
| 5 | Break/holiday reshape | record break; confirm loading week + ramp | ✅ logic + tests; ⬜ device |
| 6 | Nutrition: intake wizard → plan → review | live generation, credits charged | ✅ prices fixed 10-12/10-15; ⬜ device e2e |
| 7 | Calorie scan (photo) | use CameraCapturePlugin path | ⬜ device |
| 8 | Video form analysis incl. long clip | ≤10 min clip now allowed; confirm 45-credit price quoted | ⬜ device; cost ceiling deliberately stale (see Part D) |
| 9 | Injury unlock → plan | buy-free during test, generate | ⬜ device |
| 10 | Mental gym / life events / race mode | each unlock opens once owned | ⬜ device |
| 11 | Wearables Strava/Fitbit/Oura | OAuth + import + starting analysis | ⬜ cross-instance callbacks fixed server-side 10-x; ⬜ device |
| 12 | Health Connect | consent + imports + Workouts listing | ⬜ device |
| 13 | Friends: codes, requests, DMs, report/block | docs/FRIENDS.md live verification then device | ✅ DB-verified 10-08; ⬜ device |
| 14 | Referrals | check the 2026-10-14 qualification gate migration behaves live | ⬜ |
| 15 | Market: browse, prices per tier, per-credit ladder | formatLocalPrice displays tier-correct prices | ✅ tests; ⬜ device |
| 16 | Purchases (Play Billing) | **not live — money step skipped by design in closed test** | ⬜ product work before launch (Part E3) |
| 17 | Coach chat | credits −6 each, streaming | ⬜ device |
| 18 | Weekly review / insights | end of week simulation | ⬜ |
| 19 | Notifications: morning brief 07:10, evening nudge, low credits, poor recovery, streak push | device with app closed | ⬜ |
| 20 | Offline queue | airplane mode round trip | ⬜ |
| 21 | Error reports pipeline | file a real report, read in AdminErrorReports | ⬜ (writes a row — do once) |
| 22 | Admin screens (waitlist, pricing, errors) | RequireAdmin gate with your admin id | ⬜ |
| 23 | Support/theme: legal viewer /legal/:slug all 26 | tap-through | ✅ since 1.2.9; ⬜ recheck on 46 |
| 24 | Guest/cookie surfaces (web in-app browser) | sponsor placement gating by age | ⬜ |

### B5. Optional-but-decided features (flag state)

- [⛔] **Push (FCM)** — data model and plugin shipped; 4 FCM XML values + 3 secrets empty
  until you set up the Firebase project (`push/PushPlugin.kt`, FIREBASE.md, `push:ready`
  shows 7 items). Decide: ship without server push (works today) or configure.
- [⛔] **Coach marketplace** — feature-flagged OFF and hidden everywhere including the
  site. Leave off for launch.
- [⛔] **Owned public domain** — none exists. Blocks native referral/share links (fail
  closed now) and the production auth-redirect experiment. Balances the "no ledger of
  your app URL" tradeoff; decide timeline.

### B6. UI/UX before launch

- [✅] **`npm run ui:check` PASS** across the five device classes incl. 320px floor —
  verified 2026-10-15 (exit 0).
- [⬜] **Real thumbs pass on the Pixel**: fixed-bottom clearance (the 144px token),
  keyboard overlays, notch, dark mode, tab keep-alive feel, haptics, hover-tell killing.
- [⬜] **Sheets, modals, menus** are NOT covered by the automated audit (it measures resting
  routes) — manual sweep of every bottom sheet and dialog on the Pixel.
- [⬜] **Empty states for a brand-new account** — the 260-credit grant covers first basket;
  check the second run shows the "Trend needs 2 saves" nudge now deep-linking correctly
  (v1.2.43 fix).
- [✅→⬜] **Terms banner + cookie notice layering fixed and crawl-measured** (v1.2.8+),
  ToS expand-collapse remains a documented deferral — decide if you want it before public.
- [⬜] **All 12 locales eyeballed** at device size (build-time parity tests don't catch
  long-string cutoffs).
- [🔶] **Accessibility sweep** — 44px floors done via audit; still no screen-reader/label
  audit at all. One pass with TalkBack (Android) recommended before public.
- [✅] **Offline/empty/loading states are honest** (no fake countdown, no silent failure) —
  contract-tested (creditMoments, planGenerationProgress, breakBannerWiring).

### B7. Performance

- [🔶] **`select("*")` reduced but not finished.** The 2026-10-15 pass fixed the plan dots
  in Training, Goals, MetricsHub, Challenges, Coach, Market. The audit found 89 call sites;
  several cleared, still ~80+ left — biggest wins first (`plan_data` JSON columns).
- [⬜] **Cold-start time on the Pixel measured** (not a guess): `adb shell am start -W`
  before public.
- [⬜] **Tab-switch latency** still acceptable with keep-alive + prewarm (the v1.2.5
  two-phase crossfade); verify with the profiler, not by feel.
- [⬜] **Bundle size trend**: 3.0 MB APK; track per release.
- [⬜] **Edge-function latency under load** — OpenAI waits; check retry/backoff behavior on
  `ai-analyze`/`generate-plan` at least once under a slow network.

### B8. Data & migrations

- [✅ 2026-10-15] **All Supabase migrations applied to prod** — and the spot-check found real drift:
  **21 migrations had never been applied remotely** (incl. the 2026-10-12 pricing fixes and
  the referral gate). All 21 applied in order, recorded in history, and objects verified live
  (Unlimited £8.99 → £19.99, Credit-Lifetime £129.99 → £349.99, ad/nutrition/notification/referral
  objects all present). Runner: `scripts/apply-drift-migrations.cjs`; two repo files needed
  idempotency fixes (`20261006140000` policy drop, `20261010100000` invalid `create policy if not exists`).
- [✅ 2026-10-15-checked] **Generated types still valid against schema** — the drift repair changed the schema
  (new tables/columns) but the client references none of the net-new objects, and the full typecheck
  returned clean, so the generated file was left as-is intentionally (`supabase gen types`
  needs Docker or a DB password, neither available here). Regenerate on the next types-touching change.
- [⬜] **Backup/PITR enabled on Supabase** — decide tier; a launch-day lost `profiles`
  table is not a fun support email.
- [✅] **RLS over every table; clean 31/31 security probes** (`npm run security:check`).
- [✅] **Secret scan clean** (0 findings / 1108 tracked files).
- [⬜] **Restore drill once** — prove PITR works before you rely on it.

### B9. Observability & ops

- [⬜] **Support inbox ownership decided and monitored** (pairs with B3 email item).
- [⬜] **Complaint SLAs confirmed/changed** — `legal/complaints.html` publishes aims of
  5 working days to acknowledge and 20 to respond; confirm or change and name an owner
  (docs/LEGAL-MISSING-FACTS.md item 5).
- [⬜] **Error-report triage process** — AdminErrorReports exists; decide who reads it and
  when.
- [⬜] **Incident runbook**: data breach (FTC HBNR ≤60d in US), outage, AI-provider key
  rotation, app-signing-key loss recovery (Play reset path documented in PLAY_STORE.md).
- [⬜] **Uptime monitoring** on the Supabase functions (legal pages are customer-facing).

---

## Part C — COSTS & PROFIT MODEL (grounded in the repo's own numbers)

### C1. What a feature costs us (override ceilings from `src/config/credits.ts`)

Deliberate over-estimates per call, in USD (Luna $0.10/$0.50 per MTok; Sol $2/$10):
`vaylo_coach_message` 0.0024 · `weekly_coach_review` 0.0024 · `training_plan_week` 0.00562 ·
`plan_edit` 0.003 · `calorie_scan` 0.0014 · `nutrition_plan_week` 0.0046 ·
`nutrition_review` 0.0038 · `tactical_prep` 0.0029 · `injury_plan` 0.0032 ·
`video_form_analysis` 0.0272 (budgeted for the OLD 60s clip — a 10-min clip is now legal,
near 174k input tokens; one is still revenue-positive ~8× at 45 credits, but the ceiling
must be re-measured when long clips get common) · `form_analysis` 0.00715 ·
`limiter_fix_plan` 0.1248.

**The whole onboarding grant basket costs ~$0.032 per new account** (260-credit grant) —
conversion economics, not a cost problem.

### C2. What a credit earns (worst market, tier D "Growth")

- Best pack in worst tier: 650 credits for $9.99 = **$0.01537/credit gross**.
- Net of Google's 30%: **~$0.01076/credit**. Every metered feature price is derived to
  clear **8× its ceiling at that rate** (`MIN_MARGIN_MULTIPLE`, enforced by
  `src/lib/pricing.test.ts` — the suite fails if any feature drops under it).
- Subscription net: Credit Plan £5.49/mo → ~£3.84/mo; Unlimited £19.99/mo → ~£14/mo; the
  £34.99 Credit-Lifetime and £59.99 Unlimited-Lifetime are priced on months-of-promise
  (58 and 30) with the unlimited call ceiling (400/day) as the backstop.

### C3. Recurring overhead you already owe regardless of revenue

| Item | Cost | Note |
|---|---|---|
| Play Console account | $25 one-off | already paid if you have a dev account |
| Domain (once you get one) | ~£10–15/yr | currently none; see B5 |
| Supabase | Free → Pro $25/mo when you hit free-tier limits | decide before launch |
| Netlify hosting | free tier sufficient | legal pages + site |
| Email (Gmail app-password today) | $0 now; Resend free 3k/mo if you swap | item 2 decision |
| AI provider | usage-metered, priced above | budget alerts recommended |
| **Total fixed** | **≈ $25–50/month** at launch scale | |

### C4. Profit math to sanity-check before public launch

- **Per active plan-builder (one-off credits)**: an 8-week plan is 160 credits → revenue
  (tier D) $2.46 gross, **$1.72 net**; provider cost ~$0.005–0.009 for 8 weeks of calls.
  **Margin ≥ 95%** on this product.
- **Unlimited Plan worst case**: fair-usage ceiling 400 AI calls/day is what prevents
  blowout; a realistic heavy athlete (~30 coach messages + 4 weekly reviews + 1 plan
  + video analyses/month) ≈ $0.30–0.60 provider cost vs **$14 net**. **~4–7% COGS.**
- **Lifetime products** are the only structural tail-liability: Credit-lifetime pays
  ~£6 face-value of credits per month from month 25 onward; unlimited-lifetime has the
  400/day hard ceiling. Decide whether you want to keep selling them publicly.
- **Break-even**: fixed ≈ $50/mo ⇒ **~35 Credit-Plan subscribers** or **~18 unlimited
  monthly** clears overhead per month (at current prices). Everything below that volume
  is deficit — worth stating so decisions early aren't driven by fear of the meter.
- [⬜] **Set billing/usage alerts**: OpenAI + Supabase + Gemini spend alerts the first week
  of any paid month, and a `economy_config` review in the same week.

### C5. Things that would silently flip this into a loss

- Regional pricing misfiled in `pricing_tiers` (the 2026-10-03 audit caught 8 countries
  under-floor at tier D — re-run that check after any price change).
- Gemini long-clip ceiling stale (C1 note) — measure before promoting video.
- `rate_limit` config regression on `ai_call_allowed` fail-open path (documented residual).
- Price changes that push casual users toward the *lifetime* products early (C4's
  tail-liability note) — re-run the margin-ladder tests after any `economy_config` edit.
- Real-play-billing launch without the regional `pricing_tiers` re-audit — the
  2026-10-03 regional audit found 8 countries under-floor; the pack display code is fixed,
  but `npm run pricing` style re-derivation must run after any price change.

---

## Part D — THE ORDER TO DO THINGS IN

1. **Today:** confirm reviewer account signs in post-auth-changes; smoke the APK on the Pixel; run `npm run ai:health`; set provider secrets if any are unset.
2. **This week (owner items):** operator identity (B3 top block); decide email provider +
   web-forms question (B3); start the 14-day closed-test clock if personal Play account;
   set the domain plan (or decide not to).
3. **Before public:** screenshots; Data safety + Health declarations against the code
   (B1); redeploy the Netlify site and repoint Play URLs (B3); moderation staffing (B3);
   promotions counsel before any real prize field goes wide (B3); Play Billing work (E3)
   only when you're ready to take money; run the B4 feature matrix end-to-end on a live
   device; set spend alerts + restore drill (C, B8).

### The three things that can hurt you most, ranked

1. **Moderation dead-end + child-safety email that may not be monitored** (both B3) —
   this is the product risk Play reviewers and regulators probe first.
2. **Stale published legal site** (B2) — the store reviewer sees Terms 1.3 while the app
   banner advertises 1.4; that's the exact drift class every other fix in this repo was
   built to prevent.
3. **Promotions/sweepstakes exposure** (B3) — one poorly-shaped referral competition is
   the kind of thing that generates actual statutory problems, and it's a checkbox away
   otherwise.

---

*Sources for the legal items:* official Google Play policy pages (payments, data safety,
health declaration, testing requirements, account deletion), FTC health-claims and mobile
health-app guidance, FDA general-wellness guidance, GDPR Arts 8/9/13/15/17/20/28,
EDPB lawful-basis guidance, CPPA/CPRA FAQ, Virginia/Colorado/Texas and Washington My
Health My Data statutes, FDACS/NY sweepstakes pages, EU Consumer Rights Directive —
all current as of 2025–26 research. Anything marked ⛔ is a decision only you can make;
the research identifies the question, not the answer.
