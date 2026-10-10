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
| P6 | **Payment providers** | Payment processing | Transaction references. Full card details are **not** held — the app records a purchase event, not a card | Purchases are recorded as events |
| P7 | **Email delivery** | Not configured | None | **No provider is configured.** Sign-in and support mail are effectively unverified |
| P8 | **Error/analytics service (third party)** | Deliberately absent | None | Still no third-party service, by choice, and the Privacy Policy says so. Failure reports are first-party and land in P1 — see §2 |

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

### P8 — Error reporting

The third-party entry stays absent, deliberately. What now exists is a first-party failure report: since
the closed-testing build, the app sends its own JavaScript failures (an uncaught error, an unhandled
rejection, a React render error) to the `report-error` edge function, which stores them in
`public.app_error_reports`. No new processor is involved — the rows sit in the same database as
everything else, under P1, and no SDK from a crash vendor is installed anywhere in the app or the
native shell. That distinction is the whole reason it was built this way: a crash service would have
made "no analytics or error-reporting SDK" in `advertising.html` §3 and `cookies.html` §4 false, and
would have added a processor that receives athlete data.

The data is narrow on purpose: the failure name and message, the route it happened on (ids removed,
query string dropped), the app version, the platform and the device user-agent string. There is **no
athlete column at all** — deliberately, not by omission. A row here is a shared counter for a failure
across the whole tester population rather than a row belonging to one person, so an account id on it
would make the row personal data of whoever reported it first while giving account deletion and an
Article 20 export no honest answer (deleting it would destroy other testers' counts). Tokens, email
addresses, URLs' query strings, long identifier-like runs, health values, message contents and
photographs are removed on the device before a report is sent, and the server caps and re-validates
every field. Nothing in these rows identifies an athlete, which is also why the account-deletion
coverage guard needs no entry for the table: a table with no user-keyed column cannot leak a row.

Two obligations follow, and neither is satisfied by this document:

- **Play Console Data safety must declare it.** "Crash logs" and "Diagnostics" under app info and
  performance, purpose app functionality. The form asks about the data, not the vendor, so "no SDK"
  is not an answer it accepts. This is recorded in `PLAY_STORE.md`.
- **Native crashes are not covered.** A Kotlin-side crash or a killed WebView process never reaches
  JavaScript, so it cannot appear in this table and is only visible through Play Console's own Android
  vitals. Nothing in this repository needs to change for that, but a quiet `app_error_reports` table
  must not be read as "nothing crashed".

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
| Review a controller/processor contract for each entry above | Medium |
| Assess transfers outside the UK/EEA | Medium |