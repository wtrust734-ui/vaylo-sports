-- ===========================================================================
-- Phase 5 — historical training import: provenance and import runs
-- ---------------------------------------------------------------------------
-- The app could already pull workouts from Health Connect and from cloud
-- wearables (strava/fitbit/oura) into `health_workouts`. That table is a
-- staging area: only the Health screen ever read it. Nothing joined it to
-- `workouts`, which is the table the rest of Vaylo Sports actually reads —
-- Phase 2's return-from-break context, Phase 3's recovery load, Phase 4's
-- roadmap, WeeklySummary, Achievements and the feed all query `workouts`.
--
-- So an imported run counted for nothing. This migration supplies the two
-- things the bridge needs to fix that honestly:
--
--   1. PROVENANCE on `workouts` — where a row came from, which upstream record
--      it is, and when we imported it. `external_id` + a partial unique index
--      makes re-import idempotent at the database rather than in the client, so
--      a half-finished import cannot duplicate a session however many times the
--      athlete retries.
--
--   2. IMPORT RUNS — one row per import the athlete starts, holding the window
--      they chose, how it ended, and the analysis they were shown. The athlete
--      can close the app mid-import; the outcome still describes what happened.
--
-- Deliberately NOT backfilled: `source` stays null on every pre-existing row.
-- Null means "not imported", which is true of all of them, and it keeps the
-- distinction the spec asks for (imported vs manually entered) exact. The same
-- reasoning as session_load in 20261005200000 — null is not zero.
--
-- Imported rows are ordinary workouts from here on: same table, same load
-- columns, same readers. There is no second session table and no separate
-- imported-data path through the app.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance on workouts
-- ---------------------------------------------------------------------------

alter table public.workouts
  add column if not exists source text,
  add column if not exists external_id text,
  add column if not exists imported_at timestamptz;

-- The provider list is `health_workouts.source`'s list (the wearable catalog)
-- plus 'manual'. Kept as a literal so a typo in a client mapper fails the
-- insert instead of writing a source nothing can ever read back.
alter table public.workouts drop constraint if exists workouts_source_allowed;
alter table public.workouts add constraint workouts_source_allowed check (
  source is null or source in (
    'manual',
    'health_connect', 'healthkit',
    'garmin', 'fitbit', 'polar', 'coros', 'whoop', 'oura',
    'samsung_health', 'google_fit', 'suunto', 'withings', 'strava', 'huawei'
  )
);

-- `imported_at` is meaningless without a source, and a source of 'manual' is
-- by definition not an import. Catching this here means the UI's "Imported
-- from Strava" badge can trust the pair instead of defending against it.
alter table public.workouts drop constraint if exists workouts_import_shape;
alter table public.workouts add constraint workouts_import_shape check (
  (imported_at is null or source is not null)
  and (source is null or source <> 'manual' or external_id is null)
);

-- Idempotency lives here, not in the client. Re-importing an activity that
-- already landed cannot create a second row: the upsert's ON CONFLICT target is
-- this index.
--
-- NOT partial, deliberately, and it does not need to be. PostgREST emits
-- `ON CONFLICT (user_id, source, external_id) DO UPDATE`, and Postgres refuses
-- to use a partial index for a conflict target unless the statement repeats the
-- index predicate — which PostgREST never does, so a `where external_id is not
-- null` here would fail every import with 42P10. The predicate bought nothing
-- either: a unique index treats NULLs as distinct, so any number of manually
-- logged rows (source null, external_id null) coexist quite happily.
create unique index if not exists workouts_user_source_external_idx
  on public.workouts (user_id, source, external_id);

-- "Show me what was imported" — the one list query the import screens run.
create index if not exists workouts_user_imported_idx
  on public.workouts (user_id, imported_at desc)
  where imported_at is not null;

comment on column public.workouts.source is
  'Null = not imported. ''manual'' = the athlete typed it. Otherwise the provider id from the wearable catalog.';
comment on column public.workouts.external_id is
  'The provider''s own record id. With (user_id, source) it is unique, which is what makes re-import idempotent.';
comment on column public.workouts.imported_at is
  'When Vaylo Sports imported this row. Distinct from started_at/completed_at, which are when the session happened.';

-- ---------------------------------------------------------------------------
-- 2. Import runs
-- ---------------------------------------------------------------------------

create table if not exists public.workout_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  -- Null window_start means "everything the provider will give us".
  window_start timestamptz,
  window_end timestamptz not null default now(),
  -- queued = waiting for a connection (started offline); running = fetching;
  -- completed = every batch landed; partial = some batches landed, some did
  -- not; failed = nothing usable came back. A partial import is a real outcome
  -- and says so rather than rounding itself up to completed.
  status text not null default 'queued',
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  note text,
  -- The "Your Vaylo Starting Analysis" the athlete was shown, stored so the
  -- parent view and a later offline session read the same words. This is a
  -- deliberate snapshot: an analysis of a starting point is not supposed to
  -- silently change under the athlete later.
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint workout_imports_status_allowed check (
    status in ('queued', 'running', 'completed', 'partial', 'failed')
  ),
  constraint workout_imports_source_allowed check (
    source in (
      'health_connect', 'healthkit',
      'garmin', 'fitbit', 'polar', 'coros', 'whoop', 'oura',
      'samsung_health', 'google_fit', 'suunto', 'withings', 'strava', 'huawei'
    )
  ),
  constraint workout_imports_counts_non_negative check (
    imported_count >= 0 and updated_count >= 0 and skipped_count >= 0
  ),
  constraint workout_imports_window_order check (
    window_start is null or window_end >= window_start
  )
);

create index if not exists workout_imports_user_created_idx
  on public.workout_imports (user_id, created_at desc);

-- One open run per source at a time: a queued import that the athlete edits and
-- re-queues must reuse its row rather than pile up duplicates of the same job.
create unique index if not exists workout_imports_one_open_per_source_idx
  on public.workout_imports (user_id, source)
  where status in ('queued', 'running');

alter table public.workout_imports enable row level security;

drop policy if exists "Users view own workout imports" on public.workout_imports;
create policy "Users view own workout imports"
  on public.workout_imports for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own workout imports" on public.workout_imports;
create policy "Users insert own workout imports"
  on public.workout_imports for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own workout imports" on public.workout_imports;
create policy "Users update own workout imports"
  on public.workout_imports for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own workout imports" on public.workout_imports;
create policy "Users delete own workout imports"
  on public.workout_imports for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.workout_imports to authenticated;

-- Same trigger convention as the rest of the schema (Phase 1's life_events).
drop trigger if exists workout_imports_updated_at on public.workout_imports;
create trigger workout_imports_updated_at
  before update on public.workout_imports
  for each row execute function public.update_updated_at_column();
