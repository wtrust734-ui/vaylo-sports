-- Coin / cosmetic economy hardening.
--
-- Found during the September audit:
--   * `profiles.coins` had NO guard (the credits guard predates the coins column),
--     so any logged-in user could `update coins = 999999` from the browser and
--     mint the paid currency (coins buy avatar cosmetics).
--   * `add_coins()` was executable by any authenticated user (PUBLIC default
--     grant) with only a 100000-per-call cap and no rate limit — a mint loop.
--   * `purchase_avatar_item_coins()` / `purchase_avatar_item()` trusted the
--     `p_cost` argument sent by the browser, so `p_cost: 0` bought anything free.
--   * `avatar_items` had a client INSERT policy, so cosmetics could be granted
--     to yourself with no payment at all.
--
-- Prices now live in `public.avatar_catalog` (see 20260921090200_*).

-- ---------------------------------------------------------------------------
-- 1. Extend the profiles guard to cover coins as well as credits.
--    The existing trigger `guard_profile_credits_trg` already points at this
--    function, so replacing the body is enough.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits
     OR NEW.coins IS DISTINCT FROM OLD.coins THEN
    IF current_setting('app.allow_credit_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Direct updates to credits/coins are not allowed. Use the coin/credit functions.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Coin functions must now set the guard flag around their write, exactly the
--    way add_credits/spend_credits already do.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_coins(p_amount integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF p_amount > 100000 THEN RAISE EXCEPTION 'Amount exceeds allowed limit'; END IF;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET coins = coins + p_amount WHERE user_id = v_user RETURNING coins INTO v_new;
  PERFORM set_config('app.allow_credit_change', 'off', true);
  IF v_new IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
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
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET coins = v_new WHERE user_id = v_user;
  PERFORM set_config('app.allow_credit_change', 'off', true);
  INSERT INTO public.coin_transactions (user_id, amount, reason) VALUES (v_user, -p_amount, p_reason);
  RETURN v_new;
END; $$;

-- ---------------------------------------------------------------------------
-- 3. `add_coins` is a backend-only grant path now. The only legitimate caller
--    is the process-purchase edge function (which holds the service role key
--    and uses grant_coins below).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.add_coins(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_coins(integer, text) TO service_role;

-- Service-role-only grant for a specific user (used after a purchase).
-- Access control is by GRANT (the same pattern as credits_grant): only the
-- service role may execute this, so there is no `auth.uid()` to trust.
CREATE OR REPLACE FUNCTION public.grant_coins(p_user_id uuid, p_amount integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'User required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF p_amount > 100000 THEN RAISE EXCEPTION 'Amount exceeds allowed limit'; END IF;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET coins = coins + p_amount WHERE user_id = p_user_id RETURNING coins INTO v_new;
  PERFORM set_config('app.allow_credit_change', 'off', true);
  IF v_new IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  INSERT INTO public.coin_transactions (user_id, amount, reason) VALUES (p_user_id, p_amount, p_reason);
  RETURN v_new;
END; $$;

REVOKE ALL ON FUNCTION public.grant_coins(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_coins(uuid, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Cosmetics are bought at the SERVER price. `p_category`, `p_rarity` and
--    `p_cost` are still accepted (so the shipped client needs no change) but
--    are no longer trusted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_avatar_item_coins(
  p_item_id text, p_category text, p_rarity text, p_cost integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_existing uuid;
  v_new_coins integer;
  v_cat public.avatar_catalog%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_cat FROM public.avatar_catalog WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown cosmetic item: %', p_item_id;
  END IF;

  SELECT id INTO v_existing FROM public.avatar_items
    WHERE user_id = v_user AND item_id = p_item_id;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Item already owned'; END IF;

  IF v_cat.cost > 0 THEN
    v_new_coins := public.spend_coins(v_cat.cost, 'avatar:' || p_item_id);
  ELSE
    SELECT coins INTO v_new_coins FROM public.profiles WHERE user_id = v_user;
  END IF;
  IF v_new_coins IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  INSERT INTO public.avatar_items (user_id, item_id, category, rarity)
    VALUES (v_user, p_item_id, v_cat.category, v_cat.rarity);

  RETURN jsonb_build_object('coins', v_new_coins, 'item_id', p_item_id, 'cost', v_cat.cost);
END;
$$;

-- Legacy credits-priced purchase. It also trusted a client-supplied cost, and
-- the current app buys cosmetics with coins (purchase_avatar_item_coins), so
-- this endpoint is closed to clients rather than left as a free-item loophole.
REVOKE ALL ON FUNCTION public.purchase_avatar_item(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_avatar_item(text, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Owned items are only ever created by the purchase functions above.
--    Nothing in the client inserts into avatar_items, so the client write
--    policy/grant only served to hand out free cosmetics.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users insert own items" ON public.avatar_items;
REVOKE INSERT, UPDATE, DELETE ON public.avatar_items FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The coin ledger is written by the definer functions only.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.coin_transactions FROM anon, authenticated;
