-- ============================================================================
-- Row-scoped reads: three tables that allowed every signed-in user to read
-- every row (`SELECT ... WHERE qual IS TRUE`).
--
--   referral_codes     2 rows    "Codes readable"
--   privacy_settings  31 rows    "Privacy viewable by all authed"
--   user_region        0 rows    "Countries are publicly readable"
--
-- Cross-user reading of these tables IS needed by three screens, so the answer
-- is not to disable it but to shrink it: each table gets an own-row policy, and
-- a SECURITY DEFINER function hands peers only the specific columns those
-- screens consume.
--
--   referral_codes    Nothing ever read a peer's code. Referrals.tsx and
--                     lib/share.ts both filter on auth.uid(), and redemption
--                     goes through redeem_referral() (SECURITY DEFINER), which
--                     does not depend on this policy.
--   privacy_settings  Communities.tsx reads a recipient's allow_friend_requests
--                     and PublicProfile.tsx reads show_avatar_publicly. Both
--                     move to peer_privacy(). Recipient privacy was already
--                     enforced by a DB trigger, so this closes a read, not a
--                     control gap.
--   user_region       Leaderboards read peers' country for the geo scopes
--                     (documented in Leaderboard.tsx as "publicly readable for
--                     exactly two columns"). peer_regions() now returns exactly
--                     those two and nothing else — currency and detected_at no
--                     longer travel to peers.
--
-- Deliberately POLICY-ONLY: no column-level GRANTs are touched. A previous
-- attempt at column grants on user_region broke upsert — see
-- 20260922092000_user_region_public_read.sql, which reverted it.
-- ============================================================================

-- ---------------------------------------------------------------- peer reads
create or replace function public.peer_privacy(p_user uuid)
returns table (allow_friend_requests boolean, show_avatar_publicly boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.allow_friend_requests, s.show_avatar_publicly
  from public.privacy_settings s
  where s.user_id = p_user;
$$;

create or replace function public.peer_regions(p_users uuid[])
returns table (user_id uuid, country text)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, r.country
  from public.user_region r
  where r.user_id = any (p_users);
$$;

-- Definer functions bypass RLS by design, so only signed-in athletes get them.
revoke all on function public.peer_privacy(uuid) from public, anon;
revoke all on function public.peer_regions(uuid[]) from public, anon;
grant execute on function public.peer_privacy(uuid) to authenticated;
grant execute on function public.peer_regions(uuid[]) to authenticated;

-- ------------------------------------------------------------- own-row reads
drop policy if exists "Codes readable" on public.referral_codes;
create policy "Own code readable" on public.referral_codes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Privacy viewable by all authed" on public.privacy_settings;
create policy "Own privacy readable" on public.privacy_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Countries are publicly readable" on public.user_region;
create policy "Own region readable" on public.user_region
  for select to authenticated
  using ((select auth.uid()) = user_id);
