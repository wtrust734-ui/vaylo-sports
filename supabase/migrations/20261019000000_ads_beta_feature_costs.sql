-- Ads Studio beta: meter the four provider-billed generation paths.
-- Cause: the ads functions rate-limit, quote and confirm provider calls, but
-- never charge credits — every other AI feature in the app meters through
-- credits_spend / credits_spend_metered. Without these keys a beta user can
-- spend unbounded provider budget (Veo seconds are the expensive case) with
-- only per-minute rate limits behind it. Costs are MET for Unlimited plans via
-- the metered path, so a subscription never converts into unbounded spend.
--
-- Prices (feature_costs, credits per successful call):
--   ads_image_generate   4   one provider image generation
--   ads_video_shot      40   one Veo shot (4-8 s, the most expensive single call)
--   ads_video_narration  5   one ElevenLabs narration of an ad script
--   ads_video_render     1   one render-worker job dispatch
-- Concept/script text steps stay on the ai_call_allowed rate limit (cheap
-- text generation, same treatment as chat or research).
-- Prices are deliberately ROUND and reviewable; they are metered for ALL plans
-- so the numbers, not a plan tier, set the ceiling.

-- ---------------------------------------------------------------------------
-- 1. Update the shared feature_costs row (insert a minimal one only if the
--    consolidated economy never shipped — same guard as weekly_coach_review).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  v_key text;
  v_missing text;
BEGIN
  SELECT public.economy_value('feature_costs') INTO v;
  IF v IS NULL THEN
    RAISE NOTICE 'economy_config feature_costs not found — seeding minimal row';
    INSERT INTO public.economy_config (key, region, ab_variant, value, active)
    VALUES ('feature_costs', 'GLOBAL', 'control',
      '{"ads_image_generate":4,"ads_video_shot":40,"ads_video_narration":5,"ads_video_render":1}'::jsonb,
      true);
  ELSE
    UPDATE public.economy_config
       SET value = v
             || '{"ads_image_generate":4,"ads_video_shot":40,"ads_video_narration":5,"ads_video_render":1}'::jsonb,
           active = true
     WHERE key = 'feature_costs' AND region = 'GLOBAL';
  END IF;

  -- 2. Assertions — fail loudly rather than shipping an unusable price list:
  --    every ads key AND every legacy client key must resolve.
  v := public.economy_value('feature_costs');
  FOREACH v_key IN ARRAY ARRAY['ads_image_generate','ads_video_shot','ads_video_narration','ads_video_render']
  LOOP
    IF v -> v_key IS NULL OR (v ->> v_key)::integer <= 0 THEN
      v_missing := v_missing || COALESCE(v_missing || ',', '') || v_key;
    END IF;
  END LOOP;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'feature_costs missing or non-positive: %', v_missing;
  END IF;
  -- Client spendable surface must be untouched: spot-check a load-bearing key.
  IF v -> 'training_plan_week' IS NULL OR (v ->> 'training_plan_week')::integer <> 20 THEN
    RAISE EXCEPTION 'ads beta migration disturbed the existing credit economy (training_plan_week)';
  END IF;
END $$;
