-- ============================================================================
-- 2026-10-06 AUDIT FIX — close four over-open reads found in the security
-- review, without breaking the surfaces that legitimately depend on them.
--
--   1. points_events had `USING (true)` for authenticated: any signed-in
--      session could read every other athlete's individual point events (90
--      rows proven by a count-only PoC). What the product actually needs is
--      (a) your own events and (b) AGGREGATES for the leaderboard and the
--      public profile. (a) becomes row-scoped; (b) moves behind a
--      security-definer function plus the pre-aggregated `leaderboard_totals`
--      view, which is the only cross-user points surface that stays public.
--   2. creator_profiles was readable by any signed-in session INCLUDING
--      `payout_email` — a creator's payout contact. Postgres has no row-
--      conditional column read, so SELECT is column-scoped: the directory
--      fields stay public, payout_email becomes unreadable to anon and
--      authenticated. INSERT/UPDATE are untouched, so a creator still writes
--      (and rewrites) their own payout email; nothing in the client reads it
--      back.
--   3. shared_activities / activity_hypes were readable row-for-row by every
--      signed-in session, which bypassed the block filter that
--      `feed_visible_activities` exists to enforce. The table-level SELECT
--      policies now exclude blocked pairs server-side, mirroring the view.
--
-- `leaderboard_totals` drops security_invoker: it returns one aggregated row
-- per (user, sport) and no event-level data, so it remains the public surface
-- PublicProfile always treated it as — but only for signed-in sessions. The
-- anon grant is revoked because anon previously saw nothing through RLS and
-- must not gain cross-user aggregates here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. points_events — own rows only; aggregates via RPC + view.
-- ---------------------------------------------------------------------------
drop policy if exists "read points" on public.points_events;

create policy "Athletes read their own point events"
  on public.points_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Windowed leaderboard aggregation, computed with the owner's rights so the
-- cross-user totals stay available now that the raw rows are not. Returns one
-- row per (user, sport) with the sum over the requested window; null bounds
-- mean "unbounded", and a null or 'all' sport means "every sport".
create or replace function public.leaderboard_points(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sport text default null
)
returns table (user_id uuid, sport text, points bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.user_id,
         e.sport,
         sum(e.points)::bigint as points
  from public.points_events e
  where (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at < p_to)
    and (p_sport is null or p_sport = 'all' or e.sport = p_sport)
  group by e.user_id, e.sport;
$$;

-- Functions are EXECUTE-to-PUBLIC by default; this one must not be anon's.
revoke all on function public.leaderboard_points(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.leaderboard_points(timestamptz, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. leaderboard_totals — aggregates only, signed-in sessions only.
-- ---------------------------------------------------------------------------
-- With security_invoker the view inherited the (now own-row) table policy and
-- every profile's points total would collapse to your own. The view contains
-- no event-level data, so it is reset to owner-invoked: postgres owns both the
-- view and the table, and FORCE ROW LEVEL SECURITY is off.
alter view public.leaderboard_totals reset (security_invoker);

-- Anon read 0 rows through RLS before this migration; it must not start
-- reading aggregates now that the view bypasses the table policy.
revoke select on public.leaderboard_totals from anon;
grant select on public.leaderboard_totals to authenticated;

-- ---------------------------------------------------------------------------
-- 3. creator_profiles — column-scoped SELECT, payout_email withdrawn.
-- ---------------------------------------------------------------------------
revoke select on public.creator_profiles from anon, authenticated;
grant select (user_id, display_name, bio, specialties, verified, created_at)
  on public.creator_profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Feed tables — the block filter lives on the table, not only the view.
-- ---------------------------------------------------------------------------
drop policy if exists "Shared activities viewable by authenticated" on public.shared_activities;

create policy "Shared activities viewable by authenticated"
  on public.shared_activities
  for select to authenticated
  using (
    not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = public.shared_activities.user_id and b.blocked_id = (select auth.uid()))
         or (b.blocker_id = (select auth.uid()) and b.blocked_id = public.shared_activities.user_id)
    )
  );

drop policy if exists "Hypes viewable by authenticated" on public.activity_hypes;

create policy "Hypes viewable by authenticated"
  on public.activity_hypes
  for select to authenticated
  using (
    not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = public.activity_hypes.user_id and b.blocked_id = (select auth.uid()))
         or (b.blocker_id = (select auth.uid()) and b.blocked_id = public.activity_hypes.user_id)
    )
  );
