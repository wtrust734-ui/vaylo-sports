-- Pipeline dashboard: tracks the ad workflow from brain -> prep -> edit -> qc -> post -> done
-- Each stage has a persistent job record and a chat history, so users can watch and control it.

-- Pipeline jobs
create table if not exists public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid,
  name text not null,
  stage text not null check (stage in ('brain', 'prep', 'edit', 'qc', 'post', 'done')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'stopped')),
  progress int not null default 0 check (progress >= 0 and progress <= 100),
  message text not null default '',
  step int not null default 1,
  details jsonb not null default '{}'::jsonb,
  human_input text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_jobs_owner_idx on public.pipeline_jobs (owner_id);
create index if not exists pipeline_jobs_campaign_idx on public.pipeline_jobs (campaign_id);
create index if not exists pipeline_jobs_stage_idx on public.pipeline_jobs (stage);
create index if not exists pipeline_jobs_status_idx on public.pipeline_jobs (status);

alter table public.pipeline_jobs enable row level security;

create policy "pipeline_jobs_owner_rw" on public.pipeline_jobs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Pipeline chat history per stage
create table if not exists public.pipeline_chat (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  stage text not null check (stage in ('brain', 'prep', 'edit', 'qc', 'post', 'done')),
  role text not null check (role in ('system', 'user', 'assistant')),
  text text not null,
  timestamp timestamptz not null default now()
);

create index if not exists pipeline_chat_owner_idx on public.pipeline_chat (owner_id);
create index if not exists pipeline_chat_stage_idx on public.pipeline_chat (stage, timestamp desc);

alter table public.pipeline_chat enable row level security;

create policy "pipeline_chat_owner_rw" on public.pipeline_chat
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Grants
grant all on public.pipeline_jobs to authenticated, service_role;
grant all on public.pipeline_chat to authenticated, service_role;
