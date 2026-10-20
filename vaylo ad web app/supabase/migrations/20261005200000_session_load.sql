-- ============================================================================
-- session_load — one comparable load number per logged session
-- ----------------------------------------------------------------------------
-- Phase 1 recorded breaks. Phase 2 rebuilt the plan around them. Neither could
-- answer "how hard has this athlete actually been working lately?", because
-- there was nowhere to put the answer. `performance_logs` had duration and RPE
-- but no sport-specific reading of them; `workouts` had neither a sport column
-- nor a load column, which is the gap `src/lib/adaptivePlanning.ts` has been
-- documenting in its header since Phase 2 shipped.
--
-- This adds the storage, and nothing else. The formula lives in
-- `src/lib/sessionLoad.ts`, is pure, and is tested against the specification's
-- sport bands. The database's job here is only to hold the number, to keep it
-- non-negative and finite, and to make it cheap to ask "how much did this
-- athlete do in the last seven days".
--
-- Why `performance_logs` and `workouts` both:
--
--   • `performance_logs` is the athlete's own session log — the Performance Log
--     on the Training screen. It already records `sport`,
--     `perceived_exertion`, `distance_km` and `time_seconds`, which is every
--     input the model needs. This is where a calculated load belongs most.
--
--   • `workouts` receives sessions imported from Health Connect and from the
--     wearable OAuth edge function. Those sessions are real training and an
--     unplanned match landing there should count. `sport` is added so an
--     imported activity can be attributed to a sport rather than guessed at,
--     and `session_load` so it lands in the same units as everything else.
--
-- What is deliberately NOT here:
--
--   • No backfill. Existing rows keep `session_load IS NULL`, and every reader
--     treats null as "not calculated", never as zero — a null must not read as
--     "this athlete did nothing that day". Recomputing history on a guess about
--     what an athlete meant would put invented numbers into their record, and
--     the rule this whole feature rests on is that history is never rewritten.
--
--   • No triggers. The value is written by the same code that writes the row
--     it belongs to, in `src/lib/sessionLoad.ts` callers, so the number and the
--     session it describes are always written together or not at all. A trigger
--     would have to duplicate the formula in a second language and would then
--     silently disagree with it.
--
--   • No changes to `training_loads`. That table is a per-day roll-up of the
--     old RPE flow, is no longer written by the app, and mixing a second load
--     definition into it would create two numbers with one name.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- performance_logs — the athlete's own log
-- ---------------------------------------------------------------------------

alter table public.performance_logs
  add column if not exists session_load numeric;

comment on column public.performance_logs.session_load is
  'Session load computed by src/lib/sessionLoad.ts from sport, duration and intensity. Null means not yet calculated — never treat null as zero.';

-- One bounded CHECK rather than a domain type: the load model will grow bands
-- over time, and the invariant that matters is only that it is a real,
-- non-negative number. An arbitrary ceiling would be a fake limit that stops
-- being enforced the day a legitimate value exceeds it.
alter table public.performance_logs
  drop constraint if exists performance_logs_session_load_bounds;

alter table public.performance_logs
  add constraint performance_logs_session_load_bounds
  check (session_load is null or (session_load >= 0 and session_load <= 100000));

-- The only query the adaptation layer actually makes: this athlete's load over
-- a date window. Existing index is on created_at, which does not serve it.
create index if not exists performance_logs_user_session_load_idx
  on public.performance_logs (user_id, log_date desc)
  where session_load is not null;

-- ---------------------------------------------------------------------------
-- workouts — imported and wearable sessions
-- ---------------------------------------------------------------------------

alter table public.workouts
  add column if not exists sport text;

alter table public.workouts
  add column if not exists session_load numeric;

comment on column public.workouts.sport is
  'Sport attributed to this session (free text, normalised by src/lib/sessionLoad.ts). Null means unclassified, which is reported as uncertainty rather than guessed.';

comment on column public.workouts.session_load is
  'Session load computed by src/lib/sessionLoad.ts. Null means not yet calculated — never treat null as zero.';

alter table public.workouts
  drop constraint if exists workouts_session_load_bounds;

alter table public.workouts
  add constraint workouts_session_load_bounds
  check (session_load is null or (session_load >= 0 and session_load <= 100000));

-- The Phase 2 break-crediting read asks for a user's completed sessions in a
-- date window and now needs their sport. This serves that directly.
create index if not exists workouts_user_completed_session_load_idx
  on public.workouts (user_id, completed_at desc)
  where completed = true;