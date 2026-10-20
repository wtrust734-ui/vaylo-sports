-- ============================================================================
-- WEEKLY COIN DRIP — the earn path that makes cosmetics reachable without cash
-- ----------------------------------------------------------------------------
-- Research finding (§8.2 / §14-B): coins had no free inflow at all — sources
-- declared 'reward' but nothing granted them; the only paths were bundles and
-- credit conversion. This gives logged sessions a small, hard-capped weekly
-- drip (defaults: 60 coins per session, 300 coins per ISO week):
--
--   * economy_config keys, tunable without a deploy:
--       weekly_coins_per_session, weekly_coins_cap
--   * `claim_session_coins(log_id)` — the client calls it once per log, right
--     after the log insert succeeds. The RPC verifies the log belongs to the
--     caller, idempotency via `user_session_coin_grants`, and enforces the cap
--     from `coin_transactions` (reason prefix 'session-train'), server-side.
-- ============================================================================

INSERT INTO public.economy_config (key, region, ab_variant, value, active)
VALUES
  ('weekly_coins_per_session', 'GLOBAL', 'default', '60'::jsonb, true),
  ('weekly_coins_cap',         'GLOBAL', 'default', '300'::jsonb, true)
ON CONFLICT (key, region, ab_variant) DO UPDATE
  SET value = EXCLUDED.value, active = true;

-- ---------------------------------------------------------------------------
-- Idempotency ledger: one credit per log, ever.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_session_coin_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_id UUID NOT NULL REFERENCES public.performance_logs(id) ON DELETE CASCADE,
  granted INTEGER NOT NULL CHECK (granted >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_id)
);
-- Idempotency on the ledger alone is not concurrency-safe: two simultaneous
-- claims of the same log both pass the EXISTS check, then both add coins.
-- This unique index makes the second insert fail (caught below) instead.
GRANT SELECT ON public.user_session_coin_grants TO authenticated;
GRANT ALL ON public.user_session_coin_grants TO service_role;
ALTER TABLE public.user_session_coin_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_coin_gives_owner_read" ON public.user_session_coin_grants
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_session_coins(p_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rate integer := GREATEST(1, LEAST(500, COALESCE(
    (public.economy_value('weekly_coins_per_session'))::text::int, 60)));
  v_cap integer := GREATEST(v_rate, LEAST(10000, COALESCE(
    (public.economy_value('weekly_coins_cap'))::text::int, 300)));
  v_log_exists boolean;
  v_granted_week integer;
  v_award integer;
  v_new_coins integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_log_id IS NULL THEN RAISE EXCEPTION 'Log id required'; END IF;

  -- The log must belong to the caller (never trust a client-minted uuid).
  SELECT EXISTS (
    SELECT 1 FROM public.performance_logs
    WHERE id = p_log_id AND user_id = v_user
  ) INTO v_log_exists;
  IF NOT v_log_exists THEN RAISE EXCEPTION 'Unknown log'; END IF;

  -- Idempotency + concurrency: the ledger row is claimed first. On the UNIQUE
  -- (user_id, log_id) conflict another claim already credited this log —
  -- report, do not double-grant.
  BEGIN
    INSERT INTO public.user_session_coin_grants (user_id, log_id, granted)
    VALUES (v_user, p_log_id, 0);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'awarded', 0, 'already', true);
  END;

  -- Weekly window is the ISO week (Monday-based), matching the cap language.
  SELECT COALESCE(SUM(amount), 0) INTO v_granted_week
  FROM public.coin_transactions
  WHERE user_id = v_user
    AND reason LIKE 'session-train%'
    AND created_at >= date_trunc('week', now());

  v_award := LEAST(v_rate, v_cap - v_granted_week);

  -- Ledger row either way, so the log can never be replayed later for coins.
  UPDATE public.user_session_coin_grants
  SET granted = GREATEST(v_award, 0)
  WHERE user_id = v_user AND log_id = p_log_id;

  IF v_award <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'awarded', 0,
      'reason', 'weekly_cap_reached', 'weekly_total', v_granted_week, 'cap', v_cap);
  END IF;

  -- Guarded balance update (same contract as add_coins): the trigger
  -- `guard_profile_credits` blocks raw balance writes unless the flag is set.
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET coins = coins + v_award
  WHERE user_id = v_user RETURNING coins INTO v_new_coins;
  PERFORM set_config('app.allow_credit_change', 'off', true);
  IF v_new_coins IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  INSERT INTO public.coin_transactions (user_id, amount, reason)
  VALUES (v_user, v_award, 'session-train:' || p_log_id);

  RETURN jsonb_build_object(
    'ok', true, 'awarded', v_award,
    'weekly_total', v_granted_week + v_award, 'cap', v_cap
  );
END; $$;

REVOKE ALL ON FUNCTION public.claim_session_coins(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_session_coins(uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_session_coins(uuid) IS
  'Awards the capped weekly coin drip for one logged session. Idempotent per log; cap enforced server-side from coin_transactions.';
