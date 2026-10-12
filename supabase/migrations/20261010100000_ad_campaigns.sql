-- Ad campaigns, concepts, assets, exports, and render jobs
-- Steps 5-6 persistence for the advertising workflow

-- Campaigns
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 1),
  objective text not null,
  audience text not null,
  platform text not null,
  budget_usd numeric(10,2) not null check (budget_usd >= 0 and budget_usd <= 10000),
  message text not null,
  call_to_action text not null,
  status text not null default 'draft' check (status in ('draft', 'planning', 'approved', 'rendering', 'done', 'failed')),
  brief jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_campaigns_owner_idx on public.ad_campaigns (owner_id);
create index if not exists ad_campaigns_created_at_idx on public.ad_campaigns (created_at desc);

alter table public.ad_campaigns enable row level security;

create policy "ad_campaigns_owner_rw" on public.ad_campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Concepts
create table if not exists public.ad_concepts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  concept_number int not null check (concept_number >= 1 and concept_number <= 5),
  hook text not null,
  core_message text not null,
  script text not null,
  storyboard jsonb not null default '[]'::jsonb,
  shot_descriptions jsonb not null default '[]'::jsonb,
  veo_prompts jsonb not null default '{}'::jsonb,
  on_screen_text jsonb not null default '[]'::jsonb,
  cta text not null,
  rationale text not null,
  cost jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'rejected')),
  rejected_reasons jsonb default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_concepts_campaign_idx on public.ad_concepts (campaign_id);
create index if not exists ad_concepts_owner_idx on public.ad_concepts (owner_id);
create unique index if not exists ad_concepts_campaign_num_idx on public.ad_concepts (campaign_id, concept_number);

alter table public.ad_concepts enable row level security;
create policy "ad_concepts_owner_rw" on public.ad_concepts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Assets
create table if not exists public.ad_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  concept_id uuid references public.ad_concepts (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  asset_type text not null check (asset_type in ('narration', 'veo_shot', 'app_footage', 'logo', 'music', 'thumbnail')),
  shot_key text,
  storage_path text,
  public_url text,
  duration_seconds numeric(6,2),
  cost_usd numeric(10,2) default 0,
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_assets_campaign_idx on public.ad_assets (campaign_id);
create index if not exists ad_assets_concept_idx on public.ad_assets (concept_id);
create index if not exists ad_assets_owner_idx on public.ad_assets (owner_id);
create index if not exists ad_assets_type_idx on public.ad_assets (asset_type);

alter table public.ad_assets enable row level security;
create policy "ad_assets_owner_rw" on public.ad_assets
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Exports
create table if not exists public.ad_exports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  concept_id uuid references public.ad_concepts (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  preset_id text not null,
  storage_path text not null,
  public_url text,
  duration_seconds numeric(6,2) not null,
  width int not null,
  height int not null,
  bytes int,
  status text not null default 'rendering' check (status in ('rendering', 'done', 'failed')),
  render_error text,
  render_job_id text,
  cost_usd numeric(10,2) default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_exports_campaign_idx on public.ad_exports (campaign_id);
create index if not exists ad_exports_concept_idx on public.ad_exports (concept_id);
create index if not exists ad_exports_owner_idx on public.ad_exports (owner_id);
create index if not exists ad_exports_render_job_idx on public.ad_exports (render_job_id);

alter table public.ad_exports enable row level security;
create policy "ad_exports_owner_rw" on public.ad_exports
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Render jobs
create table if not exists public.ad_render_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  campaign_id uuid references public.ad_campaigns (id) on delete cascade,
  concept_id uuid references public.ad_concepts (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'preparing', 'rendering', 'done', 'failed')),
  progress int not null default 0 check (progress >= 0 and progress <= 100),
  preset_id text,
  render_request jsonb,
  result jsonb,
  error text,
  bytes int,
  duration_ms int,
  storage_path text,
  public_url text,
  meta jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_render_jobs_job_id_idx on public.ad_render_jobs (job_id);
create index if not exists ad_render_jobs_owner_idx on public.ad_render_jobs (owner_id);
create index if not exists ad_render_jobs_campaign_idx on public.ad_render_jobs (campaign_id);
create index if not exists ad_render_jobs_status_idx on public.ad_render_jobs (status);

alter table public.ad_render_jobs enable row level security;
create policy "ad_render_jobs_owner_rw" on public.ad_render_jobs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Grants
-- Storage bucket for rendered videos
insert into storage.buckets (id, name, public)
values ('renders', 'renders', true)
on conflict (id) do nothing;

-- Storage policies: allow authenticated users to read/write their own files in renders bucket
-- Renders are stored under renders/{userId}/{filename}
create policy if not exists "renders_select_own" on storage.objects
  for select using (
    bucket_id = 'renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy if not exists "renders_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy if not exists "renders_update_own" on storage.objects
  for update using (
    bucket_id = 'renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy if not exists "renders_delete_own" on storage.objects
  for delete using (
    bucket_id = 'renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Grants
grant all on public.ad_campaigns to authenticated, service_role;
grant all on public.ad_concepts to authenticated, service_role;
grant all on public.ad_assets to authenticated, service_role;
grant all on public.ad_exports to authenticated, service_role;
grant all on public.ad_render_jobs to authenticated, service_role;
