-- Security & integrity fixes (app audit, 2026-09-21)
--
-- Closes three abuse vectors that any authenticated user could reach from the
-- browser with the public anon key:
--   1. self-minting credits via the legacy add_credits() wrapper
--   2. unlimited reward claiming via credits_claim_reward()
--   3. leaderboard inflation via award_points() / direct points_events inserts
--   4. friend-code enumeration via a table-wide SELECT policy
--
-- Every change preserves the flows the app actually uses (verified in code).

-- ---------------------------------------------------------------------------
-- 1. Credits — stop self-minting
-- ---------------------------------------------------------------------------
-- add_credits() was an arcade-era wrapper: EXECUTE-able by `authenticated`,
-- capped at only 50 per call, with no rate limit. The client never calls it
-- (verified: no reference in src/), so revoking is safe. SECURITY DEFINER
-- callers and service_role keep working.
REVOKE ALL ON FUNCTION public.add_credits(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(integer, text) TO service_role;

-- recompute_user_segment(uuid) accepted an arbitrary user id from the client
-- and is not used by the app client at all.
REVOKE ALL ON FUNCTION public.recompute_user_segment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_user_segment(uuid) TO service_role;

-- credits_claim_reward() stays available (arcade / promo / referral rewards)
-- but gains a rolling 24h ceiling so the per-call cap can't be looped.
CREATE OR REPLACE FUNCTION public.credits_claim_reward(
  p_kind text,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_amount integer;
  v_claimed_24h integer;
  v_cap constant integer := 150;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_amount := COALESCE((public.economy_value('promo_bonuses') ->> p_kind)::integer, 0);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Unknown or disabled reward: %', p_kind; END IF;
  IF v_amount > 50 THEN v_amount := 50; END IF;

  -- Rolling 24h ceiling on self-served rewards (purchases/subscriptions are
  -- granted server-side via credits_grant and are NOT counted here).
  SELECT COALESCE(SUM(amount), 0) INTO v_claimed_24h
    FROM public.credit_transactions
   WHERE user_id = v_user
     AND amount > 0
     AND source LIKE 'reward:%'
     AND created_at > now() - interval '24 hours';

  IF v_claimed_24h + v_amount > v_cap THEN
    RAISE EXCEPTION 'Daily reward limit reached (% credits per 24h). Try again later.', v_cap;
  END IF;

  RETURN public.credits_grant(v_user, v_amount, COALESCE(p_reason, p_kind), 'reward:' || p_kind, p_idempotency_key);
END $$;

REVOKE ALL ON FUNCTION public.credits_claim_reward(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credits_claim_reward(text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Leaderboard points — remove client writability, bound awards
-- ---------------------------------------------------------------------------
-- The client only ever READS points_events (verified in src/lib/scoring.ts);
-- every insert belongs to a SECURITY DEFINER function. So the self-insert
-- policy and the table INSERT grant can both go.
DROP POLICY IF EXISTS "insert self points" ON public.points_events;
REVOKE INSERT ON public.points_events FROM authenticated, anon;

-- Per-award limit now matches the client's own scale (max 500 per activity),
-- plus a rolling 24h ceiling for the user.
CREATE OR REPLACE FUNCTION public.award_points(p_points integer, p_source text, p_sport text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_awarded_24h integer;
  v_cap constant integer := 2500;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_points IS NULL OR p_points <= 0 THEN RAISE EXCEPTION 'Invalid points'; END IF;
  IF p_points > 500 THEN RAISE EXCEPTION 'Points exceed per-award limit'; END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_awarded_24h
    FROM public.points_events
   WHERE user_id = v_user
     AND occurred_at > now() - interval '24 hours';

  IF v_awarded_24h + p_points > v_cap THEN
    RAISE EXCEPTION 'Daily points limit reached (% points per 24h).', v_cap;
  END IF;

  INSERT INTO public.points_events(user_id, points, source, sport)
  VALUES (v_user, p_points, p_source, p_sport);
  RETURN p_points;
END $$;

REVOKE ALL ON FUNCTION public.award_points(integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_points(integer, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Friend codes — owner-only reads, exact-match lookup only
-- ---------------------------------------------------------------------------
-- The old policy let every authenticated user list the whole table. Codes are
-- still discoverable when you know one (that's the product), but not
-- enumerable.
DROP POLICY IF EXISTS "Users can view all friend codes" ON public.friend_codes;
DROP POLICY IF EXISTS "Users can view own friend code" ON public.friend_codes;
CREATE POLICY "Users can view own friend code"
  ON public.friend_codes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Exact-match lookup for the "add a friend by code" flows.
CREATE OR REPLACE FUNCTION public.find_user_by_friend_code(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_code IS NULL OR length(btrim(p_code)) < 4 THEN RETURN NULL; END IF;

  SELECT user_id INTO v_user
    FROM public.friend_codes
   WHERE upper(code) = upper(btrim(p_code))
   LIMIT 1;

  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION public.find_user_by_friend_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_friend_code(text) TO authenticated;
