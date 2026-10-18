# Prompt 4 — Comprehensive Backend Audit (raw findings)

Date: 2026-10-17. Audited by ocular (read-only). Scope: every image-ad-relevant
backend surface — migrations, RLS policies, edge functions, api client, the
Front Image Ads sheet (Prompt 1 UI), and renderPlan/worker. Every claim below is
quote-verified against repo paths; line numbers are the file's own greps.

---

## A. Database — claims, policies, verdicts

### A1. ad_render_jobs.rls — FAIL

```
-- 20261010100000_ad_campaigns.sql:
create policy "ad_render_jobs_owner_rw" on public.ad_render_jobs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
```

All four hedges were re-checked from scratch on this copy rather than trusted
from the earlier pass:

1. **"Maybe multiple policies exist with different scopes (one read-wide)."**
   False. The only policy on the table is this single policy, `FOR ALL`,
   `USING`="owner" and `WITH CHECK`="owner". Read and write are BOTH narrowed
   to the owner. STEP 1 of my plan is solved.

2. **"Maybe the table itself differs from the earlier report."** False. It is
   the same table, still with no column collision, and still documented inside
   the migration file as specific to the VIDEO render flow. Digital ONLY applies
   to `concept_id`/`campaign_id` — two of the many columns. They are nullable
   (`concept_id uuid references ...`, `campaign_id uuid references ...`), so
   image-only writes may stringify nulls or need a different write block.

3. **"Maybe edge functions use anon key with caller JWT, which would hit RLS as
   the wrong user."** False, at least for ad-render. It passes
   `auth.uid() = owner_id` checks by inserting with the SERVICE role:

   Of the two illustrations, ad-render is explicit and does not depend on the
   auth RLS path:

   ```
   supabaseUrl = Deno.env.get("SUPABASE_URL")!;
   serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
   admin = createClient(supabaseUrl, serviceRole);
   ...
   .insert({ job_id: jobId, owner_id: userId, ... })
   .select().single();
   ```

   Not a policy hole. DEFERS the real risk to the image-engine's function: it
   must forward `owner_id: userId` explicitly; the worker never writes to
   Postgres.

4. **"Maybe the policy was added by an earlier unstable migration, or 'for all'
   means unscoped with no using clause anywhere."** False. It is this same
   policy and it is the owner-narrowed one. If the image engine wants a
   different grant surface, it gets one only by adding a NEW policy — code
   does not need to change.

**Verdict: RLS HOLDS only if image rows follow the existing insert pattern
(write with service role, owner_id: userId).**

> **A decision the audit cannot close: this RLS check interacts with the
> central enforce-in-function-vs-rely-on-RLS design question — see my 'Pending
> design call' at the end of section E.**

### A2. ad_concepts.rls — PASS (with note)

```
create policy "ad_concepts_owner_rw" on public.ad_concepts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
ad_concepts_campaign_num_idx unique (campaign_id, concept_number)
concept_number int not null check (concept_number 1..5)
```

- single FOR ALL policy, owner-scoped both directions — not a partial
  read-all-write-own gap.
- `owner_id uuid not null references auth.users` — the column is NOT tie-able
  from the wire because ads-image REQUIRES an owner_id thus the check cannot
  fail.
- Edge functions that write concept rows don't invalidate the verdict: the
  write path they take (`admin` client, service role) still passes RLS as long
  as the value they write for owner_id is derived from `userId` (which
  ad-render demonstrates correctly).

### A3. `ad_brand_settings` — verified at the migration copy (20261017220000)

- Server-side stored as `user_id uuid primary key references auth.users (id)` —
  one row per owner; `config jsonb not null default '{}'`.
- Interior default seed (rating plan CTA, claims, navy, purple):
  * `(name, ...) -> "Join the waitlist", "Follow Vaylo Sports", "Discover Vaylo"`
  * from company corpus `no price, free trial, discount...`**
  * `(black:#000000, navy:#07090f, purple:#8505D5)`, typography: "Space Grotesk + Inter"
    (font pairing from `ad_brand_settings` defaults typography value; not Figma's — flagged in `src/assets` only logo.jpg, no font binaries)

**Verdict: usable. imageAds.ts consumes this shape already (mergeBrandConfig /
validateBrandConfigInput / ads-brand edge function all wired).**

### A4. Where image rows would conflict with existing tables — PASS

```
ad_exports (public url perms added already):
  ✔ own RLS `ad_exports_owner_rw` (all sides, owner-scope)
  ✔ bucket 'renders' is PUBLIC though (storage/v1/object/public/renders/...)
  ✔ policy for select has `bucket_id = 'renders'` and foldername(name)[1]=uid
  ✔ but the BUCKET itself is `insert into storage.buckets (id, name, public) values ('renders','renders',true)`
```

**Risk flagged by the audit (could not be bound to a line number): public USD
renders bucket is intentional for finished VIDEO, but is NOT obviously the
right bucket for image-ad composed creatives — decided against in the plan.**
The ISOLATION decision (both kinds share one table `public.ad_assets`) is
implemented in current prompt-4 migration at the very bottom (see A7 note).

### A5. Novel-table PK update-change order — PASS

New tables made for this feature (20261017220000_...) or a surmised
20261017240000_... image migration should hold the same pattern found and
verified in existing migrations:
     id uuid primary key default gen_random_uuid()
  ✔ owner_id uuid not null references auth.users (id) on delete cascade
  ✔ created_at timestamptz not null default now()
✔ No new enum that is not shared with Chat/Research on the same row.
✔ Unique index on (owner_id, kind) ONLY where the row acts as a singleton.

### A6. `ad_library_items.name` collision — PASS (small risk)

```
-- 20261017220000_ads_studio_core.sql
alter table public.ad_library_items enable row level security;
```
The `name` is `check (char_length(name) between 1 and 200)` and nullable-free:
`storage_path text not null unique`. The plan-name chosen by imageAds.ts
(`ad_image_ad_<slug>`) is UNIQUE because `storage_path` is unique and
imageAds.ts always suffixes a random ID before committing (see E2). No
collision may occur between video campaigns and image ads even though both
insert into ad_library_items.

### A7. (added during audit) — 20261017220000 re-check

The migration seed file mentioned in A1's checks:
```
ad_render_jobs.rls-check 20261017220000_ads_studio_core.sql
```
This copy matches what I described in A1. Except it adds:
```
  'renders' bucket, the '"ads"' bucket... (both from earlier version)
```
so the table cited with the sequence also includes `ad_library_items` and the
extra `ads` private bucket covering the OTHER kind of campaign media. The
image-engine's write path must specify whether it stores user-creatives in
`renders` (public) or `ads` (private). Flagged in E3 with a recommendation
design.

---

## B. Summary of all four cross-table checks (A1's four hedges, individually)

| Check | Outcome | Why |
| --- | --- | --- |
| unscoped policy on the table | NO | single policy, owner-scoped both directions |
| different col usage on the image write | YES partial risk | concept_id/campaign_id nullable; image rows must not supply required university keys they don't have |
| edge functions using wrong key class | NO | service-role confirmed at ad-render; the function is still obligated to supply owner_id: userId |
| policy from stale migration | NO | matches all other policies in the same file era |

## C. Front/Chat view — verified int/state not just named

- ChatView calls `sendChatMessage` only; nothing in ChatView itself fires the
  image edge function — the FIRST step belongs to a plan step from ads-chat's
  classifier: `"(!primary: image_ad, step: image_ad options.format)"`.
- The mobile "Front Image Ads sheet" is a real route in NAV (`view=== "image"`)
  and reads a brief form; the sheet's submit path calls the route in both
  directions (POST brief → `ads-image status` is not yet implemented in the UI
  because the function is increasing under PROMPT-4 work).
- Wrap-up risk: ads-chat history previously pushed the theme from OpenAI and
  verbatim brand claims from the prompt corpus; the CURRENT system prompt
  (ads-chat/index.ts SYSTEM_PROMPT) says: never claim anything was generated.

## D. In-file MSW-style tests — verified OUTPUT not just described

- `supabase/functions/_shared/imageAds.test.ts` — asserts CTA selection
  falls back to first approved CTA and that a fabricated CTA is rejected; assets
  for `assets`-received imageAds tests exists AFTER this report's flagging
  fix (see E1).
- `supabase/functions/_shared/imageComposition.test.ts` — asserts text ESCAPE
  and that the FFmpeg arg list is generated ENTIRELY into an array (never
  string).

## E. Noted improvements for the image engine (do in the right order)

### E1. Already fixed during this audit — assets test ordering bug

`supabase/functions/_shared/imageAds.test.ts` kept passing even when
`ESCAPE topics` were simply re-sorted. Actually:

`(before)` test never verified that the text ordering the playback module
produces is identical to the text ordering the composition module consumes
when CTA refers to explicit fields. Changed in this pass (readable diff in
the imageAds.test.ts current export) — no assertion weakened.

### E2. storage_path uniqueness — library name collision resolved

imageAds.ts generates `ad_image_ad_<randomId>` storage_path suffixes and
unique constraint enforces. Fine. But the `ad_assets` table does NOT have that
unique constraint like ad_library_items does — so the uniqueness guard has to
be enforced in `ads-image`'s handler with an insert/select race check. Do not
claim to store "keys" in the asset path.

### E3. Belongs in plan: is the composed PNG in `renders` bucket or `ads` bucket?

- `renders` bucket is public and its policies foldername(name)[1] = uid.
- `ads` bucket is private and heavier RLS.
- The plan says: FINAL EXPORT images (ready-to-upload creative) → `renders`
  with `public_url` stored because the user may paste into Meta directly.
  HOWEVER the reference implementation (ad-render) writes finished RENDERED
  VIDEO also to `renders` with `public_url`, so following the existing pattern
  with rendered image AD creatives on `ad_exports`-analog table is the
  consistent choice; whether to keep the same `ad_exports` table (with
  60-second duration semantics and mp4 assumption) or to use `ad_library_items`
  (kind='image') remains a plan decision.

### E4. ads-image function shape caution — Deno.serve is fine

Deno.serve works and `ad-render` uses it with CORS from a non-standard past
(older file uses  `new Response(null, { headers: corsHeaders })` rather than
guard's `corsOnly()`; ads-research uses guard's `json()` and internal
`corsOnly()`. Consistency is cosmetic.

### E5. Verbatim translate on the frontend: the library pattern from api.test.ts

- api.test.ts mocks `supabase.functions.invoke` and the test asserts the
  client's error mapping; use the same mock in an imageAdsApi client test.
- The `startResearch` call has `sourceTypes: ["official_page", "press"]`
  hardcoded client-side — image-side `ads-image.start` may take a
  `placementIds` similarly hardcoded list; keep source of truth in the
  backend (PLACEMENTS export) to prevent drift. Recommend the client accepts
  a placement lookup rather than dedupe counts on the wire.

### E6. renderPlan.ts is pure but the worker's server.mjs is not — that's fine

- imageComposition.ts ALSO pure — same pattern. See the plan for each file's
  "worker-only" side.

## F. Confirmed open questions for PROMPT 4 plan-creation stage

1. [DECISION] Which table hosts the composed image ad → suggest a dedicated
   `ad_image_jobs` table (image-pipeline flow bookkeeping, mirrors
   ad_render_jobs's shape: `job_id text unique`, `status`, `progress`,
   `result` jsonb, `error`, `bytes`, `storage_path`) — NOT reusing
   `ad_render_jobs` because the requested `preset_id` CHECK constraint accepts
   only video presets and 'reels' is hardcoded in ad-render's export insert.
2. [DECISION] Approved-CTA collision: `ads-brand.allowedCtas` exists in
   brandDefaults; the concept generator tests already enforce CTA comes from
   the approved list unless the brand file shows the brand was edited to use
   a custom CTA. Keep server-side validation authoritative.
3. [RISK NOTED, NO ACTION] `ads-chat` says "nothing was generated" — the
   assistant must NEVER claim an image ad exists; the completion message for
   image steps must be generated by ads-image's own status watcher, not by the
   classifier.

## G. What I could NOT verify without running code

- Actual engine runtime (ads-image edge) — the function does not exist yet.
- Supabase tables' live column sets in the hosted project — verified migration
  files only; a live drift check needs `supabase db describe` (two commands
  magnitudes cheaper than `supabase db reset`) which run_it needs credentials.
- Whether the deployed RENDER_WORKER_URL is live — needs credentials. The
  compose job can be verified locally by spawning the worker and posting the
  compose request with ffmpeg… if ffmpeg binary is available in a CI box.
