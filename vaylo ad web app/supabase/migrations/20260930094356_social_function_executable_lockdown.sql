-- ===========================================================================
-- SOCIAL FUNCTION EXECUTABLE LOCKDOWN (advisor lint 0028/0029)
-- ---------------------------------------------------------------------------
-- Trigger functions are invoked by the trigger machinery with the function
-- owner's privileges — no role needs direct EXECUTE. The accept RPC stays
-- callable by authenticated athletes (the Friends screen calls it) but not by
-- anon. Same precedent as guard_achievement_claims in the 30 September
-- security hardening.
-- ===========================================================================

revoke execute on function public.guard_friend_request_insert() from public, anon, authenticated;
revoke execute on function public.guard_friend_request_blocked() from public, anon, authenticated;
revoke execute on function public.guard_friendship_pair() from public, anon, authenticated;
revoke execute on function public.guard_member_role() from public, anon, authenticated;

revoke execute on function public.accept_friend_request(uuid) from public, anon;
