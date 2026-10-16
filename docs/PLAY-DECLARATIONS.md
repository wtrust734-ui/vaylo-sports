# Play Console declarations — answer sheet for Vaylo Sports

Companion to [PLAY_STORE.md](../PLAY_STORE.md). This is the copy-ready answer to
every App content / Data safety question, derived from what the code actually does
(as verified in the 2026-10-10 release audit and the 2026-10-15 pre-launch run) and
from current Play policy (researched 2026-10-15; sources at the bottom). Answer from
this sheet, then re-read your own Data safety section after ANY new SDK or upload
route lands — it is declarations about behavior, not fixed facts.

Package `com.vaylosports.app`, v1.2.43 (46). targetSdk 36.

---

## 1. App access

**All functionality is not available without special access.**

Demo credentials (the UI-audit review account — replenished to 260 credits on
2026-10-15 so a reviewer can experience plan generation end to end):

| Field | Value |
|---|---|
| Email | `ui.review.20260928@example.com` |
| Password | in `.freebuff/ui-audit.local.json` (rotate the day the review is done; see removal note below) |

Instructions for the reviewer (paste into the "Instructions" box):
"Sign in with the provided account. Onboarding is skippable via 'Skip for now'.
AI-backed features (AI coach, plan generation, nutrition plans, form analysis) work
immediately with the credits pre-granted (no purchase is required for review).
Video form analysis: any short mp4 clip works. Health Connect: grant screen reachable
from Profile → Wearables. Local notification test button: Profile → Notifications."

Removal note: a reviewer account that stays reachable after the review is an open
door. After the production review completes, either rotate the password or drop the
credits to 0 via `credits_spend` under the admin reason 'review-close'.

## 2. Ads

**Yes, my app contains ads.**

There is no ad SDK, but the app renders labelled sponsor placements (see
SPONSORSHIP.md, gated to over-18s and skipped for minors). Play counts sponsored
or branded promotion as ads; answering "no" while placements render is a
misrepresentation strike with zero upside.

## 3. Content rating (IARC)

Complete honestly with:
- **User-generated content: YES** — users exchange direct messages with friends
  (DB-enforced friendship only), share sessions/activities, post to communities,
  and can report/block one another (report path: in-app report block → `content_reports`).
- **Social features: YES** — friends, leaderboards, challenges.
- **Simulated gambling: NO.** Credits and coins are earned and purchased but are
  consumed for features/cosmetics only; there is no wagering, no chance-to-win-money.
- **In-app purchases: YES** (Play Billing for credits/packs/subscriptions once
  billing goes live; during the closed test the money step is skipped by design).
- No violence beyond sport abstraction, no sexual content, no gambling, no drugs.
- Expected outcome: Teen-ish.

**Before answering, confirm a content report reaches a human** — that is the first
thing Play asks about for UGC apps. The moderation queue read-path is the one
operational gap the audits keep naming; see the escalation work in
docs/PRE-LAUNCH-CHECKLIST.md and the runbook (docs/INCIDENT-RUNBOOK.md).

## 4. Target audience and content

| Question | Answer |
|---|---|
| Target age group | **13 and over** (the app enforces an "I am 13 or older" tick at signup; diet plans are additionally refused to under-18s) |
| Appeal to children | No |
| Designed for families | **No** — selecting a child band pulls in the Families policy and COPPA obligations this app is not built for |

## 5. Data safety — the full section

Answer per data type actually collected. "Collected" = transmitted off the device
(SDK transmissions included; ephemeral in-memory processing that is not retained may
be excluded from the public section only if used solely to service the one request).

| Type | Collected | Shared | Purpose | Notes for this app |
|---|---|---|---|---|
| Personal info: Name | Optional (profile display name) | No (not shared with third parties for other purposes) | Account management, app functionality | |
| Personal info: Email address | Yes | No | Account management, developer communications (support, confirmations) | Sign-up + support flows |
| Personal info: User IDs | Yes (account id) | No | App functionality (per-user data RLS) | |
| Health & fitness: Fitness info | Yes | No | App functionality (workouts, sessions, planned training) | From user entry + Health Connect/wearable imports |
| Health & fitness: Health info | Yes | No | App functionality (HRV, resting HR, sleep, readiness, height/weight, nutrition logging) | Marked as required user-entered 18+ data; NOT used for advertising |
| Photos and videos | Yes | No | App functionality (form analysis) — the photo **is transmitted off-device to an AI provider** and analysis results are stored; declared, not 'ephemeral' | No CAMERA permission; system picker/capture with FileProvider cache URI |
| App activity: App interactions | Optional → Yes if telemetry | No | Analytics, app functionality | In-app error reports go to `app_error_reports` |
| App info and performance: Crash logs | If crash reporting enabled | No | Analytics/stability | errorReporting.ts |
| Files (documents) | No | No | — | Private storage is not collected |
| Device or other IDs | No unless Firebase added | | | **Re-check if/when FCM client config ships** — Firebase install IDs would then need declaring |

Encrypted in transit: yes. Deletion mechanism: in-app account deletion + the
published deletion page URL. Data-retention claims in the published privacy policy
match the support/error tables' behavior.

**Data shared with third parties.** The AI providers (OpenAI for text, Google Gemini
for photo/video) are processors: plan prompts, form photos, video clips, coach
messages are transmitted in request scope and stored according to their terms — the
privacy policy discloses this (ai-data-use.html). For the Data safety form this is
collection + processing, and because the data is not used for advertising, "shared"
stays "No" for the *adversarial* sense Google means — but if Play's question tree
treats any off-device vendor exchange as Sharing, follow the tree and use the
processor disclosure.

## 6. Health apps declaration

**Yes — complete it even before launch (it applies on testing tracks too).** Per
current Play guidance (support.google.com/googleplay/android-developer/answer/14738291):

| Feature declared | Where |
|---|---|
| Activity and fitness | Workout logging, training plans, load tracking |
| Nutrition and weight management | Nutrition plans, meal logging, height/weight |
| Sleep | Readiness check-in (sleep duration, HRV, RHR) |
| — And nothing medical: no symptoms, no diagnosis, no medication features | The injury tool is explanatory rehab guidance, not diagnosis — keep its copy inside that line |

Health Connect publish checklist (developer.android.com/health-and-fitness/health-connect/publish):
- [x] Data safety section (above)
- [x] Health apps declaration (this section)
- [x] Privacy policy published and linked
- [x] Declare the exact data types read, each with a user-facing justification:
      `Steps`, `ExerciseSessions` (workouts), `HeartRate`, `Sleep`,
      `Weight/Height`, `BasalBodyTemperature`-family only if actually read
      (the build declares 6 read permissions — justify each against its screen),
      request nothing the app does not read.
- [x] `HcSeedActivity` must not appear in releases (build script checks).

## 7. Data deletion declaration

**Yes**, usable URL: the Netlify `/legal/account-deletion/` page (see the URL caveat
in PLAY_STORE.md §1: the Supabase endpoint serves `text/plain` and cannot be the
listing URL). Deletion happens in-app and immediately; the published page documents
the email route for people who no longer have the app — required by Play.

## 8. Government / financial / news / COVID rows

All **No**. Credits are virtual currency consumed in-app for digital features; they
are not a financial product and purchases will run through Play Billing.

## 9. Financial declarations when billing ships

Before taking money publicly: `process-purchase` + `stripe-webhook` exist but
`PAYMENT_MODE` is the payload switch, and Play Billing is the required rail for
in-app digital goods (support.google.com/googleplay/android-developer/answer/10281818).
Keep the Stripe leg for web (NOT in-app Android) sales only, or enroll in a
compliant external-offers program for the relevant region — do not link out of the
Android app to plain web checkout for the same digital goods.

## 10. Closed-testing → production gate

A personal (post-Nov 2023) Play account must run the closed test with **≥12 testers,
opted in continuously for 14 days** (needing active use) before you can apply for
production access. Google also considers tester engagement and app quality here, so
the 13-day minimum is a floor, not a pass. An organisation account skips this gate.
See support.google.com/googleplay/android-developer/answer/14151465.

Sources: Play payments policy, data-safety requirements, health apps declaration,
testing requirements, account deletion requirements, Health Connect publishing
guide — all retrieved 2026-10-15; see the URL table in the pre-launch checklist.
