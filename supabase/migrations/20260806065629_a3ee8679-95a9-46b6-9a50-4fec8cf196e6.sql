-- 1. PLAN CATALOGUE ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_key text NOT NULL,
  product_id text NOT NULL UNIQUE,
  name text NOT NULL,
  billing_period text NOT NULL CHECK (billing_period IN ('month','year','lifetime')),
  price_pence integer NOT NULL CHECK (price_pence >= 0),
  currency text NOT NULL DEFAULT 'GBP',
  monthly_credit_allowance integer NOT NULL DEFAULT 0,
  unlimited_credits boolean NOT NULL DEFAULT false,
  is_lifetime boolean NOT NULL DEFAULT false,
  credit_rollover_limit integer NOT NULL DEFAULT 300,
  fair_usage_daily_ai_calls integer,
  best_value boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active plans" ON public.subscription_plans
  FOR SELECT USING (active = true);
CREATE POLICY "Admins manage plans" ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_subscription_plans_updated
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. FAIR USAGE -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fair_usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  feature text NOT NULL,
  units integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fair_usage_events_user_created_idx
  ON public.fair_usage_events (user_id, created_at DESC);

GRANT SELECT ON public.fair_usage_events TO authenticated;
GRANT ALL ON public.fair_usage_events TO service_role;

ALTER TABLE public.fair_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own fair usage" ON public.fair_usage_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. SUBSCRIPTION COLUMNS ---------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_key text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS billing_period text,
  ADD COLUMN IF NOT EXISTS monthly_credit_allowance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unlimited_credits boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_lifetime boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renews_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_refill_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refill_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_rollover_limit integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'none';

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON public.subscriptions (user_id);

-- 4. SEED THE TWO NEW PLANS -------------------------------------------------
INSERT INTO public.subscription_plans
  (plan_key, product_id, name, billing_period, price_pence, monthly_credit_allowance,
   unlimited_credits, is_lifetime, credit_rollover_limit, fair_usage_daily_ai_calls, best_value, sort_order)
VALUES
  ('credit','credit_monthly','Credit Plan','month',549,100,false,false,300,NULL,false,1),
  ('credit','credit_yearly','Credit Plan','year',5999,100,false,false,300,NULL,true,2),
  ('credit','credit_lifetime','Credit Plan','lifetime',12999,100,false,true,300,NULL,false,3),
  ('unlimited','unlimited_monthly','Unlimited Plan','month',899,0,true,false,0,400,false,4),
  ('unlimited','unlimited_yearly','Unlimited Plan','year',7999,0,true,false,0,400,true,5),
  ('unlimited','unlimited_lifetime','Unlimited Plan','lifetime',34999,0,true,true,0,400,false,6)
ON CONFLICT (product_id) DO NOTHING;

-- 5. MAP LEGACY PLANS ONTO THE NEW ENTITLEMENTS (non-destructive) -----------
UPDATE public.subscriptions s
SET plan_key = 'unlimited', unlimited_credits = true, product_id = COALESCE(product_id, 'legacy_' || s.plan_type)
WHERE s.status = 'active' AND s.plan_type IN ('premium','elite');

UPDATE public.subscriptions s
SET plan_key = 'credit',
    monthly_credit_allowance = GREATEST(s.monthly_credit_allowance, 100),
    product_id = COALESCE(product_id, 'legacy_' || s.plan_type),
    next_refill_at = COALESCE(s.next_refill_at, date_trunc('month', now()) + interval '1 month')
WHERE s.status = 'active' AND s.plan_type IN ('minimum','pro');

UPDATE public.subscriptions s
SET unlimited_credits = true, plan_key = 'unlimited'
WHERE EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.user_id = s.user_id AND p.infinite_credits = true
    AND (p.infinite_credits_until IS NULL OR p.infinite_credits_until > now())
);

-- 6. ENTITLEMENT READER -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_entitlements()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_credits integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('plan_key','free'); END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = v_user;
  SELECT credits INTO v_credits FROM public.profiles WHERE user_id = v_user;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('plan_key','free','status','free','credits',COALESCE(v_credits,0),
      'unlimited_credits',false,'monthly_credit_allowance',0,'is_lifetime',false);
  END IF;

  IF v_sub.status = 'active' AND NOT v_sub.is_lifetime
     AND v_sub.expires_at IS NOT NULL AND v_sub.expires_at < now() THEN
    v_sub.status := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'plan_key', CASE WHEN v_sub.status IN ('active','trial') OR v_sub.is_lifetime THEN v_sub.plan_key ELSE 'free' END,
    'status', v_sub.status,
    'billing_period', v_sub.billing_period,
    'product_id', v_sub.product_id,
    'credits', COALESCE(v_credits,0),
    'unlimited_credits', (v_sub.unlimited_credits AND (v_sub.status IN ('active','trial') OR v_sub.is_lifetime)),
    'monthly_credit_allowance', CASE WHEN v_sub.status IN ('active','trial') OR v_sub.is_lifetime THEN v_sub.monthly_credit_allowance ELSE 0 END,
    'credit_rollover_limit', v_sub.credit_rollover_limit,
    'is_lifetime', v_sub.is_lifetime,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'renews_at', v_sub.renews_at,
    'expires_at', v_sub.expires_at,
    'next_refill_at', v_sub.next_refill_at,
    'legacy_plan_type', v_sub.plan_type
  );
END $$;

-- 7. MONTHLY CREDIT REFILL (rollover-capped) --------------------------------
CREATE OR REPLACE FUNCTION public.apply_credit_refill(p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := COALESCE(p_user, auth.uid());
  v_sub public.subscriptions%ROWTYPE;
  v_current integer;
  v_target integer;
  v_added integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_user IS NOT NULL AND auth.uid() IS NOT NULL AND p_user <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = v_user FOR UPDATE;
  IF v_sub.id IS NULL OR v_sub.monthly_credit_allowance <= 0 THEN
    RETURN jsonb_build_object('refilled', false, 'reason', 'no_allowance');
  END IF;
  IF NOT (v_sub.status IN ('active','trial') OR v_sub.is_lifetime) THEN
    RETURN jsonb_build_object('refilled', false, 'reason', 'inactive');
  END IF;
  IF v_sub.next_refill_at IS NOT NULL AND v_sub.next_refill_at > now() THEN
    RETURN jsonb_build_object('refilled', false, 'reason', 'too_early', 'next_refill_at', v_sub.next_refill_at);
  END IF;

  SELECT credits INTO v_current FROM public.profiles WHERE user_id = v_user;
  -- rollover cap: unused credits carry over up to credit_rollover_limit
  v_target := LEAST(COALESCE(v_current,0), GREATEST(v_sub.credit_rollover_limit,0)) + v_sub.monthly_credit_allowance;
  v_added := v_target - COALESCE(v_current,0);

  IF v_added > 0 THEN
    PERFORM set_config('app.allow_credit_change','on',true);
    UPDATE public.profiles SET credits = v_target WHERE user_id = v_user;
    PERFORM set_config('app.allow_credit_change','off',true);
    INSERT INTO public.credit_transactions (user_id, amount, reason)
    VALUES (v_user, v_added, 'subscription-refill');
  END IF;

  UPDATE public.subscriptions
  SET last_refill_at = now(),
      next_refill_at = date_trunc('day', now()) + interval '1 month'
  WHERE user_id = v_user;

  RETURN jsonb_build_object('refilled', v_added > 0, 'added', v_added, 'credits', v_target,
    'next_refill_at', date_trunc('day', now()) + interval '1 month');
END $$;

-- 8. ACTIVATE / CANCEL (provider-agnostic; used by edge functions later) ----
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_user uuid, p_product_id text, p_provider text DEFAULT 'none', p_purchase_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_expires timestamptz;
  v_renews timestamptz;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'Missing user'; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE product_id = p_product_id AND active;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Unknown plan %', p_product_id; END IF;

  IF v_plan.billing_period = 'month' THEN v_expires := now() + interval '1 month';
  ELSIF v_plan.billing_period = 'year' THEN v_expires := now() + interval '1 year';
  ELSE v_expires := NULL; END IF;
  v_renews := v_expires;

  INSERT INTO public.subscriptions AS s (
    user_id, plan_type, plan_key, product_id, status, billing_period,
    monthly_credit_allowance, unlimited_credits, is_lifetime, credit_rollover_limit,
    started_at, expires_at, renews_at, next_refill_at, cancel_at_period_end,
    provider, purchase_token, cancelled_at
  ) VALUES (
    p_user, v_plan.plan_key, v_plan.plan_key, v_plan.product_id, 'active', v_plan.billing_period,
    v_plan.monthly_credit_allowance, v_plan.unlimited_credits, v_plan.is_lifetime, v_plan.credit_rollover_limit,
    now(), v_expires, v_renews,
    CASE WHEN v_plan.monthly_credit_allowance > 0 THEN now() ELSE NULL END, false,
    p_provider, p_purchase_token, NULL
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    plan_key = EXCLUDED.plan_key,
    product_id = EXCLUDED.product_id,
    status = 'active',
    billing_period = EXCLUDED.billing_period,
    monthly_credit_allowance = EXCLUDED.monthly_credit_allowance,
    unlimited_credits = EXCLUDED.unlimited_credits,
    is_lifetime = EXCLUDED.is_lifetime,
    credit_rollover_limit = EXCLUDED.credit_rollover_limit,
    expires_at = EXCLUDED.expires_at,
    renews_at = EXCLUDED.renews_at,
    next_refill_at = COALESCE(s.next_refill_at, EXCLUDED.next_refill_at),
    cancel_at_period_end = false,
    cancelled_at = NULL,
    provider = EXCLUDED.provider,
    purchase_token = COALESCE(EXCLUDED.purchase_token, s.purchase_token),
    updated_at = now();

  IF v_plan.unlimited_credits THEN
    UPDATE public.profiles
    SET infinite_credits = true,
        infinite_credits_until = CASE WHEN v_plan.is_lifetime THEN NULL ELSE v_expires END
    WHERE user_id = p_user;
  END IF;

  IF v_plan.monthly_credit_allowance > 0 THEN
    PERFORM public.apply_credit_refill(p_user);
  END IF;

  RETURN jsonb_build_object('ok', true, 'plan_key', v_plan.plan_key,
    'billing_period', v_plan.billing_period, 'expires_at', v_expires);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_my_subscription()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_user uuid := auth.uid(); v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = v_user FOR UPDATE;
  IF v_sub.id IS NULL THEN RAISE EXCEPTION 'No subscription'; END IF;
  IF v_sub.is_lifetime THEN RAISE EXCEPTION 'Lifetime ownership cannot be cancelled'; END IF;

  UPDATE public.subscriptions
  SET cancel_at_period_end = true, cancelled_at = now(), status = 'cancelled', updated_at = now()
  WHERE user_id = v_user;

  RETURN jsonb_build_object('ok', true, 'access_until', v_sub.expires_at);
END $$;

-- 9. FAIR USAGE CHECK -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_fair_usage(p_feature text, p_units integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_limit integer;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_units IS NULL OR p_units <= 0 OR p_units > 100 THEN RAISE EXCEPTION 'Invalid units'; END IF;

  SELECT p.fair_usage_daily_ai_calls INTO v_limit
  FROM public.subscriptions s
  JOIN public.subscription_plans p ON p.product_id = s.product_id
  WHERE s.user_id = v_user;

  INSERT INTO public.fair_usage_events (user_id, feature, units)
  VALUES (v_user, p_feature, p_units);

  SELECT COALESCE(SUM(units),0) INTO v_used FROM public.fair_usage_events
  WHERE user_id = v_user AND created_at > now() - interval '1 day';

  RETURN jsonb_build_object('used', v_used, 'limit', v_limit,
    'limited', (v_limit IS NOT NULL AND v_used > v_limit));
END $$;
