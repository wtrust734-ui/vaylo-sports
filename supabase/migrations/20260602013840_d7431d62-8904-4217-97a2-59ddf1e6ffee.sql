
-- Coins balance on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 100;

-- Coin transactions ledger
CREATE TABLE IF NOT EXISTS public.coin_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.coin_transactions TO authenticated;
GRANT ALL ON public.coin_transactions TO service_role;
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own coin tx" ON public.coin_transactions;
CREATE POLICY "Own coin tx" ON public.coin_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Avatar extras + setup flag
ALTER TABLE public.avatars ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.avatars ADD COLUMN IF NOT EXISTS is_setup boolean NOT NULL DEFAULT false;

-- Coins RPCs
CREATE OR REPLACE FUNCTION public.add_coins(p_amount integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF p_amount > 100000 THEN RAISE EXCEPTION 'Amount exceeds allowed limit'; END IF;
  UPDATE public.profiles SET coins = coins + p_amount WHERE user_id = v_user RETURNING coins INTO v_new;
  INSERT INTO public.coin_transactions (user_id, amount, reason) VALUES (v_user, p_amount, p_reason);
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION public.spend_coins(p_amount integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_cur integer; v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  SELECT coins INTO v_cur FROM public.profiles WHERE user_id = v_user FOR UPDATE;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF v_cur < p_amount THEN RAISE EXCEPTION 'Insufficient coins'; END IF;
  v_new := v_cur - p_amount;
  UPDATE public.profiles SET coins = v_new WHERE user_id = v_user;
  INSERT INTO public.coin_transactions (user_id, amount, reason) VALUES (v_user, -p_amount, p_reason);
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION public.convert_credits_to_coins(p_credits integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_credits integer; v_new_coins integer; v_award integer;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN RAISE EXCEPTION 'Invalid credits'; END IF;
  v_new_credits := public.spend_credits(p_credits, 'convert-to-coins');
  v_award := p_credits * 20;
  v_new_coins := public.add_coins(v_award, 'credit-conversion');
  RETURN jsonb_build_object('credits', v_new_credits, 'coins', v_new_coins, 'awarded', v_award);
END; $$;

CREATE OR REPLACE FUNCTION public.purchase_avatar_item_coins(p_item_id text, p_category text, p_rarity text, p_cost integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_existing uuid; v_new_coins integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN RAISE EXCEPTION 'Invalid cost'; END IF;
  IF p_cost > 50000 THEN RAISE EXCEPTION 'Cost exceeds allowed limit'; END IF;
  SELECT id INTO v_existing FROM public.avatar_items WHERE user_id = v_user AND item_id = p_item_id;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Item already owned'; END IF;
  IF p_cost > 0 THEN
    v_new_coins := public.spend_coins(p_cost, 'avatar:' || p_item_id);
  ELSE
    SELECT coins INTO v_new_coins FROM public.profiles WHERE user_id = v_user;
  END IF;
  INSERT INTO public.avatar_items (user_id, item_id, category, rarity) VALUES (v_user, p_item_id, p_category, p_rarity);
  RETURN jsonb_build_object('coins', v_new_coins, 'item_id', p_item_id);
END; $$;
