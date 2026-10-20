-- ============================================================================
-- PUSH TOKENS — real push delivery (4 October 2026)
-- ----------------------------------------------------------------------------
-- The app had a notifications table, a notification_prefs table and a prefs
-- screen, and no way for a notification to reach a phone. Nothing was ever
-- pushed: a challenge deadline, a streak about to break or a friend's new
-- activity only appeared if the athlete happened to open the app and look at
-- an in-app list.
--
-- This adds the missing half: one row per device that wants to be told.
--
-- The token is the whole security story, so the policies are deliberately
-- own-row only:
--   * an athlete can read, insert and delete their OWN registrations;
--   * no athlete can read anyone else's token, because a push token is a
--     delivery address, and knowing someone else's means you can push to their
--     phone. There is no "all tokens" select path for authenticated users.
--
-- Delivery itself never runs as a user. The sender edge function uses the
-- service role, which bypasses RLS, so no broad-access policy is needed here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The FCM registration token. Globally unique, not (user_id, token): one
  -- physical device must map to exactly one account, or a phone signed out of
  -- Alice and signed into Bob keeps delivering Alice's notifications.
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own push tokens" ON public.push_tokens;
CREATE POLICY "Own push tokens" ON public.push_tokens
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens(user_id);
-- The sender polls by token id to expire registrations; without this it is a
-- sequential scan of every device the service has ever seen.
CREATE INDEX IF NOT EXISTS idx_push_tokens_seen ON public.push_tokens(last_seen_at);

-- ---------------------------------------------------------------------------
-- claim_push_token(p_token, p_platform, p_app_version)
--
-- Handles the one case the own-row policies cannot: a device that previously
-- belonged to another athlete. The token is UNIQUE, so signing in as a second
-- account on the same phone would collide with a row the caller cannot see or
-- delete, and push would silently never work on that device again.
--
-- This function is SECURITY DEFINER for exactly that one delete. It can only
-- ever touch the row whose token is the one presented, and it only ever inserts
-- for the caller (auth.uid()). Possession of the token is the authorisation:
-- it is a per-install secret that the device's own Firebase SDK generated, so
-- whoever presents it is that device.
--
-- It deliberately does NOT return or accept any user id — the owner is always
-- the caller, which is what stops it being a "give me someone else's tokens"
-- primitive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_push_token(
  p_token text,
  p_platform text DEFAULT 'android',
  p_app_version text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'invalid push token';
  END IF;

  -- Only the exact token presented, never a wildcard or a prefix.
  DELETE FROM public.push_tokens WHERE token = btrim(p_token);

  INSERT INTO public.push_tokens (user_id, token, platform, app_version)
  VALUES (v_user, btrim(p_token), COALESCE(p_platform, 'android'), p_app_version)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_token(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_push_token(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.claim_push_token(text, text, text) IS
  'Registers the calling device''s push token, taking it over from a previous '
  'account on the same device. Owner is always auth.uid().';