-- ============================================================================
-- 2026-10-06 AUDIT FIX (part 2) — make the feed's block filter see BOTH
-- directions, as the product already claims it does.
--
-- `activitySharing.ts` documents `feed_visible_activities` as dropping
-- "anyone the viewer blocks or is blocked by — SERVER-SIDE". A live probe
-- against 20261006140000 showed only half of that is true: a policy subquery
-- on `user_blocks` runs as the querying athlete, and the only SELECT policy on
-- user_blocks is "private to the blocker" — so rows where somebody ELSE
-- blocked the viewer are invisible to the subquery, and the victim keeps
-- seeing the blocker's shares. Probe result: with A blocked by B's row
-- (blocker=A, blocked=B), viewer B still saw A's share.
--
-- The fix is a security-definer helper that resolves the pair with the
-- owner's rights. It takes only the OTHER user's id and always pairs it with
-- auth.uid(), so an athlete calling it directly learns nothing except their
-- own blocking relationships — never third-party ones. The feed view gets the
-- correct behaviour for free: it is security_invoker, so the table policy
-- below applies through it, and the view's own (direction-1) filter becomes a
-- harmless redundancy.
-- ============================================================================

create or replace function public.blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = (select auth.uid()))
  );
$$;

-- Functions are EXECUTE-to-PUBLIC by default; this one must not be anon's.
revoke all on function public.blocked_with(uuid) from public, anon;
grant execute on function public.blocked_with(uuid) to authenticated;

drop policy if exists "Shared activities viewable by authenticated" on public.shared_activities;

create policy "Shared activities viewable by authenticated"
  on public.shared_activities
  for select to authenticated
  using (not public.blocked_with(public.shared_activities.user_id));

drop policy if exists "Hypes viewable by authenticated" on public.activity_hypes;

create policy "Hypes viewable by authenticated"
  on public.activity_hypes
  for select to authenticated
  using (not public.blocked_with(public.activity_hypes.user_id));
