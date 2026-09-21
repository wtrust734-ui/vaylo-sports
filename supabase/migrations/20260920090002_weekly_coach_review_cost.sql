-- Weekly Coach Review: 3 credits per review
-- Adds the new feature cost to the existing economy_config row rather than
-- replacing it, so any admin-edited pricing is preserved.

DO $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.economy_config
  WHERE key = 'feature_costs' AND region = 'GLOBAL' AND COALESCE(ab_variant,'default')='default';
  IF v IS NULL THEN
    RAISE NOTICE 'economy_config feature_costs not found — seeding minimal row';
    v := '{}'::jsonb;
  END IF;
  v := v || '{"weekly_coach_review": 3}'::jsonb;
  INSERT INTO public.economy_config (key, region, ab_variant, value, active)
  VALUES ('feature_costs','GLOBAL','default', v, true)
  ON CONFLICT (key, region, ab_variant) DO UPDATE SET value = v, active = true;
END $$;
