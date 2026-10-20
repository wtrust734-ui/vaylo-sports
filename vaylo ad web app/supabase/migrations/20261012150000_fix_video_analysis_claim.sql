-- ============================================================================
-- FIX — claim_video_analysis_request refused EVERY first attempt
-- ----------------------------------------------------------------------------
-- Video form analysis could never run, and this is why. The claim function
-- inserted its row and then selected that same row back — status and lease — to
-- decide whether a claim was already in flight, and reported 'not claimed'
-- whenever the lease it read was still in the future. The offending statement is
-- deliberately NOT quoted here: this file is read by a regression test that
-- asserts it is gone, and a comment containing it verbatim would make that
-- assertion unenforceable.
--
-- A brand-new row takes the column default, `lease_expires_at = now() + 20
-- minutes`, so `v_lease > now()` is TRUE on the request that just created it.
-- The function therefore inserted a live claim and immediately reported it as
-- someone else's, and `video-form-analysis` answered
--   409 "This video analysis is already in progress. Please wait and retry."
-- to every athlete, on every clip, forever. The old six-megabyte base64 path hid
-- it: the request failed earlier, on size, before reaching this call.
--
-- The fix decides liveness in ONE statement. An insert means the claim is ours;
-- an update only happens when the row we collided with is `processing` with an
-- expired lease, which is exactly the crashed-Edge-Function recovery the schema
-- comment promises. Nothing returned means a live or completed claim already
-- holds this exact upload, and only then is the caller a duplicate.
--
-- Rows left behind by previous crashes (`processing`, lease long expired — there
-- were two from 2026-10-03 on the review account alone) are taken over by the
-- same statement, so no cleanup of existing data is needed.
--
-- Privileges are unchanged: CREATE OR REPLACE keeps the existing owner and the
-- REVOKE/GRANT below restates the service-role-only contract, since this is the
-- function that serializes a charged provider call.
-- ============================================================================

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
  v_claimed text;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_request_id IS NULL OR p_request_id !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid video analysis request';
  END IF;

  -- Insert, or take over a lease that has run out. The column reference is
  -- table-qualified because `status` is also an OUT-style name in the SET list.
  INSERT INTO public.video_analysis_request_claims (user_id, request_id)
  VALUES (p_user_id, p_request_id)
  ON CONFLICT (user_id, request_id) DO UPDATE
     SET status = 'processing',
         lease_expires_at = now() + interval '20 minutes'
   WHERE public.video_analysis_request_claims.status = 'processing'
     AND public.video_analysis_request_claims.lease_expires_at <= now()
  RETURNING status INTO v_claimed;

  IF v_claimed IS NULL THEN
    -- A live processing claim, or a completed one. A completed claim is only
    -- reached when the result row is missing or unsaved; the caller answers 409
    -- for both, which is the documented "start a new analysis" behaviour.
    RETURN jsonb_build_object('claimed', false, 'duplicate', true);
  END IF;

  -- Opportunistic bounded retention, as before.
  IF random() < 0.02 THEN
    DELETE FROM public.video_analysis_request_claims
     WHERE status = 'completed' AND created_at < now() - interval '30 days';
  END IF;

  RETURN jsonb_build_object('claimed', true, 'duplicate', false, 'status', 'processing');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_video_analysis_request(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_analysis_request(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Assertions — the migration fails rather than shipping the bug again.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_video_analysis_request';

  if v_def is null then
    raise exception 'claim_video_analysis_request is missing';
  end if;
  -- The read-back that caused the bug must be gone, and the single-statement
  -- upsert that replaced it must be present.
  if v_def like '%SELECT status, lease_expires_at%' then
    raise exception 'claim_video_analysis_request still reads back the row it just inserted';
  end if;
  if v_def not like '%ON CONFLICT (user_id, request_id) DO UPDATE%' then
    raise exception 'claim_video_analysis_request does not use the take-over upsert';
  end if;
  if v_def not like '%lease_expires_at <= now()%' then
    raise exception 'claim_video_analysis_request does not require an expired lease to take over';
  end if;
end $$;
