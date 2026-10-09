-- ============================================================================
-- AI PLAN EDITS — two prices, in the same table as every other one
-- ----------------------------------------------------------------------------
-- `edit-plan` rewrites part of a plan the athlete already owns: one week (or one
-- session, which is the same request with a narrower instruction) for 10
-- credits, or the whole plan for 20. Both are one OpenAI call per two weeks of
-- plan, so the cost model is the same one `training_plan_week` already uses —
-- the ceilings in src/config/credits.ts are set from it and pricing.test.ts
-- re-derives the margin floor from REGIONAL_TIERS, net of Play's cut.
--
-- Why 10 and 20 rather than one number: a week edit is a small, frequent action
-- ("swap Thursday for a swim") and a whole-plan edit is a rare, large one. The
-- price has to survive the worst pack in the worst market — 10 credits is
-- $0.105 of net revenue against a $0.003 ceiling, which is 35x — while still
-- being cheap enough that an athlete uses it instead of abandoning a plan that
-- no longer fits their week. That second part is the whole point of the
-- feature: a plan nobody edits is a plan nobody follows.
--
-- Free edits stay free and are not in this table at all: marking a week as a
-- holiday, editing a session's title or duration by hand, and skipping a
-- session are local operations in Training.tsx with no provider call behind
-- them, so pricing them would be pricing nothing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Feature costs — one jsonb merge, so the key set cannot be half-applied.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb || '{
  "plan_edit": 10,
  "plan_edit_full": 20
}'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. Assertions — the migration fails rather than shipping a price the code
--    does not agree with, or an edit that costs as much as a whole plan.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.economy_value('feature_costs');
BEGIN
  IF public.credit_cost('plan_edit') <> 10 THEN
    RAISE EXCEPTION 'plan_edit not applied (got %)', public.credit_cost('plan_edit');
  END IF;
  IF public.credit_cost('plan_edit_full') <> 20 THEN
    RAISE EXCEPTION 'plan_edit_full not applied (got %)', public.credit_cost('plan_edit_full');
  END IF;

  -- An edit must never cost as much as the plan it edits: a 4-week plan is
  -- 4 x training_plan_week, so a whole-plan edit priced at or above that is a
  -- worse deal than starting again, and nobody would ever buy it.
  IF public.credit_cost('plan_edit_full') >= public.credit_cost('training_plan_week') * 4 THEN
    RAISE EXCEPTION 'a whole-plan edit (%) costs as much as a fresh 4-week plan',
      public.credit_cost('plan_edit_full');
  END IF;

  -- The cheap edit has to be the cheaper one, or the label is a lie.
  IF public.credit_cost('plan_edit') >= public.credit_cost('plan_edit_full') THEN
    RAISE EXCEPTION 'plan_edit (%) is not cheaper than plan_edit_full (%)',
      public.credit_cost('plan_edit'), public.credit_cost('plan_edit_full');
  END IF;

  -- Both keys must be present in the row itself, not only resolvable through a
  -- fallback: the client shows these prices before anything is charged.
  IF v -> 'plan_edit' IS NULL OR v -> 'plan_edit_full' IS NULL THEN
    RAISE EXCEPTION 'feature_costs is missing a plan-edit key';
  END IF;
END $$;
