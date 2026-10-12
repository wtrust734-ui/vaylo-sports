-- ============================================================================
-- UNLIMITED, REPRICED — the plan that pays for itself, at last
-- ----------------------------------------------------------------------------
-- Unlimited deducts nothing. Every call it makes free is a provider invoice we
-- settle instead of the athlete: a video analysis (~$0.027 of Gemini), a plan,
-- a nutrition week, a coach review. At £8.99 a month — about £6.29 net of
-- Google Play's 30% — an athlete who used the app the way it is meant to be
-- used was costing more than the plan collected, and `unlimited_lifetime` at
-- £349.99 made that exposure permanent for one payment.
--
-- The new rates (mirrored in src/config/subscriptionPlans.ts, the offline
-- fallback the client renders from):
--
--   unlimited_monthly    899  →  1999    £19.99
--   unlimited_yearly    7999  → 17999    £179.99   (~£15.00/mo, 25% off)
--   unlimited_lifetime 34999  → 59999    £599.99   (30 months of monthly)
--   credit_lifetime    12999  → 34999    £349.99
--
-- credit_lifetime is in this migration for the same reason rather than a
-- different one: it is the Credit Plan's lifetime option, so it is not metered
-- either — it hands over 100 credits every month for as long as the account
-- exists. £129.99 promised roughly £6 a month of credits at the pack rate and
-- recovered its cost in under two years. £349.99 is about 58 months of that
-- promise. The monthly and yearly Credit Plan options are untouched: they are
-- billed per period, so they cannot accumulate the same exposure.
--
-- Guard rails this migration does not add, because they already exist: the
-- plan's `fair_usage_daily_ai_calls` ceiling (400 on Unlimited, enforced when
-- the plan's entitlements are read) and the fact that nothing here can grant
-- itself credits — an existing subscriber keeps the entitlements they paid for,
-- they simply renew at the new price.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The prices — one row per product, so a half-applied reprice is impossible.
-- ---------------------------------------------------------------------------
UPDATE public.subscription_plans SET price_pence = 1999  WHERE product_id = 'unlimited_monthly';
UPDATE public.subscription_plans SET price_pence = 17999 WHERE product_id = 'unlimited_yearly';
UPDATE public.subscription_plans SET price_pence = 59999 WHERE product_id = 'unlimited_lifetime';
UPDATE public.subscription_plans SET price_pence = 34999 WHERE product_id = 'credit_lifetime';

-- ---------------------------------------------------------------------------
-- 2. Assertions — fail rather than leave the database and the client config
--    advertising different prices, which is the failure mode that matters here
--    (the client shows a price before anything is charged).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_um integer;
  v_uy integer;
  v_ul integer;
  v_cl integer;
  v_cm integer;
  v_cy integer;
BEGIN
  SELECT price_pence INTO v_um FROM public.subscription_plans WHERE product_id = 'unlimited_monthly';
  SELECT price_pence INTO v_uy FROM public.subscription_plans WHERE product_id = 'unlimited_yearly';
  SELECT price_pence INTO v_ul FROM public.subscription_plans WHERE product_id = 'unlimited_lifetime';
  SELECT price_pence INTO v_cl FROM public.subscription_plans WHERE product_id = 'credit_lifetime';
  SELECT price_pence INTO v_cm FROM public.subscription_plans WHERE product_id = 'credit_monthly';
  SELECT price_pence INTO v_cy FROM public.subscription_plans WHERE product_id = 'credit_yearly';

  IF v_um IS NULL OR v_uy IS NULL OR v_ul IS NULL OR v_cl IS NULL THEN
    RAISE EXCEPTION 'a repriced product is missing from subscription_plans';
  END IF;

  IF v_um <> 1999 OR v_uy <> 17999 OR v_ul <> 59999 OR v_cl <> 34999 THEN
    RAISE EXCEPTION 'reprice not applied: unlimited %, %, % credit-lifetime %', v_um, v_uy, v_ul, v_cl;
  END IF;

  -- Yearly has to beat monthly or there is no reason to sell it...
  IF v_uy >= v_um * 12 THEN
    RAISE EXCEPTION 'unlimited_yearly (%) is not cheaper than twelve months of monthly (%)', v_uy, v_um * 12;
  END IF;

  -- ...and lifetime has to cost more than a year, or everyone buys it instead.
  IF v_ul <= v_uy THEN
    RAISE EXCEPTION 'unlimited_lifetime (%) is not dearer than a year (%)', v_ul, v_uy;
  END IF;

  -- The Credit Plan is still the cheaper way in, per month, than the plan that
  -- hands over everything: a metered allowance has never been the premium tier.
  IF v_cm >= v_um THEN
    RAISE EXCEPTION 'credit_monthly (%) costs as much as unlimited_monthly (%)', v_cm, v_um;
  END IF;

  -- Nothing is free and nothing is a placeholder.
  IF v_cm <= 0 OR v_cy <= 0 THEN
    RAISE EXCEPTION 'a credit plan option is priced at or below zero';
  END IF;
END $$;
