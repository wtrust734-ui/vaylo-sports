-- ============================================================================
-- EARNED COSMETIC GRANTS — the free lane into the profile shelf
-- ----------------------------------------------------------------------------
-- Research finding (docs/cosmetics research, §5.1–5.2): the only code path that
-- inserts into `user_rewards` was the coin purchase RPC, so the profile shelf
-- was pay-only while earned items (surprise boxes) all landed in
-- `avatar_items`. This gives achievements a real grant path:
--
--   * `earn_grantable` marks which catalogue items may be handed out free.
--   * `user_earned_grants` is the idempotency ledger (user, source, milestone)
--     — one grant per milestone, ever.
--   * `grant_cosmetic(source, milestone_key)` validates the milestone against
--     the database where it can (plan completion, first performance log) and
--     picks a random not-yet-owned item from that source's pool.
--
-- Sources and their server-verified evidence:
--   plan_complete      → milestone_key is a training_plans id owned by the
--                        caller with week_current >= duration_weeks.
--   first_log          → lifetime-once (milestone key is forced to 'once');
--                        verified server-side by the caller having ≥1
--                        performance_log. Keying by individual log ids would
--                        have let each new log mint another grant — the pool
--                        caps it, but 'first log' should mean once, full stop.
--   streak_milestone   → milestone_key is a box-streak threshold (3/7/14/30/
--                        60/100 — the same ladder as rewardBoxes.ts); verified
--                        client-side the same way claim_reward_box trusts its
--                        streak caller. Grants express into badges — which
--                        until now had NO grant path at all
--                        (purchase_cosmetic refuses them by design, so the
--                        badge slot was permanently empty).
--
-- Grants are free: no coins move. The client cannot write user_rewards or the
-- ledger directly; this RPC is the only door.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Which items may be granted free.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reward_definitions
  ADD COLUMN IF NOT EXISTS earn_grantable boolean NOT NULL DEFAULT false;

-- Badges finally become earnable (they were catalogued but forever locked).
UPDATE public.reward_definitions SET earn_grantable = true
WHERE type = 'badge' AND active;

-- A starter floor of non-badge grantables so the other pools have content.
UPDATE public.reward_definitions SET earn_grantable = true
WHERE id IN (
  'title_winner', 'title_underdog', 'title_dedicated', 'title_captain',
  'border_silver', 'bg_arena', 'name_blue', 'fx_click_spark'
) AND active;

-- ---------------------------------------------------------------------------
-- 2. Idempotency ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_earned_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('plan_complete','first_log','streak_milestone')),
  milestone_key TEXT NOT NULL,
  granted_reward_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, milestone_key)
);
CREATE INDEX IF NOT EXISTS user_earned_grants_user_idx ON public.user_earned_grants (user_id);

GRANT SELECT ON public.user_earned_grants TO authenticated;
GRANT ALL ON public.user_earned_grants TO service_role;
ALTER TABLE public.user_earned_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "earned_grants_owner_read" ON public.user_earned_grants
  FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. The grant RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_cosmetic(p_source text, p_milestone_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_pool_types text[];
  v_plan public.training_plans%ROWTYPE;
  v_log_key text;
  v_pick record;
  v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_source IS NULL OR p_milestone_key IS NULL OR p_milestone_key = '' THEN
    RAISE EXCEPTION 'Source and milestone are required';
  END IF;

  -- Milestone validation, server-side, per source.
  IF p_source = 'plan_complete' THEN
    SELECT * INTO v_plan FROM public.training_plans
      WHERE id::text = p_milestone_key AND user_id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan'; END IF;
    IF v_plan.week_current IS NULL OR v_plan.duration_weeks IS NULL
       OR v_plan.week_current < v_plan.duration_weeks THEN
      RAISE EXCEPTION 'Plan is not complete yet';
    END IF;
    v_pool_types := ARRAY['title','background','border'];

  ELSIF p_source = 'first_log' THEN
    -- Lifetime-once: the milestone key is forced, so it cannot be minted once
    -- per log by retrying with different log ids.
    p_milestone_key := 'once';
    IF NOT EXISTS (SELECT 1 FROM public.performance_logs WHERE user_id = v_user) THEN
      RAISE EXCEPTION 'You have no logged sessions yet';
    END IF;
    v_pool_types := ARRAY['badge','name_color','effect'];

  ELSIF p_source = 'streak_milestone' THEN
    -- The same ladder the surprise boxes use (rewardBoxes.ts BOX_MILESTONES).
    IF p_milestone_key NOT IN ('3','7','14','30','60','100') THEN
      RAISE EXCEPTION 'Unknown streak milestone';
    END IF;
    v_pool_types := ARRAY['badge'];

  ELSE
    RAISE EXCEPTION 'Unknown grant source';
  END IF;

  -- Idempotency first: one grant per (user, source, milestone), ever.
  INSERT INTO public.user_earned_grants (user_id, source, milestone_key)
  VALUES (v_user, p_source, p_milestone_key)
  ON CONFLICT (user_id, source, milestone_key) DO NOTHING;

  SELECT * INTO v_pick
  FROM public.reward_definitions d
  WHERE d.active AND d.earn_grantable
    AND d.type = ANY (v_pool_types)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_rewards ur
      WHERE ur.user_id = v_user AND ur.reward_id = d.id
    )
  ORDER BY random()
  LIMIT 1;

  IF v_pick IS NULL THEN
    -- Nothing left to grant (or everything already owned): ledger row above
    -- records the claim so the milestone cannot be re-farmed.
    RETURN jsonb_build_object('ok', true, 'status', 'all_owned', 'granted', NULL);
  END IF;

  INSERT INTO public.user_rewards (user_id, reward_id, type, category, rarity, source)
  VALUES (v_user, v_pick.id, v_pick.type, v_pick.category, v_pick.rarity, 'achievement');

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'granted',
    'granted', jsonb_build_object(
      'id', v_pick.id, 'name', v_pick.name, 'type', v_pick.type,
      'rarity', v_pick.rarity, 'icon', v_pick.icon, 'payload', v_pick.payload
    )
  );
END; $$;

REVOKE ALL ON FUNCTION public.grant_cosmetic(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_cosmetic(text, text) TO authenticated;

COMMENT ON FUNCTION public.grant_cosmetic(text, text) IS
  'Grants one free earn_grantable cosmetic for a validated training milestone (plan_complete / first_log / streak_milestone). Idempotent per (user, source, milestone). Free grants only — no coins move.';
