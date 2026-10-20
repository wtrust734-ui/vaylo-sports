# Vaylo Ad Web App — What's Been Done So Far

**Status:** Beta-ready (go, with restrictions) · Last updated 2026-10-19

This folder is a **saved snapshot of the Vaylo ad-creator studio built so far** — a web app
that turns a plain-language brief into image ad and video ad campaigns, backed by Supabase.
It was extracted from the mono-repo at `C:\Users\gemme\Downloads\.freebuff` so the work can
be shared and reviewed in isolation. It is a reference copy of the source for the
**Vaylo Ads web app**, not a standalone buildable project — files import shared alias paths
(`@/integrations/supabase/client`, `@/components/ui/*`, `supabase/functions/_shared/*`) that
live outside this folder, so run or read them in the main repo.

## What the app does (the feature surface)

- **Creative Assistant (chat):** type a sentence like
  *"Research Strava and Runna before creating a 15-second launch video"* and it routes
  locally to the right workflow (`classifyLocal` in `adsRouter.ts`), with clarifying
  questions when a request is ambiguous, and honest fallback when you mention
  publishing/budget (platform integration isn't connected).
- **Image Ads:** static social ads with placements, variants and composition from a brief.
- **Video Ads:** 15–60s spots — script, shot list, Veo generation, voiceover (ElevenLabs),
  captions, export.
- **Competitor Research:** evidence-lead competitor study before you create, with sourced
  citations in the UI.
- **Campaigns & Asset Library:** campaign CRUD, statuses (planning → approved → done),
  and every generated asset saved with per-feature credit cost.
- **Brand Settings & Integrations views.**
- **Beta onboarding + feedback sheet** surfaced in the studio shell.

## State of the product (go / no-go)

**Go, with restrictions:**

- ✅ Beta-ready: image ads, competitor research, campaigns/library, Creative Assistant, and
  the chat/video-concept flows.
- ⚠️ **Video render is labelled unavailable** in the UI — the render worker is unhosted, so
  Veo shots can't be exported to MP4 yet (Veo *generation* and credit metering works).
- ⚠️ Backups are documented as **not configured** (see `OPERATIONS.md`), not claimed as done.
- ⚠️ Migrations and credit metering are **live-unverified** until an operator runs
  `supabase db push` against a linked project.

## Files in this folder

| Path | What it is |
| --- | --- |
| `studio/` | Web app UI, one file per studio view (Home, Chat, Image Ads, Video Ads, Research, Campaigns, Library, Brand, Integrations) plus the beta onboarding/feedback components and their API/test helpers |
| `supabase/functions/` | Supabase Edge Functions for the ad workflows: `ads-image`, `ads-video`, `ads-research`, `ads-chat`, `ad-campaigns`, `ad-render`, `voiceover`, `ai-images`, and supporting readers |
| `supabase/migrations/` | SQL that creates the ads schema: studio core tables, research tables, image-ads extras, video tables with shot records, and the `20261019000000_ads_beta_feature_costs.sql` per-feature credit costs |
| `supabase/config.toml`, `supabase/DEPLOY_NOTES.md` | Local Supabase config and deploy notes |
| `BETA_TEST_PLAN.md` | The beta test plan: go/no-go checklist, operator steps, feature matrix |
| `OPERATIONS.md` | Operational runbook (limits, alerts, backups, metering, provider spend) |
| `ads-studio-blueprint.md` | The original product blueprint the build implements |

## Recent fixes worth knowing about (final completion check)

1. **Migration assertion could never fire** — in
   [20261019000000_ads_beta_feature_costs.sql](supabase/migrations/20261019000000_ads_beta_feature_costs.sql)
   the missing-key accumulator used `NULL \|\| text`, which stays `NULL` in Postgres, so the
   fail-loudly migration guard was dead code. Rewritten with `COALESCE(v_missing \|\| ',', '') \|\| v_key`.
2. **Duplicate-spend guard on the Veo confirm path** — a refresh mid-flight or a re-sent
   confirm used to bill a second identical generation. `ads-video start` now returns the
   existing live shot (`running` / `done`) for the same owner + concept + shot instead of
   metering a new one, so only genuinely *new* attempts charge; a failed shot retries as a
   legitimately new attempt. This replaced an inaccurate "idempotency prevents
   double-charge" comment (the random per-request key was real, but not deduplicating —
   the DB guard now does that work honestly).
3. **Narration retry double-charge** — voiceover metering ran *before* the in-memory cache
   lookup, so an identical re-request charged credits again and *then* returned cached audio.
   Metering now runs after the cache hit (cache answers uncharged; `idempotencyKey` derives
   from the request's cache key), and the code comment states exactly that.

## Verification status (true exit statuses, no output-filtering)

| Check | Result |
| --- | --- |
| `npm run typecheck:functions` | PASS |
| `npm run test` | 168 files, 2,737/2,737 passed |
| `npm run build` | ✓ built in 23.2s |
| `npm run typecheck:app` | PASS |
| `npm run security:check` | PASS (31 checks) |
| `npm run secret:scan` | PASS (0 findings) |
| `supabase db push` | Not run — needs a linked project (operator step) |
| Live provider calls | Not run — deliberately no spend-bearing test (operator step) |

## To run or continue this work

Work in the main mono-repo (`C:\Users\gemme\Downloads\.freebuff`), where the studio lives at
`src/pages/studio/`, the edge functions at `supabase/functions/`, and the migrations at
`supabase/migrations/`. This snapshot mirrors those paths so a reviewer can trace every file
one-to-one back to where it was built.

Key entry points for the next contributor:

- Overall studio shell + routing: `src/pages/studio/StudioApp.tsx`
- Local request routing: `supabase/functions/_shared/adsRouter.ts` (+ pinned tests in `adsRouter.test.ts`)
- Veo generation + spend guard: `supabase/functions/ads-video/index.ts`
- Voiceover + cache/metering order: `supabase/functions/voiceover/index.ts`
- Image ad composition: `supabase/functions/_shared/imageComposition.ts`
- Feature cost table: `supabase/migrations/20261019000000_ads_beta_feature_costs.sql`
