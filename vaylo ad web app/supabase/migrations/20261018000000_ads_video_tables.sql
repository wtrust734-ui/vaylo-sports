-- Ads Studio video tables (Prompt 5)
-- Backs the ads-video edge function: concepts, individual Veo shots, and
-- render jobs dispatched to the render worker. Owner-scoped with RLS, the same
-- pattern the image tables (20261017240000_ads_image_ads.sql) use.

create table if not exists public.ad_video_concepts (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  concept_prompt text,
  model text,
  duration_seconds numeric(6,2) not null default 8 check (duration_seconds > 0),
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16', '16:9')),
  hook text,
  core_message text,
  script text,
  script_captions jsonb not null default '[]'::jsonb,
  storyboard jsonb not null default '[]'::jsonb,
  on_screen_text jsonb not null default '[]'::jsonb,
  call_to_action text,
  status text not null default 'draft' check (status in ('draft', 'generating', 'ready', 'failed')),
  cost_usd numeric(10,2) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_video_concepts_owner_idx on public.ad_video_concepts (owner_id, created_at desc);

alter table public.ad_video_concepts enable row level security;
create policy "ad_video_concepts_owner_rw" on public.ad_video_concepts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- One record per Veo generation attempt, so a failed shot is retryable and an
-- in-flight operation survives a page refresh.
create table if not exists public.ad_video_shots (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  concept_id uuid references public.ad_video_concepts (id) on delete cascade,
  shot_number int not null default 1 check (shot_number >= 1),
  scene_json jsonb not null default '{}'::jsonb,
  veo_prompt text,
  operation_id text not null,
  state text not null default 'running' check (state in ('running', 'done', 'failed')),
  video_uri text,
  error text,
  model text not null,
  duration_seconds numeric(6,2) not null default 8 check (duration_seconds > 0),
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16', '16:9')),
  resolution text not null default '1080p' check (resolution in ('720p', '1080p')),
  cost_usd numeric(10,2) not null default 0 check (cost_usd >= 0),
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_video_shots_owner_idx on public.ad_video_shots (owner_id);
create index if not exists ad_video_shots_concept_idx on public.ad_video_shots (concept_id);
create index if not exists ad_video_shots_operation_idx on public.ad_video_shots (operation_id);

alter table public.ad_video_shots enable row level security;
create policy "ad_video_shots_owner_rw" on public.ad_video_shots
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Render jobs handed to the render worker.
create table if not exists public.ad_video_render_jobs (
  id uuid primary key,
  job_id text not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  concept_id uuid references public.ad_video_concepts (id) on delete cascade,
  preset_id text,
  render_request jsonb,
  status text not null default 'queued' check (status in ('queued', 'preparing', 'rendering', 'done', 'failed')),
  progress int not null default 0 check (progress >= 0 and progress <= 100),
  error text,
  result jsonb,
  storage_path text,
  public_url text,
  cost_usd numeric(10,2) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_video_render_jobs_owner_idx on public.ad_video_render_jobs (owner_id);
create index if not exists ad_video_render_jobs_concept_idx on public.ad_video_render_jobs (concept_id);

alter table public.ad_video_render_jobs enable row level security;
create policy "ad_video_render_jobs_owner_rw" on public.ad_video_render_jobs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

grant all on public.ad_video_concepts to authenticated, service_role;
grant all on public.ad_video_shots to authenticated, service_role;
grant all on public.ad_video_render_jobs to authenticated, service_role;
