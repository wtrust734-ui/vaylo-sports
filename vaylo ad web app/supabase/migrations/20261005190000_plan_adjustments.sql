-- ============================================================================
-- PLAN ADJUSTMENTS  (Adaptive Athlete Intelligence — Phase 2)
-- ----------------------------------------------------------------------------
-- What this adds, and the one decision behind it.
--
-- Phase 1 kept the plan and the record of what happened to it separate:
-- `training_plans.plan_data` is the programming, `plan_events` is the adaptive
-- record of what a life event did to a session. Phase 2 changes the *content*
-- of the plan — a week after a break is rebuilt lighter, and its least
-- important sessions are dropped — and there is a rule that decides where that
-- belongs:
--
--   Content the athlete can edit is stored content.
--
-- The Training screen edits session titles and durations in `plan_data`, so a
-- content change that lived anywhere else would disagree with the editing UI:
-- the athlete would set a session to 60 minutes, see 42, and be told nothing.
-- The rebuilt values are therefore written into `plan_data`, exactly where the
-- existing per-week mutations already write, and this column holds the
-- *record* of that write: which break caused it, what the multipliers were,
-- how it reads to the athlete, and a verbatim copy of the sessions it replaced
-- so "Undo" is exact rather than approximate.
--
-- One adjustment record per break that has been applied, oldest first. The
-- array is the plan's own metadata, so it travels with the plan and needs no
-- second table, no second RLS policy and no second deletion path.
--
-- What is deliberately NOT changed:
--
--   • `plan_data` keeps its shape: an array of weeks. Three separate screens
--     narrow it with `Array.isArray`, so a wrapper object here would break them
--     silently. Two optional keys are added inside a week and inside a session
--     (`returnFromBreak`), which every existing reader ignores.
--   • Nothing in this file rewrites a *past* week, or a session that is
--     completed or modified. That rule is enforced in the client's planner and
--     asserted in `src/lib/adaptivePlan.test.ts`, because it is a property of
--     the logic rather than of the column.
--   • Bounded on purpose: a rebuild never reaches further than four weeks back,
--     so the reversal copy stays small and the column cannot grow without
--     limit.
-- ============================================================================

alter table public.training_plans
  add column if not exists plan_adjustments jsonb not null default '[]'::jsonb;

-- Shape, not decoration. Every reader of this column expects an array, and a
-- rejected write is a better failure than a plan screen that renders nothing
-- because the column holds an object. Same reasoning as the bounded columns in
-- the life_events migration.
alter table public.training_plans
  drop constraint if exists training_plans_plan_adjustments_array;
alter table public.training_plans
  add constraint training_plans_plan_adjustments_array
  check (jsonb_typeof(plan_adjustments) = 'array');

-- No new index. The column is read only alongside the plan row it belongs to,
-- always by primary key, and is never filtered on.

notify pgrst, 'reload schema';
