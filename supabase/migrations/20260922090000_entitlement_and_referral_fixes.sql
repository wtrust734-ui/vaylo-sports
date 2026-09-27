-- ============================================================================
-- App audit fixes — entitlements + referrals (2026-09-22)
-- ----------------------------------------------------------------------------
-- Two defects found while auditing the app. Both are money-adjacent, both are
-- fixed here in the database (the only place either can be fixed safely).
--
--   1. Entitlements were client-forgeable. `user_purchases` granted INSERT to
--      `authenticated` with a `auth.uid() = user_id` check, and Injury.tsx was
--      the one place that used it: it spent the credits, then inserted the
--      entitlement from the browser and IGNORED the insert result. So any
--      signed-in athlete could insert `{product_id: 'injury_management'}` —
--      or any other product id — and unlock paid features without paying.
--      The page now goes through process-purchase (service role), and the
--      client write path is closed below.
--
--   2. Referral rewards were never paid. `redeem_referral()` recorded the
--      attribution as status 'granted' with `reward_granted_at = now()` but
--      granted nothing at all. The rates already exist in
--      economy_config.promo_bonuses (referral_referrer / referral_referee), so
--      this now pays both sides through the shared `credits_grant` routine.
--
-- Nothing here drops data, changes a balance, or alters an existing row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Entitlements are granted server-side only
-- ---------------------------------------------------------------------------
-- Verified before changing: the only client-side insert into `user_purchases`
-- was the Injury unlock, which now calls process-purchase (service role). Every
-- other reference in src/ is a SELECT. Service role keeps full access, so the
-- edge functions are unaffected.
DROP POLICY IF EXISTS "Users can insert own purchases" ON public.user_purchases;
REVOKE INSERT ON public.user_purchases FROM authenticated, anon;

COMMENT ON TABLE public.user_purchases IS
  'Entitlement + purchase ledger. Rows are written ONLY by server-side code '
  '(process-purchase / manage-subscription edge functions, service role) — '
  'clients have SELECT-only so entitlements cannot be forged.';

-- ---------------------------------------------------------------------------
-- 2. Referrals pay the configured rewards
-- ---------------------------------------------------------------------------
-- Same function signature and same errors as before, so Referrals.tsx needs no
-- change to keep working. Rewards come from economy_config, never from the
-- client. Idempotency keys are derived from the referee id, and `referrals.
-- referee_id` is UNIQUE, so a given athlete can only ever trigger one payout —
-- a retry or a replay returns the recorded transaction instead of paying again.
CREATE OR REPLACE FUNCTION public.redeem_referral(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_referrer uuid;
  v_existing uuid;
  v_referrer_reward integer;
  v_referee_reward integer;
  v_referee_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = upper(p_code);
  IF v_referrer IS NULL THEN RAISE EXCEPTION 'Invalid code'; END IF;
  IF v_referrer = v_user THEN RAISE EXCEPTION 'Cannot refer yourself'; END IF;

  SELECT id INTO v_existing FROM public.referrals WHERE referee_id = v_user;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Already referred'; END IF;

  v_referrer_reward := COALESCE((public.economy_value('promo_bonuses') ->> 'referral_referrer')::integer, 0);
  v_referee_reward  := COALESCE((public.economy_value('promo_bonuses') ->> 'referral_referee')::integer, 0);

  INSERT INTO public.referrals(referrer_id, referee_id, status, reward_granted_at)
  VALUES (v_referrer, v_user, 'granted', now());

  -- Pay the new athlete first: they are the one waiting on the screen.
  IF v_referee_reward > 0 THEN
    v_referee_result := public.credits_grant(
      v_user, v_referee_reward, 'Referral bonus', 'referral',
      'referral:referee:' || v_user::text, '{}'::jsonb);
  END IF;

  IF v_referrer_reward > 0 THEN
    PERFORM public.credits_grant(
      v_referrer, v_referrer_reward, 'A friend joined with your referral code', 'referral',
      'referral:referrer:' || v_user::text, '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'referrer', v_referrer,
    'referee_credits', v_referee_reward,
    'referrer_credits', v_referrer_reward,
    'balance', COALESCE((v_referee_result ->> 'balance')::integer, NULL)
  );
END $$;

-- Unchanged exposure: signed-in athletes only, never anon.
REVOKE ALL ON FUNCTION public.redeem_referral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_referral(text) TO authenticated;
