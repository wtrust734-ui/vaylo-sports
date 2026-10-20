-- Serialize retries of the same uploaded video before quota reservations,
-- provider calls, or credit debits. Successful result replay remains backed by
-- video_form_analyses.request_id; processing claims expire to recover from a
-- crashed Edge Function.
CREATE TABLE IF NOT EXISTS public.video_analysis_request_claims (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (length(request_id) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  lease_expires_at timestamptz NOT NULL DEFAULT (now() + interval '20 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);

ALTER TABLE public.video_analysis_request_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_analysis_request_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.video_analysis_request_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_video_analysis_request(
  p_user_id uuid,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_lease timestamptz;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_request_id IS NULL OR p_request_id !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid video analysis request';
  END IF;

  INSERT INTO public.video_analysis_request_claims (user_id, request_id)
  VALUES (p_user_id, p_request_id)
  ON CONFLICT (user_id, request_id) DO NOTHING;

  SELECT status, lease_expires_at INTO v_status, v_lease
    FROM public.video_analysis_request_claims
   WHERE user_id = p_user_id AND request_id = p_request_id
   FOR UPDATE;

  IF v_status = 'completed' OR v_lease > now() THEN
    RETURN jsonb_build_object('claimed', false, 'duplicate', true, 'status', v_status);
  END IF;

  UPDATE public.video_analysis_request_claims
     SET status = 'processing', lease_expires_at = now() + interval '20 minutes'
   WHERE user_id = p_user_id AND request_id = p_request_id;

  IF random() < 0.02 THEN
    DELETE FROM public.video_analysis_request_claims
     WHERE status = 'completed' AND created_at < now() - interval '30 days';
  END IF;

  RETURN jsonb_build_object('claimed', true, 'duplicate', false, 'status', 'processing');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_video_analysis_request(
  p_user_id uuid,
  p_request_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.video_analysis_request_claims
     SET status = 'completed', lease_expires_at = now() + interval '30 days'
   WHERE user_id = p_user_id AND request_id = p_request_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_video_analysis_request(
  p_user_id uuid,
  p_request_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM public.video_analysis_request_claims
   WHERE user_id = p_user_id AND request_id = p_request_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_video_analysis_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_video_analysis_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_video_analysis_request(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_analysis_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_video_analysis_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_video_analysis_request(uuid, text) TO service_role;
