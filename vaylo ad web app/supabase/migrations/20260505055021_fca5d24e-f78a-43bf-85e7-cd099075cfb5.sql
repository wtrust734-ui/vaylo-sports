-- Avatars: equipped loadout per user (publicly viewable for social discovery)
CREATE TABLE public.avatars (
  user_id uuid PRIMARY KEY,
  base text NOT NULL DEFAULT 'athlete_neutral',
  skin_tone text NOT NULL DEFAULT 'tone_3',
  outfit text,
  headgear text,
  accessory text,
  badge text,
  background text NOT NULL DEFAULT 'bg_void',
  pose text NOT NULL DEFAULT 'pose_stance',
  display_name text,
  prestige_level integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.avatars ENABLE ROW LEVEL SECURITY;

-- Public read so any user (even non-friends) can view another athlete's avatar
CREATE POLICY "Avatars are publicly viewable"
  ON public.avatars FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users insert own avatar"
  ON public.avatars FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own avatar"
  ON public.avatars FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Owned cosmetic items per user
CREATE TABLE public.avatar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  category text NOT NULL,
  rarity text NOT NULL DEFAULT 'common',
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

ALTER TABLE public.avatar_items ENABLE ROW LEVEL SECURITY;

-- Public read so others can validate equipped items
CREATE POLICY "Avatar items are publicly viewable"
  ON public.avatar_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users insert own items"
  ON public.avatar_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER avatars_updated_at BEFORE UPDATE ON public.avatars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Atomic purchase: spend credits + grant item
CREATE OR REPLACE FUNCTION public.purchase_avatar_item(
  p_item_id text, p_category text, p_rarity text, p_cost integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_existing uuid;
  v_new_credits integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN RAISE EXCEPTION 'Invalid cost'; END IF;
  IF p_cost > 5000 THEN RAISE EXCEPTION 'Cost exceeds allowed limit'; END IF;

  SELECT id INTO v_existing FROM public.avatar_items
    WHERE user_id = v_user AND item_id = p_item_id;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Item already owned'; END IF;

  IF p_cost > 0 THEN
    v_new_credits := public.spend_credits(p_cost, 'avatar:' || p_item_id);
  ELSE
    SELECT credits INTO v_new_credits FROM public.profiles WHERE user_id = v_user;
  END IF;

  INSERT INTO public.avatar_items (user_id, item_id, category, rarity)
    VALUES (v_user, p_item_id, p_category, p_rarity);

  RETURN jsonb_build_object('credits', v_new_credits, 'item_id', p_item_id);
END;
$$;