-- Trigger functions are invoked by the trigger machinery with the function
-- owner's privileges — no role needs direct EXECUTE (advisor lints 0028/0029;
-- same precedent as guard_achievement_claims and the social-package lockdown).

revoke execute on function public.guard_reward_config() from public, anon, authenticated;
revoke execute on function public.guard_avatar_item_insert() from public, anon, authenticated;
revoke execute on function public.guard_avatar_equips() from public, anon, authenticated;
revoke execute on function public.guard_listing_insert() from public, anon, authenticated;
revoke execute on function public.guard_listing_metrics() from public, anon, authenticated;
revoke execute on function public.guard_booking_insert() from public, anon, authenticated;
revoke execute on function public.guard_booking_transition() from public, anon, authenticated;
revoke execute on function public.guard_pack_ownership_insert() from public, anon, authenticated;
