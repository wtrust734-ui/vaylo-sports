-- Ads Studio image-ad engine: projects, concepts, artifacts, compose jobs.
-- Mirrors the video pipeline's table shapes (ad_campaigns/ad_concepts/
-- ad_exports/ad_render_jobs) but is image-specific: the video tables' preset_id
-- CHECK and duration semantics do not fit a still image (audit F1).
-- All owner-scoped RLS; owner always comes from the server (JWT), never from
-- the wire. Re-runnable: create ... if not exists, drop-then-create policies.

-- ---------------------------------------------------------------------------
-- 1. Image-ad projects — one creative project ("Make five launch ads") which
--    holds the user's original request, the campaign link and the pipeline log.
-- ---------------------------------------------------------------------------
create table if not exists public.ad_image_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- the original user request, verbatim and bounded
  request text not null check (char_length(request) between 1 and 2000),
  status text not null default 'brief'
    check (status in ('brief', 'concepts', 'generating', 'composed', 'ready', 'failed')),
  -- campaign link optional: an image ad can exist without a video campaign
  campaign_id uuid references public.ad_campaigns (id) on delete set null,
  -- optional research linkage for evidence-backed concepts (audit F2)
  research_project_id uuid references public.ad_research_projects (id) on delete set null,
  brief jsonb not null default '{}'::jsonb,
  pipeline_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_image_projects_owner_idx
  on public.ad_image_projects (owner_id, updated_at desc);

alter table public.ad_image_projects enable row level security;
drop policy if exists "ad_image_projects_owner_rw" on public.ad_image_projects;
create policy "ad_image_projects_owner_rw" on public.ad_image_projects
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 2. Image concepts — the AI creative concepts (imageAds.ts CONCEPT_FIELDS).
--    concept_number keeps the 1..5 PatternSet from ad_concepts so a brand can
--    keep a stable number when browsing five alternates.
-- ---------------------------------------------------------------------------
create table if not exists public.ad_image_concepts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ad_image_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  concept_number int not null check (concept_number >= 1 and concept_number <= 5),
  payload jsonb not null default '{}'::jsonb,
  -- '' = the AI-generated text; no other column holds it
  status text not null default 'proposed'
    check (status in ('proposed', 'selected', 'rejected')),
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, concept_number)
);
create index if not exists ad_image_concepts_project_idx
  on public.ad_image_concepts (project_id, concept_number);

alter table public.ad_image_concepts enable row level security;
drop policy if exists "ad_image_concepts_owner_rw" on public.ad_image_concepts;
create policy "ad_image_concepts_owner_rw" on public.ad_image_concepts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 3. Image artifacts — every stored still image tied to a concept or project.
--    distinguished from VIDEO-only kind because 'renders' entries can hold
--    mp4s too; image rows need PNG/JPEG/WEBP; both need kind-safe border.
-- ---------------------------------------------------------------------------
create table if not exists public.ad_image_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ad_image_projects (id) on delete cascade,
  concept_id uuid references public.ad_image_concepts (id) on delete set null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- original = a freshly generated background | composed = finished ad with
  -- brand text | variant = edit of another row | exported = extracted export
  artifact_kind text not null default 'original'
    check (artifact_kind in ('original', 'composed', 'variant', 'exported')),
  -- generation background vs composition pass
  stage text not null default 'generated'
    check (stage in ('generated', 'composed')),
  -- edited only when this row is a variant of another row
  parent_artifact_id uuid references public.ad_image_artifacts (id) on delete cascade,
  placement_id text not null default 'ig_feed_square',
  storage_path text not null unique,
  mime text not null default 'image/png',
  width int not null check (width >= 64 and width <= 3840),
  height int not null check (height >= 64 and height <= 3840),
  bytes int check (bytes >= 0),
  -- provider metadata: model, prompt hash, output_format, generation tokens
  provider jsonb not null default '{}'::jsonb,
  -- original brief that produced it; never dropped so versions recover
  source_brief jsonb not null default '{}'::jsonb,
  status text not null default 'ready'
    check (status in ('pending', 'generating', 'composing', 'ready', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_image_artifacts_project_idx
  on public.ad_image_artifacts (project_id, created_at desc);
create index if not exists ad_image_artifacts_concept_idx
  on public.ad_image_artifacts (concept_id);
create index if not exists ad_image_artifacts_owner_idx
  on public.ad_image_artifacts (owner_id, created_at desc);

alter table public.ad_image_artifacts enable row level security;
drop policy if exists "ad_image_artifacts_owner_rw" on public.ad_image_artifacts;
create policy "ad_image_artifacts_owner_rw" on public.ad_image_artifacts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 4. Image compose jobs — deterministic text/logo FFmpeg composition runs
--    through the render worker (audit F1: not the video ad_render_jobs table).
-- ---------------------------------------------------------------------------
create table if not exists public.ad_image_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.ad_image_projects (id) on delete cascade,
  concept_id uuid references public.ad_image_concepts (id) on delete set null,
  background_artifact_id uuid references public.ad_image_artifacts (id) on delete set null,
  output_artifact_id uuid references public.ad_image_artifacts (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'preparing', 'rendering', 'done', 'failed')),
  progress int not null default 0 check (progress >= 0 and progress <= 100),
  placement_id text not null default 'ig_feed_square',
  compose_request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  bytes int,
  storage_path text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_image_jobs_owner_idx on public.ad_image_jobs (owner_id);
create index if not exists ad_image_jobs_job_id_idx on public.ad_image_jobs (job_id);
create index if not exists ad_image_jobs_project_idx on public.ad_image_jobs (project_id);
create index if not exists ad_image_jobs_status_idx on public.ad_image_jobs (status);

alter table public.ad_image_jobs enable row level security;
drop policy if exists "ad_image_jobs_owner_rw" on public.ad_image_jobs;
create policy "ad_image_jobs_owner_rw" on public.ad_image_jobs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 5. Grants — matching the ad_* tables' grant pattern.
-- ---------------------------------------------------------------------------
grant all on public.ad_image_projects to authenticated, service_role;
grant all on public.ad_image_concepts to authenticated, service_role;
grant all on public.ad_image_artifacts to authenticated, service_role;
grant all on public.ad_image_jobs to authenticated, service_role;
