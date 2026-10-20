-- ============================================================================
-- PRICING DRIFT — the price the app shows, and the price the database charges
-- ----------------------------------------------------------------------------
-- Symptom: "Stack Up vs Elite" could never be unlocked. Tapping "Compare for 2
-- credits" failed with, verbatim, `Unknown credit feature: vpr_compare`.
--
-- Cause: the client and `economy_config.feature_costs` are two mirrors of one
-- price list, and they had drifted. `src/config/credits.ts` ships 22 spendable
-- keys; the live row held 20, four of them missing and two of them retired:
--
--   missing in the database   vpr_compare, training_insight,
--                            nutrition_review, injury_plan
--   retired in the client,
--   still live in the row     form_analysis_unlock (110), nutrition_pack_unlock (30)
--
-- `public.credit_cost()` RAISES on a key it does not know, so `credits_spend()`
-- answers a 500-shaped error instead of the 402-with-a-shortfall the top-up
-- sheet is built to read. The athlete sees the price on the button (the client
-- has the key) and gets an error when they press it. Elite comparison was one
-- of four surfaces broken this way — an injury plan and a nutrition review were
-- the same failure waiting on the same fix.
--
-- This supersedes `20261010150000_per_use_pricing.sql`, which asked for exactly
-- these two additions and these two retirements but asserted
-- `credit_cost('nutrition_plan_week') = 8`. That file is not applicable as
-- written: `20261009160000_nutrition_plan_ai_pricing.sql` had already moved the
-- key to 15 (nutrition plans became a metered AI call, so they were priced over
-- the 8x floor). Applying the older file aborts on its own assertion, which is
-- why the additions never landed. Nothing about `nutrition_plan_week` is
-- asserted here: its price is a separate, already-applied decision.
--
-- The assertions below are the invariant that would have caught this on the day
-- it was introduced, and they live in the database now rather than only in the
-- client suite (`pricing.test.ts` mirrors this list, but a test can only
-- compare the two lists — it cannot look at the live row).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pre-flight. Asserted BEFORE the write, so a mismatch aborts the migration
--    without having to roll a half-applied economy back. (The one thing that
--    must be true for the merge below to be the *whole* fix: the four keys are
--    unknown only because they are absent, and the two retired keys are
--    unpurchasable by product id.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_key text;
  -- The keys the client already sells today and must already resolve. If one of
  -- these is missing, the drift is wider than this migration describes and the
  -- economy needs looking at rather than patching.
  v_present text[] := ARRAY[
    'archetype_view', 'development_trajectory', 'cross_sport_unlock',
    'training_plan_week', 'plan_edit', 'plan_edit_full', 'limiter_fix_plan',
    'form_analysis', 'video_form_analysis', 'injury_management_unlock',
    'calorie_scan', 'nutrition_plan_week', 'mental_gym_unlock',
    'vaylo_coach_message', 'weekly_coach_review', 'tactical_prep',
    'learning_unlock', 'streak_shield'
  ];
BEGIN
  FOREACH v_key IN ARRAY v_present LOOP
    IF public.credit_cost(v_key) <= 0 THEN
      RAISE EXCEPTION 'feature % resolves to a non-positive price', v_key;
    END IF;
  END LOOP;

  -- form_analysis_unlock and nutrition_pack_unlock are retired keys, not a
  -- missing price: what makes removing them safe is that no *product id* maps
  -- to either one. `process-purchase` prices only the ids in FEATURE_PRODUCTS
  -- (archetype, cross_sport, injury_management, mental_gym), and neither
  -- retired key is among them, so nothing the shop can sell reaches them.
  IF public.credit_cost('mental_gym_unlock') <> 30 THEN
    RAISE EXCEPTION 'the unlock catalogue moved — re-check the retirements';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The four missing prices, and the two retirements — one jsonb expression,
--    so the row can never be read half-updated.
--
--    The prices are the ones the client already charges (src/config/credits.ts)
--    and the ones scripts/credit-economy-model.mjs derives. Nothing here is a
--    new price: every one of these four has been shown to athletes on a button
--    since the build that introduced it.
--
--    Idempotent: `-` on an absent key is a no-op and `||` overwrites, so
--    re-running this file is a no-op rather than an error.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (
  ((value::jsonb - 'form_analysis_unlock') - 'nutrition_pack_unlock')
  || '{
       "vpr_compare": 2,
       "training_insight": 8,
       "nutrition_review": 8,
       "injury_plan": 6
     }'::jsonb
)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 3. Assertions — the migration fails rather than applying a half-correct
--    economy. The first block is the general invariant: every key the client
--    can spend resolves, positively. That is the check whose absence let a
--    button advertise a price and the charge 500.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.economy_value('feature_costs');
  v_key text;
  v_cost integer;
  -- EXACTLY the keys in src/config/credits.ts FEATURE_COSTS, which
  -- src/lib/pricing.test.ts pins as the client's whole spendable surface.
  v_spendable text[] := ARRAY[
    'archetype_view', 'development_trajectory', 'cross_sport_unlock',
    'training_plan_week', 'plan_edit', 'plan_edit_full', 'limiter_fix_plan',
    'form_analysis', 'video_form_analysis', 'injury_management_unlock',
    'injury_plan', 'calorie_scan', 'nutrition_plan_week', 'nutrition_review',
    'mental_gym_unlock', 'vaylo_coach_message', 'weekly_coach_review',
    'tactical_prep', 'training_insight', 'vpr_compare', 'learning_unlock',
    'streak_shield'
  ];
BEGIN
  -- Every spendable key resolves, and resolves to something a person could pay.
  FOREACH v_key IN ARRAY v_spendable LOOP
    v_cost := public.credit_cost(v_key);      -- raises 'Unknown credit feature' if absent
    IF v_cost <= 0 THEN
      RAISE EXCEPTION 'feature % is priced at % — credits_spend would grant it free',
        v_key, v_cost;
    END IF;
  END LOOP;

  -- The key must be in the row itself, not merely resolvable: the client shows
  -- this price on the button before anything is charged.
  IF v -> 'vpr_compare' IS NULL THEN
    RAISE EXCEPTION 'feature_costs is missing vpr_compare';
  END IF;
  IF public.credit_cost('vpr_compare') <> 2 THEN
    RAISE EXCEPTION 'vpr_compare not applied (got %)', public.credit_cost('vpr_compare');
  END IF;

  -- The retirements are retirements, not zeros. A zero price would make
  -- credits_spend grant the feature for nothing, which is worse than the flat
  -- rate it replaced. (This also keeps them out of the row the client mirrors:
  -- an unknown key is better than a gift.)
  IF (v ? 'form_analysis_unlock') THEN
    RAISE EXCEPTION 'form_analysis_unlock is still priced — the flat rate is retired';
  END IF;
  IF (v ? 'nutrition_pack_unlock') THEN
    RAISE EXCEPTION 'nutrition_pack_unlock is still priced — the pack is retired';
  END IF;

  -- A comparison must stay the cheapest thing in the shop: it is arithmetic over
  -- numbers already on the device, with no provider call behind it. Priced
  -- above a metered AI check it would be charging for the wrapper.
  IF public.credit_cost('vpr_compare') >= public.credit_cost('training_insight') THEN
    RAISE EXCEPTION 'a comparison (%) is not cheaper than a training insight (%)',
      public.credit_cost('vpr_compare'), public.credit_cost('training_insight');
  END IF;
END $$;
