-- Coin rate change: 1 credit = 7.5 coins (was 1.25).
--
-- The rate now lives in economy_config (key `coins_per_credit`) so it can be
-- tuned from the admin economy surface without a code deploy, and the
-- conversion function reads it instead of hardcoding a multiplier.
-- Balances are untouched — only future conversions use the new rate.

INSERT INTO public.economy_config (key, region, ab_variant, value, active)
VALUES ('coins_per_credit', 'GLOBAL', 'default', '7.5'::jsonb, true)
ON CONFLICT (key, region, ab_variant) DO UPDATE
  SET value = EXCLUDED.value, active = true;

CREATE OR REPLACE FUNCTION public.coins_per_credit()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.economy_value('coins_per_credit'))::text::numeric, 7.5)
$$;

GRANT EXECUTE ON FUNCTION public.coins_per_credit() TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_credits_to_coins(p_credits integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_credits integer;
  v_new_coins integer;
  v_award integer;
  v_rate numeric;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN RAISE EXCEPTION 'Invalid credits'; END IF;
  IF p_credits > 100000 THEN RAISE EXCEPTION 'Amount exceeds allowed limit'; END IF;

  v_rate := public.coins_per_credit();

  -- Spend first (SECURITY DEFINER + guard flag), then award.
  v_new_credits := public.spend_credits(p_credits, 'convert-to-coins');

  -- Whole coins only, floored, so the house never over-grants on a fractional
  -- rate (7.5 coins per credit means odd amounts round down by half a coin).
  v_award := floor(p_credits * v_rate)::int;
  IF v_award <= 0 THEN RAISE EXCEPTION 'Amount too small to convert'; END IF;

  v_new_coins := public.add_coins(v_award, 'credit-conversion');

  RETURN jsonb_build_object(
    'credits', v_new_credits,
    'coins', v_new_coins,
    'awarded', v_award,
    'rate', v_rate
  );
END; $$;

REVOKE ALL ON FUNCTION public.convert_credits_to_coins(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_credits_to_coins(integer) TO authenticated;

COMMENT ON FUNCTION public.convert_credits_to_coins(integer) IS
  'Converts credits to coins at the economy_config rate `coins_per_credit` (7.5). Spends via spend_credits, grants via add_coins.';
