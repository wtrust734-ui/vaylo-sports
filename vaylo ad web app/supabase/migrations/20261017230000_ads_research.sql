-- Ads Studio competitor research engine: competitors, projects, findings,
-- analyses, opportunities. All owner-scoped RLS. Re-runnable.
-- Complements ad_* migrations; chat/library tables already exist.

-- ---------------------------------------------------------------------------
-- 1. Competitors — the configurable research roster
-- ---------------------------------------------------------------------------
create table if not exists public.ad_competitors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  website text,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.ad_competitors enable row level security;
drop policy if exists "ad_competitors_owner_rw" on public.ad_competitors;
create policy "ad_competitors_owner_rw" on public.ad_competitors
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 2. Research projects
-- ---------------------------------------------------------------------------
create table if not exists public.ad_research_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'partial')),
  scope jsonb not null default '{}'::jsonb,
  -- pipeline bookkeeping — names/errors logged here only, no values above caps
  pipeline_log jsonb not null default '[]'::jsonb,
  topic text default '',
  campaign_id uuid references public.ad_campaigns (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_research_projects_owner_idx
  on public.ad_research_projects (owner_id, updated_at desc);

alter table public.ad_research_projects enable row level security;
drop policy if exists "ad_research_projects_owner_rw" on public.ad_research_projects;
create policy "ad_research_projects_owner_rw" on public.ad_research_projects
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 3. Findings — one retrievable item (ad record, organic post, or page)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_research_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ad_research_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  competitor_id uuid references public.ad_competitors (id) on delete set null,
  -- 'ad' = advertising-library record or paid creative; 'organic' = brand's
  -- ordinary published content; 'page' = an official/public page.
  kind text not null check (kind in ('ad', 'organic', 'page')),
  source_type text not null
    check (source_type in
      ('meta_library', 'tiktok_library', 'google_transparency',
       'official_page', 'press', 'social', 'manual')),
  source_url text not null,
  title text not null default '',
  excerpt text not null default '',
  -- verbatim captured fields; empty when the source does not expose them
  captured jsonb not null default '{}'::jsonb,
  media_kind text not null default 'none' check (media_kind in ('none', 'image', 'video', 'unknown')),
  media_ref text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  content_hash text,
  evidence_grade text not null default 'source' check (evidence_grade in ('source', 'inferred', 'unavailable')),
  created_at timestamptz not null default now()
);
create index if not exists ad_research_findings_project_idx
  on public.ad_research_findings (project_id, retrieved_at desc);
create index if not exists ad_research_findings_url_idx
  on public.ad_research_findings (project_id, source_url);

alter table public.ad_research_findings enable row level security;
drop policy if exists "ad_research_findings_owner_rw" on public.ad_research_findings;
create policy "ad_research_findings_owner_rw" on public.ad_research_findings
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 4. Analyses — one per finding; mode states what was actually inspected
-- ---------------------------------------------------------------------------
create table if not exists public.ad_research_analyses (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null unique references public.ad_research_findings (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- mode is honest: what the analysis actually saw
  mode text not null check (mode in ('text', 'text+image', 'incomplete')),
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ad_research_analyses_owner_idx on public.ad_research_analyses (owner_id);

alter table public.ad_research_analyses enable row level security;
drop policy if exists "ad_research_analyses_owner_rw" on public.ad_research_analyses;
create policy "ad_research_analyses_owner_rw" on public.ad_research_analyses
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 5. Opportunities — the ten-field recommendation blocks (citations validated
--    server-side before insert)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_research_opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ad_research_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ad_research_opportunities_project_idx
  on public.ad_research_opportunities (project_id, created_at);

alter table public.ad_research_opportunities enable row level security;
drop policy if exists "ad_research_opportunities_owner_rw" on public.ad_research_opportunities;
create policy "ad_research_opportunities_owner_rw" on public.ad_research_opportunities
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 6. Seed the default roster for fresh owners (idempotent, per-user)
-- ---------------------------------------------------------------------------
create or replace function public.ads_seed_competitors() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ad_competitors (owner_id, name, website, notes) values
    (new.id, 'Strava', 'https://www.strava.com',
     'Leader in activity tracking/community. Verified acquisition of Runna (2025).'),
    (new.id, 'Nike Run Club', 'https://www.nike.com/nrc-app',
     'Guided running + coaching content from a sports-goods giant.'),
    (new.id, 'Runna', 'https://www.runna.com',
     'Personalised running training plans; strongest overlap with Vaylo coaching.');
  return new;
end;
$$;

drop trigger if exists ads_seed_competitors_trg on auth.users;
create trigger ads_seed_competitors_trg
  after insert on auth.users
  for each row execute function public.ads_seed_competitors();

grant all on public.ad_competitors to authenticated, service_role;
grant all on public.ad_research_projects to authenticated, service_role;
grant all on public.ad_research_findings to authenticated, service_role;
grant all on public.ad_research_analyses to authenticated, service_role;
grant all on public.ad_research_opportunities to authenticated, service_role;
grant execute on function public.ads_seed_competitors() to service_role, authenticated;
