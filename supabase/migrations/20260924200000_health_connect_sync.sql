-- ============================================================================
-- Health Connect sync (Phase 1 foundation)
-- ----------------------------------------------------------------------------
-- What Vaylo stores after a native Health Connect sync:
--   • health_sync_state       — per-athlete sync bookkeeping (last sync time,
--                               last incremental cursor, connection metadata).
--   • health_workouts         — normalized workout sessions, deduplicated on
--                               (user_id, source, source_record_id).
--   • health_samples          — metric samples that belong to a workout window
--                               (heart rate, steps, calories) or stand alone
--                               (daily steps, sleep sessions).
--
-- Design rules:
--   • Stable identifiers from Health Connect (record ids) prevent duplicates.
--   • RLS: every table is strictly self-service (select/insert/update/delete
--     via auth.uid()). One athlete can never read another athlete's data.
--   • No raw payloads: normalized columns only. Missing metrics stay NULL —
--     Vaylo never fabricates data.
--   • Cascade on auth.users so account deletion (delete-account edge function
--     calls auth.admin.deleteUser) removes all health data automatically.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Sync state (one row per athlete)
-- ---------------------------------------------------------------------------
create table if not exists public.health_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  connected boolean not null default false,
  last_sync_at timestamptz,
  -- Incremental cursor: newest Health Connect record timestamp already synced.
  -- The next sync reads records changed after this point.
  last_incremental_cursor timestamptz,
  synced_workout_count integer not null default 0,
  -- Native side metadata (SDK availability, app version). No health data.
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.health_sync_state enable row level security;

drop policy if exists "health_sync_state self" on public.health_sync_state;
create policy "health_sync_state self" on public.health_sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Workouts (normalized; one row per Health Connect ExerciseSession record)
-- ---------------------------------------------------------------------------
create table if not exists public.health_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'health_connect',
  -- Health Connect record metadata (ExerciseSessionRecord metadata.id)
  source_record_id text not null,
  -- True when Health Connect reports the record as deleted/revoked upstream.
  deleted boolean not null default false,

  title text,
  activity_type text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  duration_seconds integer,
  distance_meters numeric,
  active_calories numeric,

  -- Aggregates; NULL when Health Connect has no data for them.
  heart_rate_avg numeric,
  heart_rate_max numeric,
  heart_rate_min numeric,
  steps integer,

  created_at timestamptz not null default now(),

  constraint health_workouts_time_order check (end_time > start_time),
  -- Duplicate prevention: the same upstream record can only exist once.
  constraint health_workouts_source_unique unique (user_id, source, source_record_id)
);

create index if not exists health_workouts_user_start_idx
  on public.health_workouts (user_id, start_time desc);

alter table public.health_workouts enable row level security;

drop policy if exists "health_workouts self" on public.health_workouts;
create policy "health_workouts self" on public.health_workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Samples (heart-rate series, steps, calories, sleep)
-- ---------------------------------------------------------------------------
create table if not exists public.health_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'health_connect',
  source_record_id text not null,
  deleted boolean not null default false,

  -- 'heart_rate' | 'steps' | 'active_calories' | 'sleep' (extensible)
  metric text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,

  value numeric,
  unit text not null,

  -- Sleep stages live here as normalized text: awake | rem | deep | light | out_of_bed
  stage text,
  workout_id uuid references public.health_workouts(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint health_samples_time_order check (end_time > start_time),
  constraint health_samples_source_unique unique (user_id, source, source_record_id)
);

create index if not exists health_samples_user_metric_time_idx
  on public.health_samples (user_id, metric, start_time desc);

alter table public.health_samples enable row level security;

drop policy if exists "health_samples self" on public.health_samples;
create policy "health_samples self" on public.health_samples
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.health_sync_state to authenticated;
grant select on public.health_workouts to authenticated;
grant select on public.health_samples to authenticated;
