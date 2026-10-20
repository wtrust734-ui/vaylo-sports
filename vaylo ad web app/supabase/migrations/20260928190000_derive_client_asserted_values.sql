-- ============================================================================
-- DERIVE WHAT THE CLIENT WAS ALLOWED TO ASSERT
-- ----------------------------------------------------------------------------
-- The second pass, after the five privilege paths in
-- 20260928183000_close_client_writable_privileges.sql.
--
-- `streaks` had an ALL policy for the owner, which let an athlete write any
-- current_streak, longest_streak or freezes_available. Reproduced before this
-- migration: current_streak = 9999 accepted with HTTP 201.
--
-- Nothing needs that write. The app already goes through touch_streak(p_date),
-- a SECURITY DEFINER routine that clamps the athlete's local day to +/- one day
-- of the server's own and does the counting, including the grace-day and
-- freeze rules. So the only access the client needs is reading its own row, and
-- that is all this leaves it.
--
-- A trigger that recomputed the streak here was written first and removed: it
-- would have fought touch_streak's own grace-day handling, which is the logic
-- that decides whether a missed day is forgiven. Deriving a value in a second
-- place, from less information, is how that rule quietly breaks. Removing the
-- write path is both smaller and complete.
--
-- `achievements` genuinely is client-written — checkAndAwardMilestones inserts
-- a medal when the athlete crosses a points threshold — so the INSERT policy
-- stays. What changes is what such a row is allowed to claim: `earned_at` is
-- stamped by the server's clock rather than accepted from the caller, and
-- `share_count` starts at zero. A self-awarded medal dated two years ago, or
-- carrying ten thousand shares, ends up on a public profile and in a trophy
-- room, and neither is the client's to assert.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- streaks: the owner reads. Only touch_streak() writes.
-- ---------------------------------------------------------------------------
drop policy if exists "Users manage own streak" on public.streaks;

create policy "Users view own streak"
on public.streaks for select
to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- achievements: the row is real, its claims are the server's
-- ---------------------------------------------------------------------------
create or replace function public.guard_achievement_claims()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- When it was earned is a fact about the server's clock. The client may send
  -- `earned_at`; it is ignored.
  new.earned_at := now();
  -- Shares are counted by whatever actually receives a share. Nothing in the
  -- client writes this column today, so zero is not a behaviour change — it
  -- removes the ability to start a medal at 10,000.
  new.share_count := 0;
  return new;
end;
$function$;

drop trigger if exists guard_achievement_claims_trg on public.achievements;
create trigger guard_achievement_claims_trg
before insert on public.achievements
for each row execute function public.guard_achievement_claims();
