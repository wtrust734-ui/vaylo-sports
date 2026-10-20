-- ============================================================================
-- NUTRITION PLAN WEEK — the price on the button and the price charged
-- ----------------------------------------------------------------------------
-- Symptom: Nutrition shows "Plan (8 /wk)" and `credits_spend()` charges 15.
--
-- `20261009160000_nutrition_plan_ai_pricing.sql` moved this key to 15 when the
-- plan became a metered model call. That file was applied to the database; the
-- client was not, and `src/config/credits.ts` went on advertising 8. It is the
-- same drift that broke the elite comparison ("Unknown credit feature:
-- vpr_compare"), with a quieter failure mode: nothing errors, the athlete is
-- simply charged 7 credits a week more than the button they pressed said — and
-- the top-up sheet offers a shortfall 7 credits too small, because it sizes the
-- top-up from the client's price.
--
-- 15 was not wrong on margin: it clears the 8x floor 26x over. It is wrong in
-- two ways that matter more:
--
--   * The app must not show one price and charge another. Between the two, the
--     one to move is the one the athlete has never agreed to: the button has
--     read 8 since the key existed, and nobody has ever been charged 15 knowingly.
--
--   * The day-one basket. STARTING_CREDITS is 260, sized so a new athlete can
--     build an 8-week training plan (8 x 20 = 160) AND still afford the extras
--     `scripts/credit-economy-model.mjs` enumerates — a calorie scan, three
--     coach messages, a form analysis, a weekly review and four weeks of
--     nutrition plan. At 8 that basket is 253 of the 260 grant and fits, which
--     is the invariant the model asserts. At 15 it is 281 and does not, which
--     quietly turns "the starting grant covers your first eight weeks" into
--     "and then buy credits in week one".
--
-- At 8 the key still clears the floor comfortably: the per-week ceiling is
-- $0.0046 — one call covers two weeks (~6k in / ~8k out on Luna), doubled for a
-- bad token estimate — so 8 credits, $0.084 at the worst-case net credit value,
-- is 18x the ceiling. That is clear of MIN_MARGIN_MULTIPLE (8) and in the same
-- band as the other small, repeatable AI checks (weekly_coach_review 10,
-- nutrition_review 8, training_insight 8).
--
-- This supersedes the PRICE in that file and nothing else. The `plan_data`
-- column and the "the plan is a metered model call" rationale both stand; what
-- changes is that `src/config/credits.ts` now declares the ceiling that call
-- actually has, so the floor is enforced on both sides of the mirror rather
-- than only in the database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The price, as one jsonb merge so the key cannot be half-applied.
--    Idempotent: re-running sets the same value.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb || '{
  "nutrition_plan_week": 8
}'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. Assertions. The migration fails rather than leaving the mirror half-right.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_price integer;
  v_ceiling_usd numeric := 0.0046;          -- per week; see src/config/credits.ts
  v_worst_usd_per_credit numeric := 0.0105; -- NET of GOOGLE_PLAY_TAKE
  v_basket integer;
  v_starting integer := 260;                -- src/config/credits.ts
BEGIN
  v_price := public.credit_cost('nutrition_plan_week');
  IF v_price <> 8 THEN
    RAISE EXCEPTION 'nutrition_plan_week not applied (got %)', v_price;
  END IF;

  -- The floor, re-derived from the two numbers that decide it. A price that
  -- clears the floor in the client but not here (or the reverse) means one of
  -- the two is stale — the failure this whole migration exists to end.
  IF (v_price * v_worst_usd_per_credit) / v_ceiling_usd < 8 THEN
    RAISE EXCEPTION 'nutrition_plan_week margin is only %x its ceiling',
      round((v_price * v_worst_usd_per_credit) / v_ceiling_usd, 2);
  END IF;

  -- Cheaper than a week of training plan (20) but not free: the nutrition plan
  -- is the smaller output, and a zero price would make credits_spend grant it
  -- for nothing.
  IF v_price >= public.credit_cost('training_plan_week') THEN
    RAISE EXCEPTION 'a nutrition-plan week (%) costs as much as a training-plan week', v_price;
  END IF;

  -- The day-one basket, read out of the live row rather than restated: this is
  -- the number that decided the price, so it is the number worth asserting.
  v_basket := 8 * public.credit_cost('training_plan_week')
            + public.credit_cost('calorie_scan')
            + 3 * public.credit_cost('vaylo_coach_message')
            + public.credit_cost('form_analysis')
            + public.credit_cost('weekly_coach_review')
            + 4 * public.credit_cost('nutrition_plan_week');
  IF v_basket > v_starting THEN
    RAISE EXCEPTION 'the day-one basket is % credits against a % grant', v_basket, v_starting;
  END IF;
END $$;
