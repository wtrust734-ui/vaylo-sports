-- ============================================================================
-- NUTRITION INTAKE — the answers the plan is built from, kept between visits
-- ----------------------------------------------------------------------------
-- The plan form used to ask four numbers the athlete was supposed to already
-- know: calories, protein, carbs, fat. It now asks what actually decides an
-- intake — how much they train, how they eat, what they avoid — and works the
-- targets out itself (src/lib/nutritionTargets.ts). Those answers live here.
--
-- They are kept for three reasons, and none of them is billing:
--
--   1. Retelling the app your training week every time you open the planner is
--      exactly the friction that made the old form unanswerable.
--   2. `food_dislikes` is the allergy field. An athlete who wrote "peanuts"
--      once and is never asked again gets a plan that never contains them —
--      that is the safety case for storing it rather than holding it in state.
--   3. The AI context (the athlete dossier) reads these columns, so the coach
--      and the meal planner answer around the athlete's real diet instead of a
--      generic one. Nothing here is a credit charge; nutrition plans are
--      charged per week by `generate-nutrition-plan`, not by asking questions.
--
-- Every column is nullable and bounded by a CHECK. The screen normalises what
-- it reads back anyway (normalizeIntake), so a value written by a future build
-- cannot open the planner onto an impossible number.
-- ============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS dietary_pattern text
    CHECK (dietary_pattern IS NULL OR dietary_pattern IN ('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher')),
  ADD COLUMN IF NOT EXISTS food_dislikes text,
  ADD COLUMN IF NOT EXISTS meals_per_day integer
    CHECK (meals_per_day IS NULL OR (meals_per_day >= 2 AND meals_per_day <= 6)),
  ADD COLUMN IF NOT EXISTS training_days_per_week integer
    CHECK (training_days_per_week IS NULL OR (training_days_per_week >= 0 AND training_days_per_week <= 7)),
  ADD COLUMN IF NOT EXISTS typical_session_minutes integer
    CHECK (typical_session_minutes IS NULL OR (typical_session_minutes >= 15 AND typical_session_minutes <= 240)),
  ADD COLUMN IF NOT EXISTS activity_level text
    CHECK (activity_level IS NULL OR activity_level IN ('desk', 'on_feet', 'manual')),
  ADD COLUMN IF NOT EXISTS sex text
    CHECK (sex IS NULL OR sex IN ('male', 'female', 'unspecified'));

COMMENT ON COLUMN public.user_settings.food_dislikes IS
  'Foods the athlete avoids or reacts to. Treated as hard exclusions by the meal planner and passed to the AI verbatim.';
COMMENT ON COLUMN public.user_settings.dietary_pattern IS
  'Dietary pattern the meal planner must respect. Every meal in a generated plan has to fit it.';
COMMENT ON COLUMN public.user_settings.training_days_per_week IS
  'Sessions a week, as the athlete described their own training to the nutrition questionnaire. Used to derive the calorie recommendation.';

-- ---------------------------------------------------------------------------
-- Assertions — a half-applied intake migration would leave the planner asking
-- questions it silently cannot save, which is worse than not asking at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ')
  INTO v_missing
  FROM unnest(ARRAY[
    'dietary_pattern',
    'food_dislikes',
    'meals_per_day',
    'training_days_per_week',
    'typical_session_minutes',
    'activity_level',
    'sex'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = c
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'user_settings is missing nutrition intake columns: %', v_missing;
  END IF;

  -- The intake is per-user settings, so the row must still be owned by exactly
  -- one athlete. A table-level check rather than a policy one: this migration
  -- adds columns and must not be able to change who can read the row.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_settings'
  ) THEN
    RAISE EXCEPTION 'user_settings has no RLS policy — do not add athlete data to an unprotected table';
  END IF;
END $$;
