-- Profile cosmetics — the identity layer.
--
-- The pieces already existed but were never connected: `reward_definitions`
-- holds the cosmetics, `user_rewards` holds ownership, and
-- `user_profile_cosmetics` holds what is equipped (one row per user, a column
-- per slot). Nothing in the app ever read or wrote the equipped row, and the
-- owned-reward surface had no way to spend coins on anything.
--
-- This migration:
--   1. gives profile cosmetics a coin price (by rarity, matching the avatar
--      ladder in src/config/coins.ts),
--   2. adds purchase + equip RPCs (prices always read server-side),
--   3. stops clients writing ownership/equipped state directly, which
--      previously let anyone equip cosmetics they had never earned.
--
-- Only the PROFILE slots are sold here: titles, borders, backgrounds, name
-- colours and effects. Badges and credits stay earn-only (they are prestige /
-- chest rewards), and avatar items are sold by `purchase_avatar_item_coins`
-- against `avatar_catalog` — this must not become a second avatar economy.

-- ---------------------------------------------------------------------------
-- 1. Price column + prices by rarity
-- ---------------------------------------------------------------------------
ALTER TABLE public.reward_definitions ADD COLUMN IF NOT EXISTS coin_cost integer;

-- Coin prices for the profile slots — anchored to the avatar catalog so the two
-- cosmetic ladders feel like one economy (common 150 → mythic 4800 coins).
UPDATE public.reward_definitions
SET coin_cost = CASE rarity
  WHEN 'common'    THEN 150
  WHEN 'rare'      THEN 400
  WHEN 'epic'      THEN 900
  WHEN 'legendary' THEN 2400
  WHEN 'mythic'    THEN 4800
END
WHERE coin_cost IS NULL
  AND active = true
  AND type IN ('title', 'border', 'background', 'name_color', 'effect');

-- ---------------------------------------------------------------------------
-- 2. Purchase — price comes from the table, never from the caller
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

-- ---------------------------------------------------------------------------
-- 3. Equip / unequip — ownership enforced here, not in the client
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equip_cosmetic(p_reward_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_def public.reward_definitions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_def FROM public.reward_definitions WHERE id = p_reward_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown cosmetic: %', p_reward_id; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_rewards WHERE user_id = v_user AND reward_id = p_reward_id) THEN
    RAISE EXCEPTION 'You do not own this cosmetic';
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

CREATE OR REPLACE FUNCTION public.unequip_cosmetic(p_slot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_type text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Whitelisted slots only (no dynamic SQL with client input).
  IF p_slot NOT IN ('title_id', 'border_id', 'background_id', 'name_color_id', 'badge_id', 'effect_id') THEN
    RAISE EXCEPTION 'Unknown slot: %', p_slot;
  END IF;

  v_type := CASE p_slot
    WHEN 'title_id' THEN 'title'
    WHEN 'border_id' THEN 'border'
    WHEN 'background_id' THEN 'background'
    WHEN 'name_color_id' THEN 'name_color'
    WHEN 'badge_id' THEN 'badge'
    WHEN 'effect_id' THEN 'effect'
  END;

  IF p_slot = 'title_id' THEN
    UPDATE public.user_profile_cosmetics SET title_id = NULL, updated_at = now() WHERE user_id = v_user;
  ELSIF p_slot = 'border_id' THEN
    UPDATE public.user_profile_cosmetics SET border_id = NULL, updated_at = now() WHERE user_id = v_user;
  ELSIF p_slot = 'background_id' THEN
    UPDATE public.user_profile_cosmetics SET background_id = NULL, updated_at = now() WHERE user_id = v_user;
  ELSIF p_slot = 'name_color_id' THEN
    UPDATE public.user_profile_cosmetics SET name_color_id = NULL, updated_at = now() WHERE user_id = v_user;
  ELSIF p_slot = 'badge_id' THEN
    UPDATE public.user_profile_cosmetics SET badge_id = NULL, updated_at = now() WHERE user_id = v_user;
  ELSIF p_slot = 'effect_id' THEN
    UPDATE public.user_profile_cosmetics SET effect_id = NULL, updated_at = now() WHERE user_id = v_user;
  END IF;

  UPDATE public.user_rewards SET equipped = false WHERE user_id = v_user AND type = v_type;

  RETURN jsonb_build_object('equipped', false, 'slot', p_slot);
END; $$;

REVOKE ALL ON FUNCTION public.equip_cosmetic(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unequip_cosmetic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equip_cosmetic(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unequip_cosmetic(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ownership and equipped state are now server-controlled only.
--    (Previously: anyone could INSERT/UPDATE their own user_profile_cosmetics
--    row and so wear cosmetics they had never earned or bought.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profile_cosmetics_owner_upsert" ON public.user_profile_cosmetics;
DROP POLICY IF EXISTS "profile_cosmetics_owner_update" ON public.user_profile_cosmetics;
REVOKE INSERT, UPDATE, DELETE ON public.user_profile_cosmetics FROM anon, authenticated;

DROP POLICY IF EXISTS "user_rewards_owner_equip" ON public.user_rewards;
REVOKE INSERT, UPDATE, DELETE ON public.user_rewards FROM anon, authenticated;

-- Reads stay as they were: owners see their own, and everyone can read equipped
-- cosmetics so profiles render for other athletes.
