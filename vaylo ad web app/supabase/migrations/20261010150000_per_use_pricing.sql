-- ============================================================================
-- PER-USE PRICING 2026-10-10
-- ----------------------------------------------------------------------------
-- Two retirements, two additions. Derived from scripts/credit-economy-model.mjs
-- (re-run it after touching a price); this migration is the applied result.
--
-- Retired (flat rates on metered AI calls lose money to the heavy users they
-- attract, so the catalogue refuses to sell them):
--   form_analysis_unlock  (was 110 — "unlimited" analyses for one payment)
--   nutrition_pack_unlock (was 30 — free scans and free plans for one payment)
--
-- Added:
--   training_insight  8  — the stats_insight AI call, Luna-class like the
--                          weekly review, clearing the 8x floor ~35x over.
--   vpr_compare       2  — elite VPR comparison. Pure arithmetic over numbers
--                          already on the device: no provider call, no ceiling,
--                          priced for value like the nutrition plan week.
--
-- Nutrition is a standard tab (plan per week, scan per scan) and form analysis
-- is video-only per analysis. Rows already written to user_purchases for the
-- retired products stay as history but grant nothing new: process-purchase
-- only prices product ids in FEATURE_PRODUCTS, and neither id is in it.
-- ============================================================================

UPDATE public.economy_config
SET value = (
  ((value::jsonb - 'form_analysis_unlock') - 'nutrition_pack_unlock')
  || '{"vpr_compare": 2, "training_insight": 8}'::jsonb
)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- Assertions — the migration fails rather than applying a half-correct economy.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.economy_value('feature_costs');
  kv record;
BEGIN
  -- The retired flat rates are gone, not zeroed: a zero price would make
  -- credits_spend grant the feature for free.
  IF (v ? 'form_analysis_unlock') THEN
    RAISE EXCEPTION 'form_analysis_unlock is still priced — the flat rate is retired';
  END IF;
  IF (v ? 'nutrition_pack_unlock') THEN
    RAISE EXCEPTION 'nutrition_pack_unlock is still priced — the pack is retired';
  END IF;

  -- Every key the client can ask for must resolve, and resolve to the new price.
  IF public.credit_cost('vpr_compare') <> 2 THEN
    RAISE EXCEPTION 'vpr_compare not applied (got %)', public.credit_cost('vpr_compare');
  END IF;
  IF public.credit_cost('training_insight') <> 8 THEN
    RAISE EXCEPTION 'training_insight not applied (got %)', public.credit_cost('training_insight');
  END IF;
  IF public.credit_cost('video_form_analysis') <> 45 THEN
    RAISE EXCEPTION 'video_form_analysis moved (got %)', public.credit_cost('video_form_analysis');
  END IF;
  IF public.credit_cost('calorie_scan') <> 12 THEN
    RAISE EXCEPTION 'calorie_scan moved (got %)', public.credit_cost('calorie_scan');
  END IF;
  IF public.credit_cost('nutrition_plan_week') <> 8 THEN
    RAISE EXCEPTION 'nutrition_plan_week moved (got %)', public.credit_cost('nutrition_plan_week');
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
