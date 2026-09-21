-- Fix coin economy rate: 1 credit = 1.25 coins (spec). Previous migration used 20x.
-- Keep coins balances intact; only the conversion function rate changes.

CREATE OR REPLACE FUNCTION public.convert_credits_to_coins(p_credits integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_credits integer; v_new_coins integer; v_award integer;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN RAISE EXCEPTION 'Invalid credits'; END IF;
  -- spend_credits is the secure, idempotent credit-spend path (same as all other spends)
  v_new_credits := public.spend_credits(p_credits, 'convert-to-coins');
  -- 1 credit = 1.25 coins — floor so we never over-grant on fractional amounts
  v_award := floor(p_credits * 1.25)::int;
  IF v_award <= 0 THEN v_award := 1; END IF;
  v_new_coins := public.add_coins(v_award, 'credit-conversion');
  RETURN jsonb_build_object('credits', v_new_credits, 'coins', v_new_coins, 'awarded', v_award);
END; $$;

COMMENT ON FUNCTION public.convert_credits_to_coins(integer) IS 'Converts credits to coins at 1:1.25 (spec). Spends via spend_credits, grants via add_coins.';
