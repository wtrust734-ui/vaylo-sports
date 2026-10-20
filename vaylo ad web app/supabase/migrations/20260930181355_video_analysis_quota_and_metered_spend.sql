-- ============================================================================
-- VIDEO ANALYSIS ECONOMICS — ATOMIC QUOTAS + NON-EXEMPT METERED DEBITS
-- ============================================================================
-- ----------------------------------------------------------------------------
-- One Flash analysis per free athlete per seven days. Subscribed/lifetime plans
-- receive at most ten Pro analyses per rolling 30 days; after that their Flash
-- analyses cost the configured video_form_analysis credit price. Reservation
-- rows are independent of visible analysis history, so deleting history cannot
-- reset the free allowance. A per-user/tier advisory lock makes the quota atomic
-- when two uploads arrive at once.
--
-- `credits_spend()` intentionally treats unlimited subscriptions as free. That
-- is correct for most app features but would leave a costly Gemini route
-- unmetered after its Pro allowance. This server-only RPC uses the same
-- authoritative economy price and ledger but explicitly does not exempt an
-- unlimited plan. Only Edge Functions holding the service-role credential can
-- choose this billing path; the browser cannot call it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.video_analysis_quota_reservations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('free', 'premium')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'committed', 'released'))
);

CREATE INDEX IF NOT EXISTS video_analysis_quota_user_window_idx
  ON public.video_analysis_quota_reservations (user_id, tier, expires_at DESC)
  WHERE status IN ('reserved', 'committed');
CREATE UNIQUE INDEX IF NOT EXISTS video_analysis_quota_idempotency_idx
  ON public.video_analysis_quota_reservations (user_id, tier, idempotency_key);

ALTER TABLE public.video_analysis_quota_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_analysis_quota_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.video_analysis_quota_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_video_analysis_slot(
  p_user_id uuid,
  p_tier text,
  p_limit integer,
  p_window_seconds integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
  v_id bigint;
  v_existing_status text;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_tier IS NULL OR p_tier NOT IN ('free', 'premium')
     OR p_limit IS NULL OR p_limit < 1 OR p_window_seconds IS NULL
     OR p_window_seconds < 1 OR p_window_seconds > 2592000
     OR NULLIF(p_idempotency_key, '') IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'Invalid video quota request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_tier, 0));

  SELECT id, status INTO v_id, v_existing_status
    FROM public.video_analysis_quota_reservations
   WHERE user_id = p_user_id AND tier = p_tier AND idempotency_key = p_idempotency_key;

  IF v_id IS NOT NULL AND v_existing_status = 'reserved' THEN
    RETURN jsonb_build_object('allowed', false, 'duplicate', true, 'reservation_id', v_id);
  ELSIF v_id IS NOT NULL AND v_existing_status = 'committed' THEN
    RETURN jsonb_build_object('allowed', false, 'duplicate', false, 'reservation_id', NULL);
  END IF;

  SELECT count(*)::integer INTO v_used
    FROM public.video_analysis_quota_reservations
   WHERE user_id = p_user_id
     AND tier = p_tier
     AND status IN ('reserved', 'committed')
     AND expires_at > now()
     AND reserved_at > now() - make_interval(secs => p_window_seconds);

  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'duplicate', false, 'reservation_id', NULL, 'used', v_used);
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.video_analysis_quota_reservations (user_id, tier, expires_at, idempotency_key)
    VALUES (p_user_id, p_tier, now() + make_interval(secs => p_window_seconds), p_idempotency_key)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.video_analysis_quota_reservations
       SET status = 'reserved', reserved_at = now(),
           expires_at = now() + make_interval(secs => p_window_seconds)
     WHERE id = v_id;
  END IF;

  -- Opportunistic bounded retention; expired quota history is no longer needed.
  IF random() < 0.02 THEN
    DELETE FROM public.video_analysis_quota_reservations
     WHERE expires_at < now() - interval '30 days';
  END IF;

  RETURN jsonb_build_object('allowed', true, 'duplicate', false, 'reservation_id', v_id, 'used', v_used + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_video_analysis_slot(p_reservation_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.video_analysis_quota_reservations
     SET status = 'committed'
   WHERE id = p_reservation_id AND status = 'reserved';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_video_analysis_slot(p_reservation_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.video_analysis_quota_reservations
     SET status = 'released'
   WHERE id = p_reservation_id AND status = 'reserved';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_video_analysis_slot(uuid, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_video_analysis_slot(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_video_analysis_slot(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_video_analysis_slot(uuid, text, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_video_analysis_slot(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_video_analysis_slot(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.credits_spend_metered(
  p_user_id uuid,
  p_feature text,
  p_reason text,
  p_source text,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit integer;
  v_current integer;
  v_new integer;
  v_existing public.credit_transactions;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR NULLIF(p_feature, '') IS NULL
     OR NULLIF(p_idempotency_key, '') IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'Invalid metered spend request';
  END IF;

  -- Serialize per-user before checking idempotency so concurrent retries cannot
  -- both miss the ledger row and then race the unique transaction constraint.
  -- The unique ledger key serializes duplicate request attempts independently
  -- of the profile lock; take both locks in a consistent order (user row first).
  SELECT credits INTO v_current
    FROM public.profiles
   WHERE user_id = p_user_id
   FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  SELECT * INTO v_existing
    FROM public.credit_transactions
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'duplicate', true, 'cost', abs(v_existing.amount),
      'balance', v_current, 'unlimited', false
    );
  END IF;

  v_unit := public.credit_cost(p_feature);
  IF v_unit <= 0 THEN RAISE EXCEPTION 'Invalid configured credit cost'; END IF;

  IF v_current < v_unit THEN
    RETURN jsonb_build_object(
      'success', false, 'duplicate', false, 'error', 'insufficient_credits',
      'cost', v_unit, 'balance', v_current, 'shortfall', v_unit - v_current,
      'unlimited', false
    );
  END IF;

  -- credits_spend_metered only runs under the service role, so serialize all
  -- debits to this user's profile before touching the protected credits column.
  v_new := v_current - v_unit;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET credits = v_new WHERE user_id = p_user_id;
  PERFORM set_config('app.allow_credit_change', 'off', true);

  INSERT INTO public.credit_transactions (
    user_id, amount, reason, feature, source, balance_after, idempotency_key, metadata
  ) VALUES (
    p_user_id, -v_unit, COALESCE(p_reason, p_feature), p_feature,
    COALESCE(p_source, 'edge'), v_new, p_idempotency_key,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('unlimited_plan_metered', true)
  );

  RETURN jsonb_build_object(
    'success', true, 'duplicate', false, 'cost', v_unit,
    'balance', v_new, 'unlimited', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.credits_spend_metered(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_spend_metered(uuid, text, text, text, text, jsonb) TO service_role;
