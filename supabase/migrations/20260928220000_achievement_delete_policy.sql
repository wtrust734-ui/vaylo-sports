-- ============================================================================
-- LET AN ATHLETE DELETE THEIR OWN ACHIEVEMENT
-- ----------------------------------------------------------------------------
-- `achievements` had INSERT and SELECT policies and no DELETE, so a row was
-- permanent once written. Two consequences, one of them found by accident:
--
--   1. An athlete could not remove an achievement that was granted in error.
--      The 50/100 "Champion"/"Legend" counters read from this table, so a
--      mistaken grant could not be taken back.
--
--   2. The security check's own cleanup silently deleted nothing. It filtered on
--      `title=eq.security-check probe`, and with an unencoded space PostgREST
--      read that as `title = 'security-check'` and matched no rows — so every
--      run left a probe row behind and ten had piled up on the review account.
--      The encoding is fixed in the script too, but the missing policy was the
--      reason the delete could never work however it was spelled.
--
-- Scoped to `auth.uid() = user_id`, so this grants no reach over anyone else's
-- badges. It does not weaken the derived-column trigger: `earned_at` and
-- `share_count` are still set by the database on insert, and deleting a row
-- does not rewrite history anywhere else — points_events is a separate ledger.
--
-- Known limitation, left as-is and recorded rather than papered over: an athlete
-- can INSERT an achievement with a title of their choosing, because there is no
-- achievement catalog table to validate against. That is self-gaming, not
-- reputation forgery — public profiles deliberately do not show another
-- athlete's achievements (src/pages/PublicProfile.tsx), so the worst outcome is a
-- badge on your own profile that you gave yourself. Closing it properly means a
-- catalog table and a check constraint, which is a product change, not a patch.
-- ============================================================================

drop policy if exists "Users can delete their own achievements" on public.achievements;

create policy "Users can delete their own achievements"
  on public.achievements for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on policy "Users can delete their own achievements" on public.achievements is
  'An athlete can remove their own achievement. Scoped to their own rows; the insert trigger still derives earned_at and share_count.';
