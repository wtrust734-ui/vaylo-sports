# Ads Studio — Operations Runbook

Everything here reflects commands and variables that exist in this repository.
Nothing is documented that has not been verified.

## Run locally

```bash
npm install
npm run dev            # Vite dev server (web app)
npm run typecheck      # tsc for app + functions projects
npm run test           # vitest, full suite
npm run build          # production web build
```

## Project readiness gates

```bash
npm run security:check   # DB-level access probes (31 checks)
npm run auth:posture     # sign-in abuse probes (needs SUPABASE_URL + keys in .env)
npm run secret:scan      # secret patterns across the tracked tree
npm run site:build       # regenerate the marketing/legal site corpus
```

`ai:health` and `push:ready` need `.env` with `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` (present in this workspace) and print
environment-specific gaps.

## Environment variables (edge runtime — never in client code)

Set with `supabase secrets set NAME=<value>`:

| Secret | Used by | Notes |
|---|---|---|
| `OPENAI_API_KEY` | app-wide AI (plans, research fallback, ads fallback) | falls back for ads when `ADS_OPENAI_API_KEY` unset |
| `ADS_OPENAI_API_KEY` | ad concepts, script writing | keeps ad spend separate from the app |
| `GOOGLE_VIDEO_API` | ads-video (Gemini/Veo) | unverified until a free models.list probe runs |
| `ELEVENLABS_API_KEY` | voiceover narration | live-confirmed on this deployment |
| `RENDER_WORKER_URL`, `RENDER_TOKEN` | video render | **not hosted yet** — video render reports this honestly |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all functions | standard edge-injected |

The Integrations panel in the app reflects exactly this list and its gaps.

## Database

Migrations live in `supabase/migrations/` (applied with
`supabase db push` from a linked project). Ads-related migrations:
`20261017220000_ads_studio_core`, `20261017230000_ads_research`,
`20261017240000_ads_image_ads`, `20261018000000_ads_video_tables`,
`20261019000000_ads_beta_feature_costs` (credit metering for paid
generation: image 4 / Veo shot 40 / narration 5 / render 1 credits, metered
for all plans).

## Deploy

- Functions: `supabase functions deploy <name>` per function (all live in
  `supabase/functions/*/index.ts`); RLS + storage policies ship with migrations.
- Web: `npm run build` → `dist/`; deployment target is configured outside this
  repo (see project dashboard). The native APK path uses `npm run cap:*`
  (Capacitor) and is unchanged by Ads Studio.

## Diagnosing common errors

- **"not configured" on video/narration/render** — the named secret is missing
  (`GOOGLE_VIDEO_API` / `ELEVENLABS_API_KEY` / `RENDER_WORKER_URL`). Set it and
  redeploy the function; no re-auth needed.
- **402 `insufficient_credits`** — the credit meter refused the spend; nothing
  was charged. User tops up; the creator work (concepts, briefs) is unaffected.
- **Render job stuck `queued`** — job status is written only by the render
  worker; without a worker the job stays queued and the UI shows the honest
  state. Restore the `RENDER_WORKER_URL` service to resume.
- **Research project left `queued`** — execute from the Research workspace;
  the run is rate-limited and page-fetch failures are listed as blocked sources.
- Operator-visible failures: the `/admin/errors` console (aggregated by
  fingerprint via `report-error`), plus Toast/error text surfaced in each view.

## Backups and recovery

- Persistence lives in Supabase Postgres + Storage (`ads` bucket, private,
  owner-folder policies) and `renders` bucket (public read of finished exports).
- **Automated backups are NOT configured in this environment.** Documented
  limitation: enable Supabase dashboard backups (Database → Backups on the
  paid tier) or schedule `supabase db dump` externally; storage objects need a
  bucket-level sync (e.g. the Supabase CLI or an rclone job) because dumps cover
  rows, not objects.
- Restore = recreate from migration history, then reload the dump; no secrets
  belong in any backup (they live only in Supabase secrets).

## Managing generation limits

- Rate limits are per function via `ai_call_allowed` (durable, in-Postgres):
  ads-video start 6/min, render 6/2min, ads-chat 30/min, ads-image 20/10min,
  voiceover 20/min. Change the `{ max, windowSeconds }` in each function.
- Spend is metered in credits (`ads_video_shot`, `ads_image_generate`,
  `ads_video_narration`, `ads_video_render`) for ALL plans; adjust prices in
  `economy_config.feature_costs` (migration pattern:
  `20261019000000_ads_beta_feature_costs.sql`).
- Publish/spend on ad platforms is NOT implemented — do not add without an
  authorised, separately-tested workflow. Nothing deletes or overwrites paid
  outputs automatically either:
  - **Failed tasks never delete work.** A failed image retains its project and
    concepts; a failed Veo shot keeps its `operation_id` for retry; a failed
    render job stays `failed` with its reason. Retries create new rows or
    re-quote the same step — they never both re-bill and re-record the same
    spend (idempotency keys on every metered charge).
  - **Duplicate clicks** are guarded client-side by busy-locks on each action
    (`sending` in chat; per-artifact `busy` keys in Image/Video views) and
    server-side by the cost gate (`confirm !== true` always returns a quote,
    never a bill) plus per-user rate limits. The same confirmed request can
    therefore not double-charge: repeated clicks before a response are ignored,
    and after a response the second click hits `requiresConfirmation` again
    instead of spending.

## Reporting a defect

Testers: **Report a problem** in the Studio header (goes through the
support-request ticket path; operator sees it with an email reference).
Developers: open an issue against this repo with the failing scenario from
`docs/BETA_TEST_PLAN.md` and the admin-error fingerprint from `/admin/errors`.
