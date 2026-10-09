-- ============================================================================
-- LIFE EVENTS & AVAILABILITY  (Adaptive Athlete Intelligence — Phase 1)
-- ----------------------------------------------------------------------------
-- What this adds and, more importantly, what it does NOT touch.
--
-- The athlete's life is not a training input the app gets to ignore. Exams,
-- travel, illness and a deliberate break are all part of a season, and the
-- honest product answer is to record them rather than to pretend the planned
-- session still happened. This migration is the storage half of that.
--
--   • life_events  — a dated, typed period the athlete is unavailable or only
--                    partly available. Deliberately says nothing about WHY
--                    beyond the type the athlete chose: `personal_break` and
--                    `private` carry no note, and no note is ever required.
--
--   • plan_events  — extended from four statuses to eight, plus the link back
--                    to the life event that caused the change and the metadata
--                    a later re-planning phase will need.
--
-- What is deliberately NOT changed:
--
--   • `workouts` is untouched. A completed session is a historical record of
--     something the athlete actually did, and no life event may rewrite it.
--     Training history is append-only with respect to availability.
--   • Nothing here moves a session to a new date. Marking a session lost and
--     deciding what to do about it are separate jobs: this phase only records
--     the loss accurately, so a later phase can re-plan against a truthful
--     picture instead of a silently padded one.
--   • `training_plans.plan_data` (the week/session JSON the Training screen
--     renders) keeps its existing shape. New optional keys are added by the
--     client, never by rewriting stored weeks.
--
-- Column naming: every athlete-owned table in this schema keys on `user_id`
-- with a `auth.uid() = user_id` RLS policy, and `_shared/userTables.ts` drives
-- both account deletion and the Article 20 export off that convention. The
-- spec's "athlete_id" is that same key under a product name, so it stays
-- `user_id` — one ownership convention, one deletion path, no second fence.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. life_events — a dated unavailability period
-- ---------------------------------------------------------------------------
create table if not exists public.life_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  start_date date not null,
  end_date date not null,

  -- Holiday, travel, exams, competition, illness, injury, wellbeing, busy,
  -- family, other, private. The list is closed so a typo cannot create a
  -- category the UI has no word for; adding a type is a migration, on purpose.
  event_type text not null,

  -- Expected activity during the period. 'unknown' is a real answer and must
  -- not be defaulted to 'normal' — the app should never assume an athlete was
  -- training just because they did not say.
  activity_level text not null default 'unknown',

  -- Whether training is wanted: yes / no / optional.
  allow_training text not null default 'optional',

  -- Optional, and genuinely optional. A blank note is the normal case for
  -- `personal_break` and `private`, and nothing in the app may require one.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint life_events_type_allowed check (event_type in (
    'holiday', 'travel', 'exams', 'competition', 'illness', 'injury',
    'wellbeing', 'busy', 'family', 'other', 'private'
  )),
  constraint life_events_activity_allowed check (activity_level in (
    'none', 'light', 'normal', 'unknown'
  )),
  constraint life_events_allow_training_allowed check (allow_training in (
    'yes', 'no', 'optional'
  )),
  -- An end before its start is a data-entry mistake, not a zero-length break.
  constraint life_events_date_order check (end_date >= start_date),
  -- Two years. Bounded for the same reason every other bounded column in this
  -- schema is: an unbounded span silently makes every "does this overlap?"
  -- query in the app match a period the athlete never intended, and a stray
  -- keystroke on a year field is the usual cause.
  constraint life_events_span_allowed check (end_date <= start_date + 730),
  -- A note is a note. The UI never asks for an explanation and this cap is
  -- generous for one; it exists so the column cannot become an essay field
  -- holding information nobody asked the athlete to hand over.
  constraint life_events_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists idx_life_events_user_start
  on public.life_events (user_id, start_date desc);
-- The overlap query ("which events touch this date range?") filters on the end
-- date too, and a range predicate cannot use the start_date index alone.
create index if not exists idx_life_events_user_end
  on public.life_events (user_id, end_date);

alter table public.life_events enable row level security;

drop policy if exists "life_events self" on public.life_events;
create policy "life_events self" on public.life_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_life_events_updated on public.life_events;
create trigger trg_life_events_updated
  before update on public.life_events
  for each row execute function public.update_updated_at_column();

-- Writes go straight from the device over the anon+JWT REST path, exactly as
-- every other athlete-owned table does (see 20260925100000_fix_health_grants).
-- The RLS policy above is the authorization fence; these grants only make the
-- path reachable. Without them a break created offline would sync and be
-- refused, which is the failure this migration exists to avoid.
grant select, insert, update, delete on public.life_events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. plan_events — an adaptive session status set
-- ---------------------------------------------------------------------------
-- The original set (planned / completed / skipped / rescheduled) had no way to
-- say "this session did not happen, and that was not the athlete's fault".
-- Everything that was not completed therefore read as skipped, which is how a
-- two-week holiday turned into a wall of failure in the weekly summary.
--
--   planned                      the default; nothing has happened yet
--   completed                    it happened
--   modified                     it happened, changed (shorter, swapped)
--   rescheduled                  it moved to another date
--   skipped                      the athlete chose not to, with no life event
--   cancelled_due_to_availability   a life event made it impossible
--   replaced                     a different session took its place
--   rest                         a rest day, which is programming, not a miss
alter table public.plan_events
  drop constraint if exists plan_events_status_allowed;
alter table public.plan_events
  add constraint plan_events_status_allowed
  check (status in (
    'planned', 'completed', 'modified', 'rescheduled', 'skipped',
    'cancelled_due_to_availability', 'replaced', 'rest'
  ));

-- Which life event caused this change. ON DELETE SET NULL rather than CASCADE:
-- deleting a break must never delete the training record that referenced it —
-- the session still happened, or still did not, and its status is a fact about
-- the schedule independent of the event row that produced it.
alter table public.plan_events
  add column if not exists life_event_id uuid
    references public.life_events(id) on delete set null;

-- Where the session was originally planned, when it is not where it now sits.
-- Kept as its own column rather than inferred, because "moved from the 3rd"
-- is not recoverable from `scheduled_date` once it has been updated.
alter table public.plan_events
  add column if not exists original_scheduled_date date;

-- Key-workout flag. A later phase re-plans around what was lost and needs to
-- know which losses actually matter; this is that flag, not a second one.
alter table public.plan_events
  add column if not exists important boolean not null default false;

-- Short machine-readable reason, for the "What changed?" explanation.
alter table public.plan_events
  add column if not exists adjusted_reason text;

-- Integrity: a session may only be attributed to a life event when the status
-- actually says a life event changed it. Without this a completed session
-- could be tagged as cancelled-due-to-availability and would then vanish from
-- the denominator of every completion calculation.
alter table public.plan_events
  drop constraint if exists plan_events_life_event_status;
alter table public.plan_events
  add constraint plan_events_life_event_status
  check (
    life_event_id is null
    or status in ('modified', 'rescheduled', 'cancelled_due_to_availability', 'replaced')
  );

-- A moved session must record where it came from, or the move is untraceable.
alter table public.plan_events
  drop constraint if exists plan_events_rescheduled_origin;
alter table public.plan_events
  add constraint plan_events_rescheduled_origin
  check (status <> 'rescheduled' or original_scheduled_date is not null);

create index if not exists idx_plan_events_life_event
  on public.plan_events (life_event_id);
-- The calendar reads a date window per athlete, which the existing
-- (user_id, scheduled_date) index already serves.

notify pgrst, 'reload schema';
