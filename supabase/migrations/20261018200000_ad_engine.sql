-- Vaylo Sports daily advertising engine: calendar + durable job queue.
-- Every calendar date 18 Oct 2026 – 30 Jun 2027 has an individual record.
-- Jobs are one-per-(asset,kind) by unique index — retries cannot create duplicates.
-- pg_cron drives the runner; nothing depends on a browser staying open.
-- Re-runnable: create-if-not-exists, drop-then-recreate policies.

-- ---------------------------------------------------------------------------
-- 1. Calendar — one row per campaign date, per the master operating spec
-- ---------------------------------------------------------------------------
create table if not exists public.ad_engine_calendar (
  day date primary key,
  dow text not null check (dow in ('mon','tue','wed','thu','fri','sat','sun')),
  theme text not null,
  asset_name text not null,
  asset_format text not null check (asset_format in ('video','image','carousel','story','copy','report')),
  sport text not null,
  audience text not null,
  objective text not null,
  concept text not null,
  produce_start text not null,
  produce_deadline text not null,
  publish_time text,
  caption text,
  headline text,
  cta text,
  qc_notes text,
  status text not null default 'planned'
    check (status in ('planned','queued','generating','completed','approved','scheduled','published','failed','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Job queue — the thing the runner picks up. Unique (calendar_day, asset_kind,
--    variant) means "queued AND failed" rows for the same work are amended, never
--    duplicated: on conflict we resurrect the queued attempt and bump attempts.
-- ---------------------------------------------------------------------------
create table if not exists public.ad_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  calendar_day date not null references public.ad_engine_calendar(day) on delete cascade,
  asset_name text not null,
  asset_kind text not null check (asset_kind in
    ('video','image','variations','voiceover','compilation','report','publish','manus_task')),
  variant text not null default 'primary' check (char_length(variant) <= 40),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','skipped')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),           -- next eligible run time
  lease_until timestamptz,                                -- claimed by the runner
  payload jsonb not null default '{}'::jsonb,             -- brief given to the executor
  result jsonb,                                           -- executor output (paths, ids, verified flags)
  error text,
  cost_usd numeric(10,2) not null default 0 check (cost_usd >= 0),
  claimed_by text,                                        -- runner instance marker
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_day, asset_kind, variant)
);
create index if not exists ad_engine_jobs_due_idx on public.ad_engine_jobs (status, run_after);

-- Day spawn queue: which days the runner must expand into jobs.
-- 'spawn' rows are created by the daily tick; spawn_enqueue() materialises them.
create table if not exists public.ad_engine_spawns (
  id uuid primary key default gen_random_uuid(),
  calendar_day date not null unique references public.ad_engine_calendar(day) on delete cascade,
  state text not null default 'pending' check (state in ('pending','spawned','skipped')),
  spawned_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Campaign budget ledger — the £2,050 ceiling recorded separately from production
-- ---------------------------------------------------------------------------
create table if not exists public.ad_engine_budget (
  campaign text primary key default 'vaylo-sports-2026',
  ceiling_gbp numeric(10,2) not null default 2050 check (ceiling_gbp > 0),
  spent_media_gbp numeric(10,2) not null default 0 check (spent_media_gbp >= 0),
  spent_production_gbp numeric(10,2) not null default 0 check (spent_production_gbp >= 0),
  currency text not null default 'GBP',
  note text,
  updated_at timestamptz not null default now()
);
insert into public.ad_engine_budget (campaign, note)
values ('vaylo-sports-2026', 'Includes contingency £100. Paid media tracked separately from production APIs per spec Part 7.')
on conflict (campaign) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS — operator-readable; the engine row comes from the runner (service role)
-- ---------------------------------------------------------------------------
alter table public.ad_engine_calendar enable row level security;
alter table public.ad_engine_jobs enable row level security;
alter table public.ad_engine_spawns enable row level security;
alter table public.ad_engine_budget enable row level security;

drop policy if exists "ad_engine_calendar_read" on public.ad_engine_calendar;
create policy "ad_engine_calendar_read" on public.ad_engine_calendar
  for select using (auth.uid() is not null);
drop policy if exists "ad_engine_jobs_read" on public.ad_engine_jobs;
create policy "ad_engine_jobs_read" on public.ad_engine_jobs
  for select using (auth.uid() is not null);
drop policy if exists "ad_engine_spawns_read" on public.ad_engine_spawns;
create policy "ad_engine_spawns_read" on public.ad_engine_spawns
  for select using (auth.uid() is not null);
drop policy if exists "ad_engine_budget_read" on public.ad_engine_budget;
create policy "ad_engine_budget_read" on public.ad_engine_budget
  for select using (auth.uid() is not null);

grant select on public.ad_engine_calendar, public.ad_engine_jobs,
  public.ad_engine_spawns, public.ad_engine_budget to authenticated;
grant all on public.ad_engine_calendar, public.ad_engine_jobs,
  public.ad_engine_spawns, public.ad_engine_budget to service_role;

-- ---------------------------------------------------------------------------
-- 5. cron schedule — daily tick 00:55 Europe/London via UTC cron (BST: 23:55 UTC
--    previous day / GMT: 00:55 UTC). The runner itself runs hourly and catches
--    up anything with a due job.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. Production-spend ledger — called by ad-engine-tick after real spend.
--    Keeps 'spent_production_gbp' under the recorded ceiling; refuses to push
--    the campaign over £2,050 no matter who calls (Part 9.9).
-- ---------------------------------------------------------------------------
create or replace function public.ad_engine_note_spend(p_amount_gbp numeric)
returns numeric language plpgsql security definer as $$
declare v_now numeric;
begin
  if p_amount_gbp is null or p_amount_gbp <= 0 then return 0; end if;
  update public.ad_engine_budget
    set spent_production_gbp = least(ceiling_gbp, spent_production_gbp + p_amount_gbp),
        updated_at = now()
    where campaign = 'vaylo-sports-2026'
    returning spent_production_gbp into v_now;
  return v_now;
end; $$;
