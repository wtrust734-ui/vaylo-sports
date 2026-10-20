-- ============================================================================
-- INJURY MANAGEMENT — the plan costs credits even after the tab is bought
-- ----------------------------------------------------------------------------
-- The tab itself is a one-off unlock (injury_management_unlock, 25 credits).
-- What that buys is the SCREEN: the load-versus-recovery arithmetic, the injury
-- log and the red flags, all computed on the device with no provider call.
--
-- A generated plan is a different thing. Every plan is written for one injury,
-- at one severity, against what this athlete can still do — the injury, their
-- training week and their dossier go to the model and a week-by-week scaffold
-- comes back (ai-analyze, type "injury_plan"). That is a real provider call
-- every single time, so it is charged per plan on top of the unlock: an athlete
-- who owns the tab and generates a plan every week still pays for the calls
-- they cause. The alternative — folding it into the 25-credit unlock — is a
-- flat rate on a metered cost, which is the product this catalogue refuses to
-- sell everywhere else.
--
-- Priced at 6. That is $0.063 of revenue at the worst-case NET credit value
-- ($0.0105, tier D's biggest pack after Google Play's 30%) against the $0.0032
-- ceiling in src/config/credits.ts, ~19x — clear of the 8x floor with room for
-- a bad token estimate, and in the same band as the other small repeatable AI
-- checks (nutrition review 8, weekly coach review 10, training insight 8).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The price — one jsonb merge, so the key cannot be half-applied.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb || '{
  "injury_plan": 6
}'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. Assertions — the migration fails rather than shipping a price the code
--    does not agree with, or an AI feature priced under its own provider cost.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_price integer := public.credit_cost('injury_plan');
  v_unlock integer := public.credit_cost('injury_management_unlock');
  v_ceiling_usd numeric := 0.0032;            -- src/config/credits.ts
  v_worst_usd_per_credit numeric := 0.0105;   -- NET of GOOGLE_PLAY_TAKE
  v_multiple numeric;
  v jsonb := public.economy_value('feature_costs');
BEGIN
  IF v_price <> 6 THEN
    RAISE EXCEPTION 'injury_plan not applied (got %)', v_price;
  END IF;

  -- The 8x floor the client suite enforces, re-derived from the two numbers
  -- that decide it. A price that clears the floor in the client but not in the
  -- database (or the reverse) means one of the two is stale.
  v_multiple := (v_price * v_worst_usd_per_credit) / v_ceiling_usd;
  IF v_multiple < 8 THEN
    RAISE EXCEPTION 'injury_plan margin is only %x its ceiling', round(v_multiple, 2);
  END IF;

  -- The key must be in the row itself, not merely resolvable through a
  -- fallback: the button shows this price before anything is charged, and a
  -- missing key there is an undefined price on screen.
  IF v -> 'injury_plan' IS NULL THEN
    RAISE EXCEPTION 'feature_costs is missing injury_plan';
  END IF;

  -- A plan must never cost MORE than the tab that holds it. The unlock has to
  -- stay the bigger purchase, or nobody buys the tab and the plan is the whole
  -- product with none of the screen around it.
  IF v_price >= v_unlock THEN
    RAISE EXCEPTION 'an injury plan (%) costs as much as the unlock (%)',
      v_price, v_unlock;
  END IF;

  -- ...and it must not be free: credits_spend would grant the AI call for
  -- nothing, which is the flat rate this catalogue refuses to sell.
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'injury_plan is free — the provider call is not';
  END IF;
END $$;
