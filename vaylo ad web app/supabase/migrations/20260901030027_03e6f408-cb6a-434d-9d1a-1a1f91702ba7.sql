-- =====================================================================
-- PHASE 3 — CREDIT ECONOMY REBUILD
-- =====================================================================

-- 1. Transaction history enrichment ----------------------------------
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS feature text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS balance_after integer,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_idem_uniq
  ON public.credit_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_transactions_user_created_idx
  ON public.credit_transactions (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;

-- 2. Never allow negative balances -----------------------------------
UPDATE public.profiles SET credits = 0 WHERE credits < 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_credits_non_negative') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_credits_non_negative CHECK (credits >= 0);
  END IF;
END $$;

-- 3. Central economy configuration -----------------------------------
GRANT SELECT ON public.economy_config TO authenticated, anon;
GRANT ALL ON public.economy_config TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='economy_config' AND policyname='Admins manage economy config'
  ) THEN
    CREATE POLICY "Admins manage economy config" ON public.economy_config
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

INSERT INTO public.economy_config (key, region, ab_variant, value, active)
VALUES
  ('starting_credits', 'GLOBAL', 'default', '20'::jsonb, true),
  ('monthly_allowance', 'GLOBAL', 'default', '{"credit_plan":100,"rollover_limit":300}'::jsonb, true),
  ('promo_bonuses', 'GLOBAL', 'default', '{"referral_referrer":15,"referral_referee":10,"arcade_record":10,"winback":20}'::jsonb, true),
  ('daily_rewards', 'GLOBAL', 'default', '{"day1":2,"day2":3,"day3":4,"day4":5,"day5":6,"day6":8,"day7":12}'::jsonb, true),
  ('feature_costs', 'GLOBAL', 'default', '{
     "archetype_view":19,
     "development_trajectory":5,
     "cross_sport_unlock":19,
     "training_plan_week":5,
     "limiter_fix_plan":24,
     "form_analysis_unlock":54,
     "video_form_analysis":12,
     "injury_management_unlock":29,
     "calorie_scan":10,
     "nutrition_plan_week":4,
     "nutrition_pack_unlock":39,
     "mental_gym_unlock":39,
     "vaylo_coach_message":3,
     "tactical_prep":5,
     "learning_unlock":29,
     "streak_shield":3
   }'::jsonb, true)
ON CONFLICT (key, region, ab_variant) DO UPDATE
  SET value = EXCLUDED.value, active = true
  WHERE public.economy_config.key IN ('starting_credits','monthly_allowance','promo_bonuses','daily_rewards','feature_costs');

-- 4. Config readers ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.economy_value(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value FROM public.economy_config
  WHERE key = p_key AND active = true AND region = 'GLOBAL'
    AND COALESCE(ab_variant, 'default') = 'default'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.starting_credits()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.economy_value('starting_credits'))::text::integer, 20)
$$;

CREATE OR REPLACE FUNCTION public.credit_cost(p_feature text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  v := public.economy_value('feature_costs');
  IF v IS NULL OR v -> p_feature IS NULL THEN
    RAISE EXCEPTION 'Unknown credit feature: %', p_feature;
  END IF;
  RETURN (v ->> p_feature)::integer;
END $$;

GRANT EXECUTE ON FUNCTION public.economy_value(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.starting_credits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_cost(text) TO authenticated;

-- 5. Unlimited-plan check --------------------------------------------
CREATE OR REPLACE FUNCTION public.has_unlimited_credits(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user
      AND COALESCE(s.unlimited_credits, false) = true
      AND s.status IN ('active','trialing','renewing','lifetime')
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_unlimited_credits(uuid) TO authenticated;

-- 6. THE shared spend routine ----------------------------------------
CREATE OR REPLACE FUNCTION public.credits_spend(
  p_feature text,
  p_reason text DEFAULT NULL,
  p_quantity integer DEFAULT 1,
  p_source text DEFAULT 'app',
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_unit integer;
  v_cost integer;
  v_current integer;
  v_new integer;
  v_unlimited boolean;
  v_existing public.credit_transactions;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

  -- duplicate protection
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.credit_transactions
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true,
        'cost', abs(v_existing.amount), 'balance', v_existing.balance_after, 'unlimited', false);
    END IF;
  END IF;

  v_unit := public.credit_cost(p_feature);
  v_cost := v_unit * p_quantity;
  v_unlimited := public.has_unlimited_credits(v_user);

  SELECT credits INTO v_current FROM public.profiles WHERE user_id = v_user FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF v_unlimited OR v_cost = 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, feature, source, balance_after, idempotency_key, metadata)
    VALUES (v_user, 0, COALESCE(p_reason, p_feature), p_feature,
            CASE WHEN v_unlimited THEN 'unlimited_plan' ELSE p_source END,
            v_current, p_idempotency_key, COALESCE(p_metadata,'{}'::jsonb));
    RETURN jsonb_build_object('success', true, 'duplicate', false, 'cost', 0,
      'balance', v_current, 'unlimited', v_unlimited);
  END IF;

  IF v_current < v_cost THEN
    RETURN jsonb_build_object('success', false, 'duplicate', false, 'error', 'insufficient_credits',
      'cost', v_cost, 'balance', v_current, 'shortfall', v_cost - v_current, 'unlimited', false);
  END IF;

  v_new := v_current - v_cost;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET credits = v_new WHERE user_id = v_user;
  PERFORM set_config('app.allow_credit_change', 'off', true);

  INSERT INTO public.credit_transactions (user_id, amount, reason, feature, source, balance_after, idempotency_key, metadata)
  VALUES (v_user, -v_cost, COALESCE(p_reason, p_feature), p_feature, p_source, v_new,
          p_idempotency_key, COALESCE(p_metadata,'{}'::jsonb));

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'cost', v_cost,
    'balance', v_new, 'unlimited', false);
END $$;
GRANT EXECUTE ON FUNCTION public.credits_spend(text, text, integer, text, text, jsonb) TO authenticated;

-- 7. THE shared grant routine ----------------------------------------
CREATE OR REPLACE FUNCTION public.credits_grant(
  p_user uuid,
  p_amount integer,
  p_reason text,
  p_source text DEFAULT 'grant',
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current integer;
  v_new integer;
  v_existing public.credit_transactions;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'Missing user'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.credit_transactions
    WHERE user_id = p_user AND idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true,
        'granted', v_existing.amount, 'balance', v_existing.balance_after);
    END IF;
  END IF;

  SELECT credits INTO v_current FROM public.profiles WHERE user_id = p_user FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  v_new := v_current + p_amount;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET credits = v_new WHERE user_id = p_user;
  PERFORM set_config('app.allow_credit_change', 'off', true);

  INSERT INTO public.credit_transactions (user_id, amount, reason, source, balance_after, idempotency_key, metadata)
  VALUES (p_user, p_amount, p_reason, p_source, v_new, p_idempotency_key, COALESCE(p_metadata,'{}'::jsonb));

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'granted', p_amount, 'balance', v_new);
END $$;
REVOKE ALL ON FUNCTION public.credits_grant(uuid, integer, text, text, text, jsonb) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.credits_grant(uuid, integer, text, text, text, jsonb) TO service_role;

-- Self-serve reward grants (arcade / referral / promo) — capped
CREATE OR REPLACE FUNCTION public.credits_claim_reward(
  p_kind text,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_amount integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_amount := COALESCE((public.economy_value('promo_bonuses') ->> p_kind)::integer, 0);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Unknown or disabled reward: %', p_kind; END IF;
  IF v_amount > 50 THEN v_amount := 50; END IF;
  RETURN public.credits_grant(v_user, v_amount, COALESCE(p_reason, p_kind), 'reward:' || p_kind, p_idempotency_key);
END $$;
GRANT EXECUTE ON FUNCTION public.credits_claim_reward(text, text, text) TO authenticated;

-- 8. Legacy wrappers delegate to the shared routines -----------------
CREATE OR REPLACE FUNCTION public.spend_credits(p_amount integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_current integer;
  v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;

  SELECT credits INTO v_current FROM public.profiles WHERE user_id = v_user FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF public.has_unlimited_credits(v_user) THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, source, balance_after)
    VALUES (v_user, 0, p_reason, 'unlimited_plan', v_current);
    RETURN v_current;
  END IF;

  IF v_current < p_amount THEN RAISE EXCEPTION 'Insufficient credits'; END IF;

  v_new := v_current - p_amount;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET credits = v_new WHERE user_id = v_user;
  PERFORM set_config('app.allow_credit_change', 'off', true);

  INSERT INTO public.credit_transactions (user_id, amount, reason, source, balance_after)
  VALUES (v_user, -p_amount, p_reason, 'legacy', v_new);

  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.add_credits(p_amount integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF p_amount > 50 THEN RAISE EXCEPTION 'Amount exceeds allowed limit'; END IF;
  v_res := public.credits_grant(auth.uid(), p_amount, p_reason, 'legacy');
  RETURN (v_res ->> 'balance')::integer;
END $$;

GRANT EXECUTE ON FUNCTION public.spend_credits(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(integer, text) TO authenticated;

-- 9. Starter credits from config -------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start integer := public.starting_credits();
BEGIN
  INSERT INTO public.profiles (user_id, credits) VALUES (NEW.id, v_start);
  INSERT INTO public.subscriptions (user_id, plan_type, status) VALUES (NEW.id, 'free', 'free');
  INSERT INTO public.credit_transactions (user_id, amount, reason, source, balance_after, idempotency_key)
  VALUES (NEW.id, v_start, 'Starter credits', 'starter', v_start, 'starter:' || NEW.id::text);
  RETURN NEW;
END $$;

ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 20;