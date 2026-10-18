# 33 — Third-Party Data Processor Register

**Drafted 2026-10-02. Internal. Owner: unassigned. NOT PUBLISHED — deliberately.**

> A processor register is one of the most useful documents to keep accurate and one of the
> easiest to get wrong. Every entry below is either verified or explicitly marked unknown.
> Nothing is guessed.

## 1. Register

"Personal data" means athlete data in the public schema and anything in `auth`.

| # | Processor | Role | Personal data | Verified how |
|---|---|---|---|---|
| P1 | **Supabase (hosted Postgres, Auth, Edge Functions)** | Controller's processor, and infrastructure provider | All of it. Auth identities, session and audit records; all 104 public tables; function logs | Live schema and the deployed function list, queried 2026-10-02 |
| P2 | **Google Play Store** | Distribution | Display name, package id, and whatever the store listing contains | Distribution channel |
| P3 | **OpenAI** | Intended AI provider | **Nothing — no provider is deployed.** `ai-analyze`, `ai-service` and `video-form-analysis` return 401 with no API key configured | Function list and the 401 responses |
| P4 | **OAuth identity providers** (Google, Discord, Facebook, passkey) | Authentication, athlete-initiated | Email, name, provider subject id, and any profile fields the provider returns | `auth.identities`, 12 rows across 11 accounts |
| P5 | **Wearable / health platform providers** | Data source, athlete-initiated | Activity, heart rate, sleep, workouts, GPS — **only after the athlete connects one** | Feature exists; **no connections are live**, and no provider is named anywhere in the code |
| P6 | **Google Play Billing and Stripe** | Payment processing | Transaction references only. Play handles in-app purchases; Stripe handles website card payments for coach membership and marketplace orders (stripe_payment_intent / stripe_session_id on marketplace orders). Full card details are **not** held anywhere | billing.ts, coachMarketplace.ts, CoachSignup.tsx; verified 2026-10-14 |
| P7 | **Email delivery** | Not configured | None | **No provider is configured.** Sign-in and support mail are effectively unverified |
| P8 | **Error/analytics service (third party)** | Deliberately absent | None | No analytics is installed, by choice, and the Privacy Policy says so |

> Failure reports are a first-party failure report flow, not a third-party
> processor: the app sends a short diagnostic report (error name/message,
> redacted stack, screen, platform, version — no tokens, no health values) to
> the project's own backend table `public.app_error_reports` via the
> `report-error` edge function, which is already a declared processor under P1.
> No third-party crash or analytics SDK is installed anywhere.

## 2. The entries that matter most

### P1 — Supabase

This is the processor that holds everything. Every data protection control in this project is
either a Supabase feature (RLS, Auth, edge-function service roles) or code in this repository.
Two consequences follow:

- Supabase's own terms, regions and subprocessors determine where athlete data physically sits
  and who else can be a sub-processor. **None of that is recorded here.**
- Any sub-processor change by Supabase is invisible to this project unless someone checks.

**Unknowns:** contract terms; data residency region; Supabase's own sub-processor list; whether
the current plan provides a data processing agreement covering all our processing.

### P5 — Wearables

The published `wearable-health-privacy.html` describes what wearable data is received and that
disconnecting deletes it. That claim is **implemented and true**.

What is missing is the other half: **no provider is named anywhere.** `wearableSync` and the
`wearable-oauth` function exist, but the OAuth client, the consent screen copy, and which
platforms are supported are all undecided. A published notice describing data from an unnamed
provider is ahead of the implementation, and it should catch up rather than stay ahead.

### P7 — Email delivery

There is no configured email provider. This has a consequence that is easy to miss: the
published complaint procedure, the child-safety route and the security disclosure route **all
rely on an inbox someone reads**. Until that inbox is reliably delivered to and monitored, the
safety routes in documents 31 and 38 are weaker on the ground than they read on paper.

## 3. Not yet decided

- No controller/processor contract has been reviewed by anyone here.
- No transfer mechanism has been assessed. If any processor stores data outside the UK/EEA,
  the relevant safeguard has not been recorded.
- No processor has been asked to confirm what they do with athlete data beyond what their own
  public terms say.
- P3 (OpenAI) has **no** contractual review. Until one exists, the published
  `ai-data-use.html` correctly refuses to claim that prompts are not used for training.

## 4. Why this is not published

A register listing every sub-processor, the region data sits in, and which vendor receives
health data is a reconnaissance document. The published Privacy Policy describes the
categories honestly without that detail, which is the right balance.

## 5. Actions

| Action | Priority |
|---|---|
| Confirm Supabase's region, subprocessors and DPA coverage | High |
| Name the wearable providers actually supported; align the published notice | High |
| Decide and configure transactional email, then verify delivery to the support inbox | High |
| Complete the AI provider review before enabling any AI feature | High |
| Review a controller/processor contract for each entry above | Medium || Assess transfers outside the UK/EEA | Medium |

## 33.10 — Vaylo Sports ad-site drop

**Drafted 2026-10-02. Internal. Owner: unassigned. For internal use; NOT PUBLISHED — deliberately.**

This notes the inline ad-site drop for the Vaylo Sports public advertising page and the generator that keeps it current, as of today.

### 1. Files in the drop folder

The folder is `vaylo ad site/` in this repository. Today it contains at least these items:

| File | Present | Notes |
|---|---|---|
| `index.html` | yes | Vaylo Sports ad landing page |
| `_redirects` | yes | `/*	/index.html` |
| `robots.txt` | yes | `User-agent: *
Allow: /` |
| `studio.inline.html` | yes | inline studio page for the ad site |

Notes:
- `index.html`, `_redirects`, `robots.txt`, and `studio.inline.html` are all present in `vaylo ad site/` as of this run.
- The contents of each file are consistent with a minimal public advertising site for Vaylo Sports.
- `studio.inline.html` matches the corresponding file currently in `website/`.

### 2. Why it exists

The ad-site drop is the public-facing advertising entry point for Vaylo Sports. It is intentionally kept simple and separate from the app build so the public page can stay stable and easy to share.

### 3. How it is kept current

The generator is `scripts/gen-site.cjs`. When it runs, it writes the ad-site files to `vaylo ad site/`:
- `index.html`
- `_redirects`
- `robots.txt`
- `studio.inline.html`

Today the ad-site drop includes all four files. If the generator runs again, those files are regenerated, so the ad folder stays current with the generated site.

### 4. Unknowns

- Whether `vaylo ad site/` should contain anything beyond the four generated files listed above. Today it is a minimal ad-site drop.
- Whether the vendor or destination links should change. The current page is a placeholder pitch.
- Whether the deployed ad site URL should be linked here.

### 5. Recommended actions

- If the ad site is going to be shared live, add the real destination links and any real branding to `index.html` in the drop folder and re-run the generator.
- If the ad site should include more than the current four files, update the generator or the drop folder accordingly.
- If this folder should be fully mirrored from `website/`, change the generator to copy the same shape into `vaylo ad site/` on every run.

### 6. Why this is internal

This is a working note about a drop folder and a generator. It is not a public doc and should stay internal.
