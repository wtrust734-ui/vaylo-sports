REVOKE ALL ON FUNCTION public.economy_value(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.starting_credits() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credit_cost(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_unlimited_credits(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credits_spend(text, text, integer, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credits_claim_reward(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credits_grant(uuid, integer, text, text, text, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.economy_value(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.starting_credits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_cost(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_unlimited_credits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_spend(text, text, integer, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_claim_reward(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_grant(uuid, integer, text, text, text, jsonb) TO service_role;