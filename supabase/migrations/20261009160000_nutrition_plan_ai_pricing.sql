-- ============================================================================
-- AI NUTRITION PLANS — the price that matches the provider call
-- ----------------------------------------------------------------------------
-- `generate-nutrition-plan` writes a week-by-week meal plan with the model:
-- two weeks per call, ~6k in / ~8k out on GPT-6 Luna, so about $0.0046 a call
-- (~$0.0023 a week) — the ceiling in src/config/credits.ts is $0.006 a week,
-- which is that doubled for a bad token estimate.
--
-- Until this migration the key was priced at 8 and deliberately had NO cost
-- ceiling, because the feature made no provider call at all: Nutrition.tsx
-- stored the macro targets the athlete typed in and nothing else. That is no
-- longer true, so the price moves with the cost and the floor is asserted here
-- rather than only in the client suite.
--
-- Why 15 and not 5 (which is the bare 8x floor at the worst-case credit value):
-- the floor is what a price must clear, not what it should be. On the worst pack
-- in the worst market one credit is $0.0105 NET of Google Play's 30%, so 15
-- credits is $0.1575 against a $0.006 ceiling — 26x, i.e. a good margin after
-- the store's cut rather than a break-even priced to the last cent. It is also
-- deliberately cheaper than a week of training plan (20): the nutrition plan is
-- the smaller output, and the Nutrition Pack (30, once) still undercuts four
-- weeks of plans, which keeps the unlock the obvious buy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The price — one jsonb merge, so the key cannot be half-applied.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb || '{
  "nutrition_plan_week": 15
}'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. The storage the plan itself needs. Already present on some environments;
--    IF NOT EXISTS keeps this migration safe to re-run either way.
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS plan_data jsonb;

COMMENT ON COLUMN public.nutrition_plans.plan_data IS
  'The AI-written plan: [{ week, focus, calories, protein_g, carbs_g, fat_g, days: [{ day, dayName, meals: [...] }] }]. NULL for plans created before the model took over, which stored targets only.';

-- ---------------------------------------------------------------------------
-- 3. Assertions — the migration fails rather than shipping a price the code
--    does not agree with, or an AI feature priced under its own provider cost.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_price integer := public.credit_cost('nutrition_plan_week');
  v_ceiling_usd numeric := 0.006;   -- src/config/credits.ts, per week
  v_worst_usd_per_credit numeric := 0.0105;  -- NET of GOOGLE_PLAY_TAKE
  v_multiple numeric;
BEGIN
  IF v_price <> 15 THEN
    RAISE EXCEPTION 'nutrition_plan_week not applied (got %)', v_price;
  END IF;

  -- The 8x floor the client suite enforces, re-derived here from the two
  -- numbers that actually decide it. A price that clears the floor in the
  -- client but not in the database (or the reverse) means one of the two is
  -- stale, which is the failure this catches.
  v_multiple := (v_price * v_worst_usd_per_credit) / v_ceiling_usd;
  IF v_multiple < 8 THEN
    RAISE EXCEPTION 'nutrition_plan_week margin is only %x its ceiling', round(v_multiple, 2);
  END IF;

  -- ...and it must stay cheaper than the training plan it sits beside.
  IF v_price >= public.credit_cost('training_plan_week') THEN
    RAISE EXCEPTION 'a nutrition-plan week (%) costs as much as a training-plan week',
      v_price;
  END IF;

  -- The scan is the other half of this screen and must remain priced too.
  IF public.credit_cost('calorie_scan') <= 0 THEN
    RAISE EXCEPTION 'calorie_scan is free — the OpenAI vision call is not';
  END IF;
END $$;
