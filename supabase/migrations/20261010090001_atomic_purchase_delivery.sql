-- Only a completed transaction is proof that a purchase was delivered.
CREATE TABLE public.purchase_deliveries (
  delivery_key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.purchase_deliveries TO service_role;

-- Items are resolved from the server catalog after store verification or the
-- explicit free-testing gate. Clients have no execution privilege here.
CREATE OR REPLACE FUNCTION public.deliver_purchase(
  p_user uuid, p_key text, p_items jsonb, p_reference text DEFAULT NULL, p_platform text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prior public.purchase_deliveries;
  v_item jsonb;
  v_profile public.profiles;
  v_cost integer;
  v_credits integer := 0;
  v_bonus integer := 0;
  v_coins integer := 0;
  v_infinite boolean := false;
  v_period text;
  v_until timestamptz;
  v_result jsonb;
BEGIN
  IF p_user IS NULL OR p_key IS NULL OR p_key = '' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid delivery';
  END IF;
  -- Serialize retries even when a token is presented by different accounts.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));
  SELECT * INTO v_prior FROM public.purchase_deliveries WHERE delivery_key = p_key;
  IF FOUND THEN
    IF v_prior.user_id <> p_user THEN RAISE EXCEPTION 'Receipt belongs to another account'; END IF;
    -- The token is already verified against the requested product by the edge.
    IF (SELECT jsonb_agg(x->>'product_id' ORDER BY x->>'product_id') FROM jsonb_array_elements(v_prior.items) x)
       IS DISTINCT FROM (SELECT jsonb_agg(x->>'product_id' ORDER BY x->>'product_id') FROM jsonb_array_elements(p_items) x) THEN
      RAISE EXCEPTION 'Receipt product mismatch';
    END IF;
    RETURN v_prior.result || jsonb_build_object('duplicate', true);
  END IF;
  -- Old purchase rows have no atomic delivery proof. Leave them for explicit
  -- reconciliation rather than guessing whether credits/coins already landed.
  IF p_reference IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_purchases WHERE provider_reference = p_reference) THEN
    RAISE EXCEPTION 'Legacy receipt requires reconciliation';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_id', '') = '' OR
       (v_item->>'price_cents')::integer < 0 OR (v_item->>'credits')::integer < 0 OR
       (v_item->>'bonus')::integer < 0 OR (v_item->>'coins')::integer < 0 THEN
      RAISE EXCEPTION 'Invalid grant';
    END IF;
    IF (v_item->>'one_time')::boolean AND EXISTS (
      SELECT 1 FROM public.user_purchases WHERE user_id = p_user AND product_id = v_item->>'product_id'
    ) THEN RAISE EXCEPTION 'Product already owned'; END IF;

    IF v_item->>'feature_key' IS NOT NULL THEN
      v_cost := public.credit_cost(v_item->>'feature_key');
      IF NOT (COALESCE(v_profile.infinite_credits, false) AND (v_profile.infinite_credits_until IS NULL OR v_profile.infinite_credits_until > now())) THEN
        IF v_profile.credits < v_cost THEN RAISE EXCEPTION 'Insufficient credits'; END IF;
        v_profile.credits := v_profile.credits - v_cost;
        PERFORM set_config('app.allow_credit_change', 'on', true);
        UPDATE public.profiles SET credits = v_profile.credits WHERE user_id = p_user;
        PERFORM set_config('app.allow_credit_change', 'off', true);
        INSERT INTO public.credit_transactions(user_id, amount, reason, feature, source, balance_after)
          VALUES (p_user, -v_cost, 'Unlock: ' || (v_item->>'product_id'), v_item->>'feature_key', 'purchase', v_profile.credits);
      END IF;
    END IF;
    INSERT INTO public.user_purchases(user_id, product_id, product_type, price_cents, provider_reference, platform)
      VALUES (p_user, v_item->>'product_id', v_item->>'product_type', (v_item->>'price_cents')::integer, p_reference, p_platform);
    v_credits := v_credits + (v_item->>'credits')::integer;
    v_bonus := v_bonus + (v_item->>'bonus')::integer;
    v_coins := v_coins + (v_item->>'coins')::integer;
    v_period := v_item->>'unlimited_period';
    IF v_period IS NOT NULL THEN
      IF v_period NOT IN ('month', 'year', 'lifetime') THEN RAISE EXCEPTION 'Invalid Unlimited period'; END IF;
      v_until := CASE v_period WHEN 'lifetime' THEN NULL WHEN 'year' THEN now() + interval '365 days' ELSE now() + interval '30 days' END;
      PERFORM public.grant_infinite_credits(p_user, v_until);
      v_infinite := true;
    END IF;
  END LOOP;
  IF v_credits + v_bonus > 0 THEN
    PERFORM public.credits_grant(p_user, v_credits + v_bonus, 'Pack purchase', 'purchase', p_key,
      jsonb_build_object('credits', v_credits, 'bonus', v_bonus));
  END IF;
  IF v_coins > 0 THEN PERFORM public.grant_coins(p_user, v_coins, 'Coin bundle'); END IF;
  v_result := jsonb_build_object('success', true, 'credits_added', v_credits, 'bonus_added', v_bonus, 'coins_added', v_coins, 'infinite', v_infinite);
  INSERT INTO public.purchase_deliveries(delivery_key, user_id, items, result) VALUES (p_key, p_user, p_items, v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.deliver_purchase(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_purchase(uuid, text, jsonb, text, text) TO service_role;
