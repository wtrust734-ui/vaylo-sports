-- Persist a per-user request fingerprint so successful video results are replayable
-- without charging again when a network retry reaches the Edge Function.
ALTER TABLE public.video_form_analyses
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS video_form_analyses_user_request_id_idx
  ON public.video_form_analyses (user_id, request_id)
  WHERE request_id IS NOT NULL;

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
     OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 2592000
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

  RETURN jsonb_build_object('allowed', true, 'duplicate', false, 'reservation_id', v_id, 'used', v_used + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_video_analysis_slot(uuid, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_video_analysis_slot(uuid, text, integer, integer, text) TO service_role;
