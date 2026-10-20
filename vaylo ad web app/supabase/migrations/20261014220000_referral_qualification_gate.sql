-- ============================================================================
-- Referral rewards: paid-purchase qualification and guarded reward claims
-- ============================================================================
-- redeem_referral creates one pending claim and awards only the referee's
-- welcome credits. The referrer is paid only after a verified positive-price
-- purchase belonging to that referee is recorded in user_purchases.
--
-- provider_reference identifies a purchase transaction, not a person or
-- payment instrument. This migration makes no shared-payment-method claim and
-- does not collect raw payment details.
-- ============================================================================

INSERT INTO public.economy_config (key, region, ab_variant, value, active)
VALUES (
  'promo_bonuses', 'GLOBAL', 'default',
  '{"referral_referrer":15,"referral_referee":10,"referral_tier_3":25,"referral_tier_5":50,"referral_tier_10":125}',
  true
)
ON CONFLICT (key, region, ab_variant) DO UPDATE
  SET value = EXCLUDED.value, active = true, updated_at = now();

CREATE TABLE IF NOT EXISTS public.referral_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL UNIQUE REFERENCES public.referrals(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL UNIQUE REFERENCES public.user_purchases(id) ON DELETE CASCADE,
  product_kind text NOT NULL,
  transaction_reference_hash text NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_qualifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_qualifications FROM PUBLIC, anon, authenticated;

-- Redemption creates a pending attribution and pays only the invited athlete.
-- The referrer reward is settled by settle_referral after a provider-verified
-- positive-price purchase. Serialise referee claims so concurrent retries
-- cannot create duplicate attributions or award the welcome credits twice.
CREATE OR REPLACE FUNCTION public.redeem_referral(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_referrer uuid;
  v_referee_reward integer;
  v_referee_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  SELECT user_id INTO v_referrer
  FROM public.referral_codes
  WHERE code = upper(btrim(p_code));
  IF v_referrer IS NULL THEN RAISE EXCEPTION 'Invalid code'; END IF;
  IF v_referrer = v_user THEN RAISE EXCEPTION 'Cannot refer yourself'; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = v_user) THEN
    RAISE EXCEPTION 'Already referred';
  END IF;

  v_referee_reward := COALESCE(
    (public.economy_value('promo_bonuses') ->> 'referral_referee')::integer, 0);
  INSERT INTO public.referrals(referrer_id, referee_id, status, reward_granted_at)
  VALUES (v_referrer, v_user, 'pending', NULL);

  IF v_referee_reward > 0 THEN
    v_referee_result := public.credits_grant(
      v_user, v_referee_reward, 'Referral welcome credits', 'referral',
      'referral:referee:' || v_user::text, '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'referee_credits', v_referee_reward,
    'balance', COALESCE((v_referee_result ->> 'balance')::integer, NULL)
  );
END $$;
REVOKE ALL ON FUNCTION public.redeem_referral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_referral(text) TO authenticated;

-- Purchase transaction reference is hashed for minimized storage only. It is
-- not interpreted as a payment-method or identity fingerprint.
CREATE OR REPLACE FUNCTION public.settle_referral(
  p_referee uuid,
  p_purchase_id uuid,
  p_product_kind text,
  p_transaction_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_purchase_user uuid;
  v_purchase_price integer;
  v_purchase_reference text;
  v_referrer_reward integer;
  v_qualifying_count integer;
  v_tier text;
  v_tier_reward integer;
BEGIN
  IF p_referee IS NULL OR p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'settle_referral: referee and purchase required';
  END IF;

  SELECT * INTO v_referral
  FROM public.referrals
  WHERE referee_id = p_referee
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'why', 'no_referral'); END IF;
  IF v_referral.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'why', 'already_' || v_referral.status);
  END IF;

  SELECT user_id, price_cents, provider_reference
    INTO v_purchase_user, v_purchase_price, v_purchase_reference
  FROM public.user_purchases WHERE id = p_purchase_id;
  IF v_purchase_user IS DISTINCT FROM p_referee OR COALESCE(v_purchase_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Referral qualification requires the referee’s positive-price purchase';
  END IF;
  IF NULLIF(btrim(p_transaction_reference), '') IS NULL
     OR v_purchase_reference IS DISTINCT FROM p_transaction_reference THEN
    RAISE EXCEPTION 'Referral qualification requires the purchase’s verified transaction reference';
  END IF;

  INSERT INTO public.referral_qualifications(
    referral_id, purchase_id, product_kind, transaction_reference_hash, paid
  ) VALUES (
    v_referral.id, p_purchase_id, p_product_kind,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_transaction_reference, 'UTF8')), 'hex'), true
  );

  UPDATE public.referrals SET status = 'granted', reward_granted_at = now()
  WHERE id = v_referral.id;

  v_referrer_reward := COALESCE(
    (public.economy_value('promo_bonuses') ->> 'referral_referrer')::integer, 0);
  IF v_referrer_reward > 0 THEN
    PERFORM public.credits_grant(
      v_referral.referrer_id, v_referrer_reward,
      'A friend made their first purchase with your code', 'referral',
      'referral:referrer:' || v_referral.referee_id::text, '{}'::jsonb);
  END IF;

  SELECT count(*) INTO v_qualifying_count
  FROM public.referral_qualifications q
  JOIN public.referrals r ON r.id = q.referral_id
  WHERE q.paid AND r.referrer_id = v_referral.referrer_id;

  v_tier := CASE
    WHEN v_qualifying_count = 10 THEN 'tier_10'
    WHEN v_qualifying_count = 5 THEN 'tier_5'
    WHEN v_qualifying_count = 3 THEN 'tier_3'
  END;
  IF v_tier IS NOT NULL THEN
    v_tier_reward := COALESCE(
      (public.economy_value('promo_bonuses') ->> ('referral_' || v_tier))::integer, 0);
    IF v_tier_reward > 0 THEN
      PERFORM public.credits_grant(
        v_referral.referrer_id, v_tier_reward,
        'Referral milestone — ' || split_part(v_tier, '_', 2) || ' qualifying friends',
        'referral_' || v_tier,
        'referral:' || v_tier || ':' || v_referral.referrer_id::text, '{}'::jsonb);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'status', 'granted',
    'referrer_credits', v_referrer_reward, 'tier_bonus', v_tier);
END $$;
REVOKE ALL ON FUNCTION public.settle_referral(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_referral(uuid, uuid, text, text) TO service_role;

-- Historical client RPC accepted any positive promo_bonuses key. Close this
-- minting path entirely; referrals and win-back offers must use verified flows.
CREATE OR REPLACE FUNCTION public.credits_claim_reward(
  p_kind text,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Reward must be claimed through its verified server flow';
END $$;
REVOKE ALL ON FUNCTION public.credits_claim_reward(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_claim_reward(text, text, text) TO service_role;

-- redeem_referral runs with the caller's auth.uid() and must remain callable by
-- signed-in athletes; settlement and aggregate reads have separate privileges.
REVOKE ALL ON FUNCTION public.redeem_referral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_referral(text) TO authenticated, service_role;

-- Referrer sees only an aggregate of their own paid qualifications. The
-- parameter is intentionally checked against auth.uid() in the definer body.
CREATE OR REPLACE FUNCTION public.referral_qualification_count(p_referrer uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.referral_qualifications q
  JOIN public.referrals r ON r.id = q.referral_id
  WHERE r.referrer_id = auth.uid()
    AND p_referrer = auth.uid()
    AND q.paid;
$$;
REVOKE ALL ON FUNCTION public.referral_qualification_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_qualification_count(uuid) TO authenticated;

-- Rank only purchase-confirmed referrals. This reports a leaderboard, not a
-- prize promotion; any prize needs separate published competition terms and
-- an operator fulfillment process before being advertised.
CREATE OR REPLACE FUNCTION public.top_referrers(p_days integer DEFAULT 30)
RETURNS TABLE (
  rank bigint,
  referrer_id uuid,
  display_name text,
  referral_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    row_number() OVER (ORDER BY count(q.id) DESC, min(q.created_at) ASC)::bigint,
    r.referrer_id,
    COALESCE(a.display_name, 'Athlete'),
    count(q.id)::bigint
  FROM public.referrals r
  JOIN public.referral_qualifications q ON q.referral_id = r.id AND q.paid
  LEFT JOIN public.avatars a ON a.user_id = r.referrer_id
  WHERE q.created_at >= now() - make_interval(days => greatest(1, least(365, COALESCE(p_days, 30))))
  GROUP BY r.referrer_id, a.display_name
  ORDER BY count(q.id) DESC, min(q.created_at) ASC
  LIMIT 25;
$$;
GRANT EXECUTE ON FUNCTION public.top_referrers(integer) TO anon, authenticated;
