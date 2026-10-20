REVOKE EXECUTE ON FUNCTION public.get_my_entitlements() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.apply_credit_refill(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, text) FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_my_subscription() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_fair_usage(text, integer) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.get_my_entitlements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_refill(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_fair_usage(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, text) TO service_role;