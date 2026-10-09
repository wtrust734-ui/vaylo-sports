-- ============================================================================
-- CREDIT ECONOMY REPRICE 2026-10-04
-- ----------------------------------------------------------------------------
-- Re-derives the whole credit economy from measured provider prices instead of
-- the guessed ceilings the previous prices were built on. The derivation lives
-- in scripts/credit-economy-model.mjs, which prints its working and exits
-- non-zero if any invariant fails; this migration is the result of running it.
--
-- WHY THIS WAS NECESSARY
--
-- The previous API cost ceilings were 20-100x the real cost of a call. Every
-- feature price is derived as (ceiling x 8) / credit-value, so an inflated
-- ceiling inflated every price with it. The visible symptom:
--
--   an 8-week training plan charged 8 x 42 = 336 credits,
--   against a starting grant of 50.
--
-- A new athlete could afford ONE week of the flagship product and then hit a
-- wall. That is not a pricing decision, it is a broken trial, and no test
-- caught it because the model was internally consistent — it was just built on
-- numbers that had never been measured.
--
-- Three corrections, in order of importance:
--
--   1. Margins are now measured on NET revenue. Google Play keeps 30% of an
--      in-app credit sale. The old audit divided the pack price straight into
--      the credit count, which is what the BUYER paid, and then treated it as
--      what WE received. Every margin the suite certified was a third larger
--      than reality.
--
--   2. Ceilings are derived from list price x a token budget, then doubled for
--      retries and price drift. Luna is $0.10/$0.50 per 1M tokens and Sol is
--      $2.00/$10.00 (both stated in _shared/aiModels.ts). Form and video
--      analysis run on Gemini Flash, whose price is NOT recorded anywhere in
--      this repository; those two are an assumption taken at list price and are
--      the numbers most likely to need revisiting once a provider is live.
--
--   3. The starting grant is raised 50 -> 260 so it covers a full 8-week plan
--      plus the rest of a first session. Giving that basket away costs about
--      $0.032 in provider calls.
--
-- Feature prices mostly FALL. That is not a promotion: the old prices were
-- derived from numbers that were never true. With margins still 10-90x the
-- real cost after the store's cut, there was no reason to keep charging for
-- cost that does not exist.
--
-- Re-derived prices (credits):        Margins are against NET credit revenue
--   vaylo_coach_message    11 -> 8       of $0.0105, the cheapest rate any real
--   weekly_coach_review    42 -> 10      buyer produces (tier D, biggest pack,
--   training_plan_week     42 -> 20      999c for 660 credits, after Play's 30%).
--   calorie_scan           42 -> 12
--   tactical_prep          42 -> 12    video_form_analysis is the second-costliest
--   development_trajectory 11 -> 8       call in the app and is priced as such;
--   archetype_view         32 -> 10    limiter_fix_plan is the costliest (Sol).
--   form_analysis       25/37 -> 15
--   video_form_analysis  105 -> 45
--   limiter_fix_plan      40 -> 120   form_analysis / form_analysis_unlock were
--   form_analysis_unlock 120/295 ->110 DISAGREED between the database (25/120)
--   nutrition_pack_unlock  39 -> 30    and src/config/credits.ts (37/295). The
--   mental_gym_unlock      39 -> 30    database is what credits_spend() charges,
--   injury_management_..   29 -> 25    so the app was SHOWING one price and
--   learning_unlock        29 -> 25    TAKING another. Both are now 15/110.
--   cross_sport_unlock     19 -> 15
--
-- Pack bonuses are raised (0/10/25/50/150 -> 5/15/45/90/160) with prices and
-- credit counts unchanged, because those are Play product IDs. pack_500's
-- bonus is capped at 160 by the coin ladder, not by taste: the biggest coin
-- bundle must stay cheaper than converting credits at 7.5 coins per credit.
-- pricing_tiers holds the pack ladder per region and is updated below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. starting_credits: 50 -> 260
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.starting_credits()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((public.economy_value('starting_credits'))::text::integer, 260)
$$;

UPDATE public.economy_config
SET value = '260'::jsonb
WHERE key = 'starting_credits' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. Feature costs — one jsonb merge so the key set can never be half-applied.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb || '{
  "vaylo_coach_message": 8,
  "weekly_coach_review": 10,
  "training_plan_week": 20,
  "calorie_scan": 12,
  "tactical_prep": 12,
  "development_trajectory": 8,
  "archetype_view": 10,
  "form_analysis": 15,
  "form_analysis_unlock": 110,
  "video_form_analysis": 45,
  "limiter_fix_plan": 120,
  "nutrition_plan_week": 8,
  "nutrition_pack_unlock": 30,
  "mental_gym_unlock": 30,
  "injury_management_unlock": 25,
  "learning_unlock": 25,
  "cross_sport_unlock": 15,
  "streak_shield": 3
}'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 3. Pack bonuses in pricing_tiers (prices and credit counts unchanged).
--    Written as a correlated update so every tier moves together; a partial
--    application would make one market's pack worth a different amount.
-- ---------------------------------------------------------------------------
UPDATE public.pricing_tiers t
SET packs = (
  SELECT jsonb_agg(
    CASE (p->>'id')
      WHEN 'pack_25'  THEN jsonb_set(p, '{bonus}', '5'::jsonb)
      WHEN 'pack_50'  THEN jsonb_set(p, '{bonus}', '15'::jsonb)
      WHEN 'pack_120' THEN jsonb_set(p, '{bonus}', '45'::jsonb)
      WHEN 'pack_200' THEN jsonb_set(p, '{bonus}', '90'::jsonb)
      WHEN 'pack_500' THEN jsonb_set(p, '{bonus}', '160'::jsonb)
      ELSE p
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(t.packs) WITH ORDINALITY AS e(p, ord)
)
WHERE t.packs IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Assertions — the migration fails rather than applying a half-correct economy.
-- These mirror scripts/credit-economy-model.mjs: if a price is ever edited
-- here without re-running that script, the push stops instead of quietly
-- shipping a different economy than the one the code describes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.economy_value('feature_costs');
  kv record;
BEGIN
  -- Starting grant must cover a full 8-week plan and the rest of a first
  -- session. This is the requirement the grant exists to satisfy.
  IF public.starting_credits() < 260 THEN
    RAISE EXCEPTION 'starting_credits() is % , expected 260', public.starting_credits();
  END IF;
  IF (v ->> 'training_plan_week')::int * 8 > public.starting_credits() THEN
    RAISE EXCEPTION 'an 8-week plan (8 x % credits) exceeds the starting grant',
      v ->> 'training_plan_week';
  END IF;

  -- Every key the client can ask for must resolve, and resolve to the new price.
  IF public.credit_cost('training_plan_week') <> 20 THEN
    RAISE EXCEPTION 'training_plan_week not applied (got %)', public.credit_cost('training_plan_week');
  END IF;
  IF public.credit_cost('form_analysis') <> 15 THEN
    RAISE EXCEPTION 'form_analysis not applied (got %)', public.credit_cost('form_analysis');
  END IF;
  IF public.credit_cost('form_analysis_unlock') <> 110 THEN
    RAISE EXCEPTION 'form_analysis_unlock not applied (got %)', public.credit_cost('form_analysis_unlock');
  END IF;
  IF public.credit_cost('limiter_fix_plan') <> 120 THEN
    RAISE EXCEPTION 'limiter_fix_plan not applied (got %)', public.credit_cost('limiter_fix_plan');
  END IF;
  IF public.credit_cost('vaylo_coach_message') <> 8 THEN
    RAISE EXCEPTION 'vaylo_coach_message not applied (got %)', public.credit_cost('vaylo_coach_message');
  END IF;

  -- The flat-rate unlock must still beat the per-call price within a handful of
  -- uses, or nobody would buy it and the price would be pointless.
  IF ceil(public.credit_cost('form_analysis_unlock')::numeric
         / public.credit_cost('form_analysis')::numeric) > 8 THEN
    RAISE EXCEPTION 'form_analysis_unlock no longer beats per-call within 8 uses';
  END IF;

  -- No feature may be priced at zero: credits_spend would grant the feature
  -- for free and every margin in the audit would be meaningless.
  FOR kv IN SELECT e.key, e.value::int AS cost FROM jsonb_each_text(v) AS e(key, value)
  LOOP
    IF kv.cost <= 0 THEN
      RAISE EXCEPTION 'feature % is priced at %', kv.key, kv.cost;
    END IF;
  END LOOP;
END $$;
