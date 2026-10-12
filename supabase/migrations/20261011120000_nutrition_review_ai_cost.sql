-- ============================================================================
-- AI NUTRITION REVIEW — the price that matches the provider call
-- ----------------------------------------------------------------------------
-- The nutrition tab already charges per use for its two metered actions: a
-- calorie scan (photo -> macros, 12) and a nutrition-plan week (15). The review
-- is the third: the athlete asks the coach to read what they have actually
-- logged against their age, sport, training load and goals and say whether the
-- week is fuelling the training, with ordinary tips rather than anything
-- clinical.
--
-- It is ONE Luna-class text call over the dossier plus a week of logged meals
-- (~13k in / ~1.2k out), so the ceiling in src/config/credits.ts is $0.0038 —
-- that measured call doubled, the same treatment every other ceiling gets. The
-- price has to survive the worst pack in the worst market, where one credit is
-- $0.0105 NET of Google Play's 30%: 8 credits is $0.084 of revenue against the
-- $0.0038 ceiling, ~22x, i.e. a real margin rather than a break-even priced to
-- the last cent. It sits in the same band as the other small, repeatable AI
-- checks (the weekly coach review is 10, the training insight is 8), and it is
-- no dearer than a week of nutrition plan, so the bigger output is never the
-- cheaper buy.
--
-- Because it is a metered provider call, this is NOT a one-off unlock and there
-- is no "unlimited reviews" product: a flat rate on a call we pay for every
-- time loses money to exactly the heavy users it attracts. The key is per use,
-- like calorie_scan beside it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The price — one jsonb merge, so the key cannot be half-applied.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb || '{
  "nutrition_review": 8
}'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. Assertions — the migration fails rather than shipping a price the code
--    does not agree with, or an AI feature priced under its own provider cost.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_price integer := public.credit_cost('nutrition_review');
  v_ceiling_usd numeric := 0.0038;            -- src/config/credits.ts
  v_worst_usd_per_credit numeric := 0.0105;   -- NET of GOOGLE_PLAY_TAKE
  v_multiple numeric;
  v jsonb := public.economy_value('feature_costs');
BEGIN
  IF v_price <> 8 THEN
    RAISE EXCEPTION 'nutrition_review not applied (got %)', v_price;
  END IF;

  -- The 8x floor the client suite enforces, re-derived here from the two
  -- numbers that actually decide it. A price that clears the floor in the
  -- client but not in the database (or the reverse) means one of the two is
  -- stale, which is the failure this catches.
  v_multiple := (v_price * v_worst_usd_per_credit) / v_ceiling_usd;
  IF v_multiple < 8 THEN
    RAISE EXCEPTION 'nutrition_review margin is only %x its ceiling', round(v_multiple, 2);
  END IF;

  -- The key must be in the row itself, not merely resolvable through a
  -- fallback: the client shows this price on the button before anything is
  -- charged, and a missing key there is an undefined price on screen.
  IF v -> 'nutrition_review' IS NULL THEN
    RAISE EXCEPTION 'feature_costs is missing nutrition_review';
  END IF;

  -- A review must never cost MORE than the bigger output it sits beside, or
  -- the cheaper of the two is the one nobody buys.
  IF v_price > public.credit_cost('nutrition_plan_week') THEN
    RAISE EXCEPTION 'a nutrition review (%) costs more than a plan week',
      v_price;
  END IF;

  -- ...and it must not be free: credits_spend would grant the AI call for
  -- nothing, which is the flat rate this catalogue refuses to sell.
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'nutrition_review is free — the provider call is not';
  END IF;
END $$;
