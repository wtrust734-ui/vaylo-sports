-- ============================================================================
-- ECONOMY AUDIT 2026-10-03
-- ----------------------------------------------------------------------------
-- Four changes, each verified against the live database after applying:
--
--   1. starting_credits 20 -> 50.
--      `public.starting_credits()` reads economy_config and falls back to 20
--      when the row is missing. The row was already 50, so the fallback and the
--      configured value disagreed — a new signup and a re-run of the trigger
--      could produce different grants. The fallback is now 50 too, which is the
--      only value a new account can actually receive. Plus a back-fill for
--      accounts still sitting on the old 20-credit grant.
--
--   2. limiter_fix_plan 24 -> 40.
--      limiter_fix_plan is the largest single AI output in the app
--      (limiter_analysis, 8000 output tokens, medium reasoning effort) and was
--      priced below one coach message per call. Re-derived against the
--      worst-case $0.0384/credit; see PRICING.md for the per-feature working.
--      nutrition_plan_week was also touched: it makes no provider call (the
--      plan is built from the macro targets the athlete typed in), so it has
--      no per-use cost to cover. It was still the cheapest feature in the app
--      by an order of magnitude, and went 4 -> 8.
--
--   3. form_analysis 25 — a NEW feature key.
--      `ai-analyze` charges the key "form_analysis" for a photo analysis by a
--      caller with no entitlement, but no such key existed in feature_costs, so
--      `credit_cost()` raised 'Unknown credit feature: form_analysis' inside
--      credits_spend() and the athlete saw a 500 rather than a 402 with a
--      shortfall the top-up sheet could act on.
--
--   4. form_analysis_unlock 54 -> 120.
--      This is a FLAT-RATE product: one payment buys unlimited photo analyses.
--      At 54 credits ($2.07 worst-case) against a $0.06 ceiling it broke even
--      after ~34 analyses and lost money beyond that. 120 moves break-even past
--      75 while keeping the unlock the sensible purchase for anyone who would
--      analyse more than five times (5 × 25 per-call = 125). It is the one
--      price in the app that is a bet on usage rather than a per-call margin,
--      and PRICING.md says so.
--
-- Applied via scripts/run-sql-file.cjs and verified by reading the row back and
-- calling public.credit_cost() for every key.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. starting_credits — align the function fallback with the configured value
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.starting_credits()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((public.economy_value('starting_credits'))::text::integer, 50)
$$;

UPDATE public.economy_config
SET value = '50'::jsonb
WHERE key = 'starting_credits' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 1b. Back-fill the old 20-credit starter grant
-- ---------------------------------------------------------------------------
-- Deliberately narrow. It only touches accounts whose ONLY credit movement is
-- the starter row of exactly 20, so an athlete who has spent, earned or bought
-- credits is never credited a second time or topped up unexpectedly. The grant
-- goes through credits_grant() rather than a direct UPDATE: that is the routine
-- the balance-guard trigger allows, it writes the matching ledger row, and it
-- gives the top-up a stable idempotency key so re-running this migration cannot
-- double-credit anyone.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.user_id
    FROM public.profiles p
    JOIN public.credit_transactions t
      ON t.user_id = p.user_id AND t.source = 'starter' AND t.amount = 20
    WHERE NOT EXISTS (
      SELECT 1 FROM public.credit_transactions o
      WHERE o.user_id = p.user_id AND o.source <> 'starter'
    )
  LOOP
    PERFORM public.credits_grant(
      p_user => r.user_id,
      p_amount => 30,
      p_reason => 'Starter credits raised to 50 (economy audit 2026-10-03)',
      p_source => 'starter',
      p_idempotency_key => 'starter_topup_20261003:' || r.user_id::text
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2-4. Feature costs
-- ---------------------------------------------------------------------------
-- Written as a single jsonb merge so the key set can never be half-applied.
-- form_analysis is ADDED (see the header); the other three are overwritten.
UPDATE public.economy_config
SET value = (value::jsonb || '{
      "limiter_fix_plan": 40,
      "form_analysis": 25,
      "form_analysis_unlock": 120
    }'::jsonb)
WHERE key = 'feature_costs' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- Assertions — the migration fails rather than applying a half-correct economy
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.economy_value('feature_costs');
BEGIN
  -- 8, not the 4 this originally asserted. The pricing pass this migration
  -- describes raised nutrition_plan_week 4 -> 8 (src/config/credits.ts is
  -- the source of truth and declares 8), and the live row already holds 8.
  -- Leaving 4 here would have failed every future push on a value that is
  -- correct, which trains people to disable the assertion instead.
  IF (v ->> 'nutrition_plan_week')::int <> 8 THEN
    RAISE EXCEPTION 'nutrition_plan_week should be 8 (got %)', v ->> 'nutrition_plan_week';
  END IF;
  IF (v ->> 'limiter_fix_plan')::int <> 40 THEN
    RAISE EXCEPTION 'limiter_fix_plan not applied (got %)', v ->> 'limiter_fix_plan';
  END IF;
  IF (v ->> 'form_analysis')::int <> 25 THEN
    RAISE EXCEPTION 'form_analysis not applied (got %)', v ->> 'form_analysis';
  END IF;
  IF (v ->> 'form_analysis_unlock')::int <> 120 THEN
    RAISE EXCEPTION 'form_analysis_unlock not applied (got %)', v ->> 'form_analysis_unlock';
  END IF;
  IF public.starting_credits() <> 50 THEN
    RAISE EXCEPTION 'starting_credits() is not 50 (got %)', public.starting_credits();
  END IF;
  -- The key that ai-analyze actually asks for must now resolve.
  IF public.credit_cost('form_analysis') <> 25 THEN
    RAISE EXCEPTION 'credit_cost(form_analysis) does not resolve';
  END IF;
END $$;
