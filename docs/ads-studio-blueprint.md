# Vaylo Sports Ads Studio — Rebuild Blueprint

**Stage: research & architecture only. No implementation code was written for this plan.**
Prepared 2026-10-17. Every claim below is either verified in this repository, verified
against a cited public source, or explicitly marked `UNVERIFIED`.

---

## A. Environment audit

### A1. What Vaylo Sports actually is (verified in repo)

- **Stack**: React 19 + Vite + shadcn/Radix + Tailwind (web/Android via Capacitor), i18next
  with 13 deployed locales, TanStack Query, Zustand, Playwright + Vitest.
- **Backend**: Supabase project `vvwhausdjzdmsyxekrcl` — 132 SQL migrations, ~40 Edge
  Functions, hosted auth (email, OAuth, passkeys), `pg_cron` for scheduled work.
- **Commercials**: Stripe + Play Billing, a credit/coin economy (`src/lib/creditEconomy.ts` etc.).
- **Deploy**: App bundle on Netlify (`vaylo-sports-netlify.app` in auth redirects), website in
  `website/`, native APK pipeline (`scripts/build-apk.sh`, `public-apk/`).
- **Guardrails already in place**: `scripts/secret-scan.mjs` (fails build on committed
  credentials), `supabase/functions/_shared/guard.ts` (per-user auth + per-action rate limits
  `aiCallAllowed`), provider-routing tests (`src/lib/aiProviderRouting.test.ts`) that pin which
  function may read which secret.
- **Known live debt**: `docs/BUG-AUDIT-2026-10-17.md` records 54 pre-existing TypeScript
  errors in the app build (PipelineDashboard, profile upload, ShareProfile…) and 2 failing
  Veo cost-estimate tests. These pre-date this blueprint and affect "build reproducibly".

### A2. The advertising pipeline that already exists

This is the critical audit finding: **a working v1 pipeline is already built**, verified live on
2026-10-10 (see `ads/WORKFLOW-STATUS.md`, which documents test counts and measurements, not
assumptions):

| Component | State | Where |
|---|---|---|
| Brief validation + cost gate | Working | `campaign` function |
| 3 creative concepts via OpenAI | Working (validated against fabrication rules) | `campaign` + `_shared/campaign.ts` |
| Veo shot generation | Working, requires `$`/shot | `ad-video` (secret `GOOGLE_VIDEO_API`) |
| Narration | Working (92–151 chars/spot) | `voiceover` (ElevenLabs) |
| FFmpeg assembly (captions, CTA, logo, 3 presets 9:16/1:1/16:9) | Working, **local-only** | `worker/` Docker container; dispatch via `ad-render` |
| Persistence: campaigns/concepts/assets/exports with owner-scoped RLS | Migration exists (`20261010100000_ad_campaigns.sql`) | `public.ad_campaigns`, `.ad_concepts`, … |
| Studio UI | Minimal and dev-oriented: `AdStudioPage.tsx` (415 ln), `CreateAdPage.tsx` (640 ln), `AIDev.tsx` (446 ln) | `src/pages/` |
| Image *ads* (static graphics) | **Not built** — only ad-agent image tools exist | — |
| Chat-based creative assistant | **Not built** — campaign API is action-shaped, not conversational | — |
| Competitor research | **Not built** | — |
| Stock/licensed media library | **Not built** | — |
| In-app asset preview/timeline editor | **Not built** | — |
| Storage bucket | **Does not exist** — assets return as base64; no bucket, public or signed | — |
| Hosted render worker | **Local only**; `RENDER_WORKER_URL`/`RENDER_TOKEN` referenced but hosting not provisioned | `worker/` |

### A3. Credentials available (verified this environment; values never printed)

| Provider | Config status | Consumer | Notes |
|---|---|---|---|
| OpenAI (app project) | Key exists in this conversation's memory; format `sk-proj-…`; → secret `OPENAI_API_KEY` | generate-plan, coach-chat, ai-analyze, ai-images, weekly-review, learning-recommend, edit-plan, nutrition, wearable-oauth, ai-service | The app's *whole* AI layer currently fails closed on this one secret |
| OpenAI (ads project) | Key exists → new secret `ADS_OPENAI_API_KEY` wired this session into `ad-agent` + `campaign` + `voiceover` with fallback | Ads pipeline only | Spend metering is deliberately separated from the app project |
| Google (Veo / Gemini video) | Key exists → `GOOGLE_VIDEO_API` | `ad-video` | Key shape matches a Google AI Studio key; **capability/billing UNVERIFIED** — needs one free `models.list` probe in the implementation stage |
| ElevenLabs | **Already set in the deployed project** (proven live) | `voiceover` | Key is scoped; `/v1/user` returns `missing_permissions`, so usage can only be counted in characters — the code already reports that honestly |
| Manus | Key exists in conversation memory; format `sk-…` | **No consumer exists.** `manus-invoke` is the *inbound* agent gate expecting `MANUS_SHARED_SECRET`, documented as "never a sk- style key" | Outstanding decision (J) |
| Supabase | MCP integration connected (`supabase_foal-tucker`) | Platform ops | Read tools were refused by this environment's approval set during research; state above is from repo + the 2026-10-10 live verification |
| Stripe, Play Billing, Resend/Gmail, FCM, Render worker token | Referenced throughout the codebase | Core app | Not ad-generation relevant |

**Rule adopted for stage 2 (implementation):** credential *presence* is verified by reading
secret *names* server-side or via `supabase secrets list`; capability is verified by free,
non-generating calls only (e.g. `GET /v1/models`, Gemini `models.list`, ElevenLabs voices).
No paid generation until the cost-gate module exists, and then only behind an explicit,
disclosed ceiling — exactly the pattern `campaign`/`ad-video` already implement.

---

## B. Integration inventory

Pricing verified 2026-10-17 from cited sources; per-unit numbers may change — re-check before
each provider is wired.

| # | Provider / service | Purpose | Credential | Capability | Config requirement | Cost (verified) | Restrictions | Suitability |
|---|---|---|---|---|---|---|---|---|
| 1 | OpenAI Responses + Chat (app & ads projects) | Concepts, hooks, briefs, edit instructions, ad copy review, chat assistant brain | `OPENAI_API_KEY` / `ADS_OPENAI_API_KEY` ✅ in hand | Documented, already live in v1 | `supabase secrets set` | Text: model-tier based (existing `aiModels.ts` registry); rough concept run measured 2,840 tokens | Fabrication rules enforced in code; 100-char search-term style limits don't apply here | ✅ Primary text brain. Reuse `MODELS` registry; keep two-project split for billing |
| 2 | OpenAI Images (current generation: **GPT Image 2.5**; gpt-image-1/1.5 deprecated) | Image ads, variants, edits | `ADS_OPENAI_API_KEY` ✅ | Documented via Images API and Responses tool | Same secret | Legacy reference points: gpt-image-1 ≈ $0.011/$0.042/$0.167 per 1k×1k image (low/med/high); 2.5 billing is token-based ($5/M text-in, $8/M image-in, $30/M image-out) | No price/feature fabrication; provenance/exclusion rules per platform | ✅ Primary image generator. UNVERIFIED: exact per-image price for 2.5 — verify at implementation |
| 3 | Google Veo 3.x (Gemini API) | 4–8 s video shots, 9:16 | `GOOGLE_VIDEO_API` ✅ in hand | Documented; v1 proven earlier ($ spent) | Same secret; billing must be active | 3.1: $0.40/s std·1080p, $0.10–0.12/s Fast, $0.05–0.08/s Lite (720p/1080p); an 8 s std clip ≈ $3.20 | 4/6/8 s; 9:16/16:9; ≤4 videos/prompt; people-generation policy limits | ✅ Best-fit shot generator; always quote before spend (already built) |
| 4 | ElevenLabs TTS | Narration | `ELEVENLABS_API_KEY` ✅ **already live** | Proven | none | $0.08/1k chars (v3/v4), $0.04/1k (turbo/flash); free tier is *not* commercial-licensed | Account key lacks `user_read` → only character counts observable | ✅ Keep. Reuse `voiceover` as-is |
| 5 | OpenAI TTS (`gpt-4o-mini-tts`) | Budget narration fallback | `OPENAI_API_KEY` ✅ | Documented | none | ≈ $0.015/min of speech | Requires AI-voice disclosure to end users | ◻ Optional fallback; ads quality bar favours ElevenLabs |
| 6 | Pexels API | Sports stock footage/stills, free | None today — needs a free key registered by the account owner | Documented | 1 key → `PEXELS_API_KEY` | $0; 200 req/h, 20 k/mo, higher on application | No attribution required; **must not** imply depicted person/brand endorses the product | ✅ Strong fit for B-roll under the `useAppFootage` model |
| 7 | Music libraries (Epidemic/Artlist/Pixabay) | Music bed | None | Documented | Owner picks + subscribes | Epidemic ads need Pro/Business (search-visible ≈ $30/mo billed annually); Artlist Social licence **excludes** paid ads; Pixabay free but thin for ads | Licence tier must explicitly cover paid social | ◻ Decision needed (J) — v1 correctly ships narration-only mixes rather than inventing music |
| 8 | Meta Ad Library API (`ads_archive`) | Competitor research | None; requires a Meta app + token from the account owner | Documented (Graph API v26.0) | App review not generally needed for this read-only endpooint; token + version pin | Free | **Only** political/social-issue ads worldwide + **EU/UK-delivered** commercial ads; 1-year retention for EU; searches ≤100 chars; ≤10 page IDs/query; no spend/targeting for ordinary commercial ads | ◻ Use within its scope; treat as evidence, not ground truth |
| 9 | TikTok Commercial Content API | Competitor research | None; developer account + application review (≈2 working days) | Documented | Owner application | Free | EU data only; retention while running + 1 year; reach is bucketed ("30K", "0–1K"); targeting category indicators available | ◻ Highest-value research source if approved; apply early |
| 10 | Google Ads Transparency Center | Competitor research (manual + EEA API) | None | EEA programmatic access documented; no general non-EEA API | Owner applies | Free | Political ads only via public BigQuery dataset | ◻ Medium value |
| 11 | Veo/OpenAI/Any "browser agents" (Manus) | Autonomous research/ops | Manus key ✅ in hand, consumer undefined | Manus is a desktop agent platform, not a documented server API for these tasks | Decision needed | n/a | — | ◻ Keep out of the production path unless J decides a role |
| 12 | Supabase Storage | Asset/rendition/export delivery | Platform-injected service role | Documented; bucket can be created by SQL migration (`insert into storage.buckets`) | One migration | Tier-existing (no new vendor) | Private bucket + server-generated signed URLs | ✅ Recommended replacement for today's base64-through-postgres pattern |
| 13 | Background jobs | Render queue, polling | Postgres + `pg_net` (present) | Documented: Edge limits — 150 s wall (free)/400 s (paid), **2 s CPU**, 256 MB → FFmpeg in Edge is impossible | jobs table + worker | — | pg_net is an async HTTP fire, not a durable queue; job state must live in tables | ✅ Durable `ad_jobs` table + worker claim loop |

**Named gaps needing owner action (not keys from me):** Meta app/token, TikTok developer
approval, Pexels key, music licence choice, render-worker hosting plan, ElevenLabs plan tier
(Starter+ grants commercial licence).

---

## C. Product specification

### C1. Personas & entry points

- **Who**: (a) the owner/marketer (primary operator); (b) later, internal team / beta creators.
  Ads target athletes ≈ 13–30; **paid-media compliance for under-18 audiences is stricter** —
  the studio must restrict tone/placement for minors and never advertise gambling-adjacent or
  supplement-adjacent claims (already encoded in brand rules).
- **Entry points**: dedicated Studio route (replacing/rebuilding `AdStudioPage`) with
  (1) chat assistant, (2) "Image ad" and "Video ad" explicit buttons, (3) research workspace,
  (4) campaign list & asset library, (5) brand settings, (6) integration status.

### C2. Feature list

1. **Chat creative assistant** — natural-language intake; acknowledges combined requests
   ("research then 5 concepts then a video"); shows a visible plan of stages with per-stage
   status; every expensive step shows its quote and requires approval (existing pattern).
2. **Image-ad pipeline** — brief → 3 variation concepts → generation (image model + brand
   layout) → text overlay pass with legibility floor (mirroring the 20 px rule used by the
   HTML ads) → aspect-ratio set (1:1, 4:5, 9:16, 16:9) → variant grid → regenerate-on-asset.
3. **Video-ad pipeline** — reuse v1: concepts (hook, script, storyboard, shots) →
   narration (ElevenLabs) → shots (Veo where AI-appropriate; real app footage for
   `useAppFootage`; Pexels for ambient sport) → assembly (existing `renderPlan` presets) →
   captions/CTA/slogan/logo → preview → export MP4.
4. **Competitor research workspace** — explicit sources (owner-approved APIs + pasted manual
   findings); every insight tagged **evidence** (linked source, verbatim quote, date) vs
   **assumption**; feeds into concept generation as a dossier argument.
5. **Campaign & project management** — persisted `ad_campaigns` (exists) + statuses:
   `draft → researching → concepts → generating → preview → approved → exported/failed`,
   per-asset statuses so partial regeneration is safe.
6. **Asset library** — every generation stored in Storage with kind
   (`image | video | audio | research | layout`), source (`generated | stock | uploaded | app-footage`),
   licence provenance and cost record; never represent a script as a storyboard or a
   storyboard as a rendered video (enforced in schema status enums + UI badges).
7. **Preview & revision tools** — asset-level "regenerate", prompt-level tweak requests via
   chat that route to the right module without regenerating siblings.
8. **Export** — MP4 preset set (existing renderer presets), image set per placement, plus
   research dossier export (Markdown/PDF later).
9. **Brand settings** — single source of truth: colours, slogan set, forbidden-claims list,
   audience guidance, CTA bank. One `brand` module consumed by both functions and worker
   (today: `_shared/vayloBrandKnowledge.ts`, 300 lines, shared already).
10. **Integration status panel** — shows which providers are configured/enabled/missing,
    quoting names, never values; shows 402/403 error shapes so misconfig is visible.
11. **Cost ledger** — per-campaign running total with per-step quotes and ceilings; surfaced
    in UI before any paid call (v1 already refuses over-ceiling steps with the amount named).

### C3. User journeys (summary)

- **J1 "Make an image ad"** → chat parses intent=image → brief screen prefilled → 3
  variations → costed preview → generate (N×image) → variant grid → export.
- **J2 "Make a 15-second launch video"** → intent=video → storyboard plan shows why 15 s
  (shot lengths + narration) → quote list → approve → generation jobs run in order →
  assembly in worker → preview player → export.
- **J3 "Research competitors, then five concepts"** → one session, plan =
  [research, concepts×5, …]; research produces dossier (evidence/assumption rows) →
  dossier is attached as context to the concept prompt → concepts numbered 1–5 (schema
  currently caps `concept_number ≤ 5` ✓).
- **J4 "Improve this existing ad"** → locate asset in library → chat edit instruction →
  routes to single-asset regen or re-assembly; siblings untouched (v1 already regenerates
  single assets independently ✓).

---

## D. Technical architecture (recommended)

**Principle: reuse the verified v1 spine; rebuild the surfaces around it.** The stack is
already Supabase-first, deeply integrated with billing/credits/RLS/testing, and the
`ads/WORKFLOW-STATUS.md` evidence shows the expensive, failure-prone parts (concepts,
narration, cost gating, FFmpeg assembly) work when run. A different backend would abandon
proven code for zero benefit.

| Layer | Decision | Why |
|---|---|---|
| Frontend | Same React/Vite/shadcn app; new `Studio` feature module under `src/pages/studio/` with chat panel, format pickers, library grid, brand settings | Consistency, i18n, mobile-first responsiveness, dark navy/purple tokens already exist |
| Backend | Supabase Edge Functions, one function per causal stage (already the pattern): `ads-chat`, `ads-research`, `ads-image`, existing `campaign`, `ad-video`, `voiceover`, `ad-render` | Mirror of the existing single-purpose function style; 2 s CPU limit keeps them proxy-oriented |
| Orchestration | New `ads-chat` owns a **session state machine** persisted in Postgres; clients never orchestrate multi-step, cost-bearing flows themselves | Combined requests ("research then video") run server-side in order; crash-safe |
| Database | Extend the existing `ad_*` schema: `ad_sessions`, `ad_research_items` (evidence/assumption/dual-tagged), `ad_assets` with `kind`/`source`/`cost`/`status`, `ad_jobs` | v1 tables already exist with correct owner-scoped RLS; reuse `unique (campaign_id, concept_number)` |
| Storage | New private `ads` bucket via migration; assets uploaded **server-side**; client receives short-lived signed URLs only | Replaces base64-through-DB; enables video assets without magic memory blobs; TikTok Direct Post URL-pull could later use signed URLs on a verified prefix |
| Render | Keep the `worker/` FFmpeg container; **host it** (decision in G) — dispatch from `ad-render` only, tokenId server-held | Proven renderer with measured exports; 79.5 % pixel-brand check exists |
| Secrets | Supabase secrets only; never `VITE_*`; secret scans build-blocking | Existing, verified |
| Rate/cost | Extend `guard.ts` patterns: per-user + global *dollar* ledgers per day and per campaign | Cheap O(1) reads; matches cost-awareness requirement |
| Logging | `console.error` without secrets (existing style), plus `ad_jobs` audit rows for every provider call (provider, model, cost quote, status) | Reproducible debugging + cost reporting |

**Rebuild vs reuse:** rebuild `AdStudioPage` (dev-grade), build chat/research/image modules
(new), **reuse** `campaign`, `ad-video`, `voiceover`, `ad-render` dispatch, `renderPlan`
assembly, `_shared/veo.ts`/`elevenlabs.ts`/`guard.ts`, and the brand knowledge module.

---

## E. Workflow diagrams

### Image-ad flow

```
Client (chat or Image button)
  → POST ads-chat { session, intent: image_ad, brief }
      → classify + persist intent + plan [brief, concepts, images(n), delivery]
      → campaign.upsert (validated brief)
      → campaign.concepts → 3 concepts, ≥2 image-first variants       [OpenAI, quoted]
  → user picks 1–3 → POST ads-image { conceptId, sizes[] }            (per size, per concept)
      → estimate quote → aiCallAllowed rate check → gpt-image generate [ADS key]
      → legibility/brand post-check (server-side pixel/simple OCR rules)
      → upload to Storage → signed URL → asset row(status=ready, kind=image)
  → library grid → regenerate single asset | chain edits (Responses tool)
  → export bundle (zip of placements + manifest)
```

### Video-ad flow (uses proven nodes)

```
Chat "make 15-second launch video"
  → ads-chat: plan [brief→concepts→plan quote→narration→shots→assemble→preview→export]
  → campaign { action: plan } → quotes: Veo seconds×rate, ElevenLabs chars,
    assembly cost; refusal above ceiling BEFORE any spend            (existing)
  → approval required (existing pattern; warning cannot be clicked past)
  → voiceover { draft→validate→generate }                             (existing)
  → per shot: useAppFootage? (await upload) | Pexels fetch | veolite/fast/std (quoted)
  → ad-render → worker claims job → FFmpeg assembly (presets)
  → worker uploads to Storage → signed URL → preview screen
  → export/regenerate single asset if needed
```

### Competitor-research flow

```
Chat "research competitors before concepts"
  → ads-chat: intent=research (subplans per competitor)
  → ads-research:
      for each approved source: Meta ad_archive (EU/UK + political only),
        TikTok Commercial Content (EU, approved app), Google ATransparency (EEA),
        manual paste workspace (always available)
      → normalise rows { source, url, date, hook, visual, cta, observed_at }
      → analysis pass: label each insight evidence (linked, quoted) or assumption
  → dossier stored as ad_assets(kind=research) → injected as context into
    campaign.concepts prompt (evidence only; assumptions marked)
```

---

## F. Competitor research strategy

**Sources, in order of value:**

1. **TikTok Commercial Content API** (EU-only today, approval needed) — richest data: creative
   URLs, title, dates, CTA, landing URL, objective, targeting *category indicators*, and
   bucketed reach by region/age/gender. Apply with the owner's developer account first; ~2
   working-day review per TikTok.
2. **Meta Ad Library API** — worldwide political/social issue + **EU/UK-delivered commercial**
   ads; ≤100-char search terms, ≤10 page IDs per query, 1-year retention for EU commercial
   ads, no spend/targeting for ordinary commercial ads. Use `page_id` sets gathered manually
   from each competitor's page.
3. **Google Ads Transparency Center** — manual search now; documented EEA programmatic access.
4. **Public campaign surfaces** — Strava press page (`press.strava.com`; note the Runna
   acquisition), brand product pages, official social accounts. Watch for campaign
   announcements; no automation beyond approved APIs.

**Rules of engagement (researcher-verified):** Meta forbids non-platform automated access;
TikTok terms prohibit scraping; use only approved APIs; never republish creatives without
rights checking; a public page ≠ permission to scrape.

**Analysis method** (what the model examines): hook (first 3 s / first line), visual design,
messaging & positioning, CTA, structure & pacing, audience signals (where provided by the
platform), creative format, brand differentiation, recurring angles. **Every insight is stored
with observable evidence** (source URL + verbatim field) or is labelled an assumption. The
product **does not claim** access to private data, true reach/targeting, or performance
metrics — platform data is bucketed/retention-limited, and that limit is visible in the UI.

**Differentiation surface:** competitors emphasise tracking + community (Strava), guided runs
(NRC), training plans (Runna). VPR — locally-computed, sport-weighted performance rating —
remains the only claim that is simultaneously unique, verifiable and live (see
`ads/SLATE.md` claim ledger: AI-plan/coach/form analysis are unadvertensible until their
provider secrets are set — the studio's own keys do not unlock the *app's* AI claims).

---

## G. Cost & feasibility assessment

**Per-unit verified numbers** (re-check at implementation):

| Item | Cost | Notes |
|---|---|---|
| Veo 3.1 std 1080p | $0.40/s | 8 s shot ≈ $3.20; the dominant cost driver |
| Veo 3.1 Fast 1080p | $0.12/s | 8 s ≈ $0.96 — good iteration default |
| Veo 3.1 Lite 720p | $0.05/s | 8 s ≈ $0.40 — sketch pass |
| GPT image (low/med/high ref) | ~$0.011 / $0.042 / $0.167 (1:1) | 2.5 is token-billed; verify exact |
| ElevenLabs v3/v4 | $0.08/1k chars | A 14-word hook ≈ 90 chars ≈ $0.008 |
| Concepts (OpenAI text) | ≈ 3k tokens / campaign | Measured live: 2,840 tokens ≈ <$0.05 |
| Pexels footage | Free | 200 req/h + attribution rules |
| Music (if used) | Epidemic ads tier ≈ $30/mo (annual) or skip | v1 already ships narration-only mixes |
| Render worker host | Render 1 CPU/2 GB ≈ $25/mo; Railway ≈ $20/vCPU + $10/GB-ram/mo; Fly ≈ $17.55/mo shared-8x/2 GB | Scale-to-zero wakes slowly — avoid for first-request latency |

**Cost model per finished video ad** (conservative build with Veo Fast + Lite sketching):
**≈ $3–7** (4 shots: 2 Lite drafts ×2 attempts + 2 Fast finals + narration + text tokens).
Image ad: **≈ $0.05–0.50** depending on quality tier and variants. Campaign-with-research
overhead: **+$0.02–0.10** text tokens + research API cost (free).

**Bottlenecks ranked:** (1) hosting the render worker (blocks everything video for
production); (2) Veo spend needing approval flow (already built); (3) OpenAI image legibility
— text-in-image is unreliable → the blueprint adds a deterministic overlay pass instead of
trusting the model; (4) TikTok/Meta API approvals (owner applications); (5) 54 pre-existing
TS errors that block `tsc` builds of the app shell — fix before the UI work, not during.

---

## H. Implementation plan

Ordered; each stage is independently verifiable; "project" = this repo.

| # | Stage | Depends on | Key outputs |
|---|---|---|---|
| 0 | Pre-flight verification: free provider probes (Gemini `models.list` for Veo, OpenAI `models`, ElevenLabs voices already live), `supabase secrets list` name check; reproduce + assign owners for the 54 TS errors + 2 failing tests | — | `docs/ads-integration-report.md` (names only, no values) |
| 1 | Baseline hygiene: fix the known audit debt so `tsc`+`vitest` are green | 0 | Clean CI signal |
| 2 | Schema v2 migration: `ad_sessions`, `ad_research_items`, `ad_jobs`, extend `ad_assets` (`kind`, `source`, `cost`, `status`) + private `ads` Storage bucket via `insert into storage.buckets` | — | Migration + RLS policies + tests |
| 3 | Brand service hardening: one shared `brand` module (server + worker); brand settings table/UI synced by edge function | 2 | Single source of truth |
| 4 | Cost ledger + approval gate extension: daily/campaign ceilings, quote state persisted per job | 2 | `ad_jobs` + guard changes |
| 5 | `ads-image` function + worker overlay pass (deterministic text rendering onto generated images) | 2,3 | Image pipeline green locally |
| 6 | `ads-research` function + evidence/assumption normalisation + manual-paste ingest | 2,3 | Research module + tests |
| 7 | `ads-chat` orchestrator + `ads_sessions` state machine (intents: image/video/research/mixed/edit) | 4,5,6 prerequisites per intent | Chat backend green |
| 8 | Studio UI: rebuild `AdStudioPage` → chat + format entry points + library + brand + integration status; wire to existing preview/download endpoints | 7 | Usable beta |
| 9 | Render worker hosting + dispatch hardening (token held server-side only; job claim idempotency; worker restart-stamp check validated against hosting) | 2 (jobs) | First hosted render in production |
| 10 | Provider verification tests + acceptance suite (I) wired into CI where offline | all | Acceptance pass |
| 11 | Optional: Pexels integration behind research/upload flows; TikTok/Meta connectors gated by owner approvals (J) | 9,#11 approvals | Wider research + auto-post (with caveats) |

---

## I. Acceptance-test plan (measurable)

| # | Test | How |
|---|---|---|
| 1 | Image-ad and video-ad requests route to their workflows | `ads-chat` unit tests on intent classifier; e2e: two seeded chats produce distinct session states |
| 2 | Combined request preserves order | Fixture "research then 5 concepts" → session plan asserts research completes before concepts; violating sequence fails |
| 3 | Existing credentials reused securely | Secret *name* resolution tests; `grep`-based test that no `sk-`/`AQ.` literal lands in tracked files (extends existing `secret-scan.mjs`) |
| 4 | Missing credentials identified without secrets leaked | Remove a secret in a test env → chat returns `provider unconfigured` naming the secret; error text asserted to exclude any key prefix |
| 5 | Research distinguishes evidence vs assumptions | Schema requires provenance for `evidence` rows; UI test asserts badge rendering; prompt-injection fixture (a pasted page containing instructions) is treated as content only |
| 6 | Brand settings central | One `brand` module; both `ads-image` and worker import it; settings edit reflected in next generation without redeploy |
| 7 | Distinct representations for script/storyboard/images/video | Enum checks: a `storyboard` row cannot be served where `video` is expected; UI badge per kind |
| 8 | Assets previewed and exported where supported | Playwright: video preview plays, export produces MP4 with measured H.264 + duration; image grid exports PNG set |
| 9 | Generation failures reported accurately | Force HTTP 500/429 from providers via test doubles; session shows failed with provider message; no silent retry/spend |
| 10 | Desktop + mobile usable | Playwright at 390×844 and 1440×900: chat, library grid, brand settings all reachable; no horizontal scroll |
| 11 | Reproducible build & tests | `npm run typecheck` (functions + app) exit 0; `npm run secret:scan` exit 0; `npx vitest run supabase/functions/_shared` all pass |
| 12 | Costs controlled | Unit tests: refuses 11th paid generation beyond daily ceiling; quotes persisted >90 % of paid calls; ledger totals match sum of job rows |
| 13+ | Per-provider tests | Veo payload/operation shapes (existing `_shared/veo.test.ts` fixed first); ElevenLabs billable chars; OpenAI image edit requires source asset; Meta/TikTok connectors mocked |

---

## J. Outstanding decisions (need your input)

1. **Studio audience** — internal marketing tool first (recommended; cheapest, least
   compliance surface) or eventually in-app for coaches/creators? Drives auth scope and
   whether TikTok "Direct Post" is even permissible — TikTok's guidelines look unfavourably
   on tools mainly used to publish to accounts the developer controls, and the unedited-post
   /audited-client caps (≈15 posts/day/creator) constrain automation.
2. **Render-worker host and budget** — Render ($25/mo 1 CPU/2 GB disc) vs Railway (~$30/mo)
   vs Fly.io ($17–35/mo) vs leaving renders local for the beta. Blocks every production video
   export.
3. **Music licensing** — Epidemic Pro/Business (paid ads allowed, ≈ $30/mo annual) or
   narration-only mixes (current, correct-by-default). Decision affects the render mix module
   and the asset `source=licensed` audit row.
4. **Paid-media approval tasks only you can do** — Meta developer app + token, TikTok
   developer application (≈2 days), Pexels free key, ElevenLabs plan tier with commercial
   licence (Starter+), optional Google EEA transparency API application. I can wire all of
   these behind config, but they need your accounts.
5. **The Manus key** — definitive purpose: it is outbound-shaped (`sk-…`) while the only
   Manus integration in the codebase is the inbound `manus-invoke` gate that explicitly
   refuses `sk-`-style values. Options: (a) park it, (b) configure the agent side to call
   Vaylo with a dedicated shared secret, (c) build a genuinely new outbound integration.
6. **Who pays for generation** — current draft treats the studio as internally-billed (owner
   budget, ceilings); if beta creators generate, we need a per-user credit spend policy
   (exists: `creditEconomy.ts`) and an explicit non-claim disclaimer set.
7. **Fix order confirmation** — the 54 known TS errors pre-date this blueprint; stage 1 fixes
   them before Studio UI work. Confirm that's acceptable or whether you want the Studio MVP
   behind a feature flag on the broken-but-shipping tree instead.

---

## Summary for the next stage

The rebuild is realistically a **v2 of three genuinely missing pillars** — chat orchestration,
image ads, and competitor research — **on top of a verified v1 spine** (brief→concepts→narration→
Veo→FFmpeg assembly, cost-gated) rather than a from-zero rewrite. The environment already holds
credentials for the four expensive capabilities (OpenAI text, OpenAI images, Veo video,
ElevenLabs voice) either live in the deployed project or provided by you this session; what is
genuinely missing is (a) storage persistence + hosted render worker, (b) your approvals for
Meta/TikTok/Pexels/music sources, and (c) decisions J1–J7.
