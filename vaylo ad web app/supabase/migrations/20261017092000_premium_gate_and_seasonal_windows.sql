-- ============================================================================
-- COSMETIC UX GATES — animated equips need Premium; seasonal windows enforced
-- ----------------------------------------------------------------------------
-- Research findings (§14-E, §2.2, §11 #7):
--   1. Animated cosmetics (animated_payload items — neon/rainbow borders,
--      galaxy background, rainbow name) become a Premium perk at the EQUIP
--      step. They stay buyable with Coins for everyone; only equipping
--      requires an active subscription. This mirrors Strava's subscriber-only
--      identity surfaces and is stated honestly ("requires Premium to equip —
--      not a separate purchase").
--   2. `available_from / available_to` season windows existed on
--      reward_definitions but nothing enforced them — the summer row's window
--      had already passed and the shop would still happily sell it. The
--      purchase RPC now respects the window; the client filters with the same
--      rule (src/lib/cosmetics.ts isAvailableNow).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Subscription check — mirrors get_my_entitlements() semantics exactly
--    (active not expired, trial not lapsed, or lifetime), without the JSON.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_subscribed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = auth.uid()
      AND (
        (s.status = 'active' AND (
          s.is_lifetime
          OR s.expires_at IS NULL
          OR s.expires_at >= now()
        ))
        OR (s.status IN ('trial','trialing') AND (
          s.is_lifetime
          OR s.trial_ends_at IS NULL
          OR s.trial_ends_at >= now()
        ))
        OR (s.is_lifetime AND s.status NOT IN ('expired','free','cancelled'))
      )
  )
$$;

REVOKE ALL ON FUNCTION public.user_subscribed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_subscribed() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. equip_cosmetic — ownership (unchanged) + Premium for animated payloads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equip_cosmetic(p_reward_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_def public.reward_definitions%ROWTYPE;
  v_animated boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_def FROM public.reward_definitions WHERE id = p_reward_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown cosmetic: %', p_reward_id; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_rewards WHERE user_id = v_user AND reward_id = p_reward_id) THEN
    RAISE EXCEPTION 'You do not own this cosmetic';
  END IF;

  -- Animated items (payload.animated) need a subscription to wear. Buy is
  -- unaffected; this is an honest entitlement statement, not a paywall on
  -- something already owned without disclosure — the shop states it on the
  -- card before purchase.
  v_animated := COALESCE((v_def.payload->>'animated')::boolean, false);
  IF v_animated AND NOT public.user_subscribed() THEN
    RAISE EXCEPTION
      'Premium required: animated cosmetics need an active subscription to equip.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- One row per user; only the slot for this cosmetic's type changes.
  INSERT INTO public.user_profile_cosmetics (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;

  IF v_def.type = 'title' THEN
    UPDATE public.user_profile_cosmetics SET title_id = p_reward_id, updated_at = now() WHERE user_id = v_user;
  ELSIF v_def.type = 'border' THEN
    UPDATE public.user_profile_cosmetics SET border_id = p_reward_id, updated_at = now() WHERE user_id = v_user;
  ELSIF v_def.type = 'background' THEN
    UPDATE public.user_profile_cosmetics SET background_id = p_reward_id, updated_at = now() WHERE user_id = v_user;
  ELSIF v_def.type = 'name_color' THEN
    UPDATE public.user_profile_cosmetics SET name_color_id = p_reward_id, updated_at = now() WHERE user_id = v_user;
  ELSIF v_def.type = 'badge' THEN
    UPDATE public.user_profile_cosmetics SET badge_id = p_reward_id, updated_at = now() WHERE user_id = v_user;
  ELSIF v_def.type = 'effect' THEN
    UPDATE public.user_profile_cosmetics SET effect_id = p_reward_id, updated_at = now() WHERE user_id = v_user;
  ELSE
    RAISE EXCEPTION 'This item cannot be equipped on your profile';
  END IF;

  -- Keep the inventory's own equipped flag consistent for this type.
  UPDATE public.user_rewards SET equipped = (reward_id = p_reward_id)
  WHERE user_id = v_user AND type = v_def.type;

  RETURN jsonb_build_object('equipped', true, 'reward_id', p_reward_id, 'type', v_def.type);
END; $$;

-- Grants were already restricted in 20260921090500; restate them after the
-- recreate so the new function keeps the same narrow surface.
REVOKE ALL ON FUNCTION public.equip_cosmetic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equip_cosmetic(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. purchase_cosmetic — unchanged business logic + season window respect.
--    (Recreated so the file is the authoritative definition; behaviour
--    differences from 20260921090500 are the availability check only.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_cosmetic(p_reward_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_def public.reward_definitions%ROWTYPE;
  v_new_coins integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_def FROM public.reward_definitions WHERE id = p_reward_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown cosmetic: %', p_reward_id; END IF;
  IF NOT v_def.active THEN RAISE EXCEPTION 'This cosmetic is no longer available'; END IF;
  IF v_def.type NOT IN ('title', 'border', 'background', 'name_color', 'effect') THEN
    RAISE EXCEPTION 'This item is not purchasable with Coins';
  END IF;
  IF v_def.coin_cost IS NULL OR v_def.coin_cost <= 0 THEN
    RAISE EXCEPTION 'This item has no price';
  END IF;

  -- Seasonal availability: outside a declared window an item is not on sale.
  -- (Windows are optional — NULL on either bound means always available — but
  -- an item TYPE 'seasonal' with no window at all is a content defect, not an
  -- always-on sale: two legacy rows (olympic medallion, world-cup jersey) have
  -- exactly that. They stay hidden until someone sets real dates.)
  IF v_def.type = 'seasonal' AND (v_def.available_from IS NULL OR v_def.available_to IS NULL) THEN
    RAISE EXCEPTION 'This item is not on sale';
  END IF;
  IF v_def.available_from IS NOT NULL AND now() < v_def.available_from THEN
    RAISE EXCEPTION 'This item is not available yet';
  END IF;
  IF v_def.available_to IS NOT NULL AND now() > v_def.available_to THEN
    RAISE EXCEPTION 'This item is no longer available';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_rewards WHERE user_id = v_user AND reward_id = p_reward_id) THEN
    RAISE EXCEPTION 'Already owned';
  END IF;

  v_new_coins := public.spend_coins(v_def.coin_cost, 'profile-cosmetic:' || p_reward_id);

  INSERT INTO public.user_rewards (user_id, reward_id, type, category, rarity, source)
  VALUES (v_user, p_reward_id, v_def.type, v_def.category, v_def.rarity, 'coins');

  RETURN jsonb_build_object('coins', v_new_coins, 'reward_id', p_reward_id, 'cost', v_def.coin_cost);
END; $$;

REVOKE ALL ON FUNCTION public.purchase_cosmetic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(text) TO authenticated;
