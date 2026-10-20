-- ============================================================================
-- CLOSE THE CHALLENGE WRITE PATHS
-- ----------------------------------------------------------------------------
-- Found by attacking the live API as a signed-in athlete using only the
-- publishable key that ships inside the APK. Three reproductions, all of which
-- returned HTTP 200 and succeeded:
--
--   1. `challenge_participants` carried an "update self" RLS policy, so an
--      athlete could PATCH their own row to any progress. The clamp I added to
--      `update_challenge_progress()` only governed the RPC — the column was
--      writable beside it, which made the clamp decorative. Nothing in the
--      client writes this table: joining is INSERT, leaving is DELETE, and all
--      progress goes through the RPC. So the policy has no legitimate caller and
--      is dropped rather than narrowed.
--
--   2. An athlete could INSERT a challenge with `is_official = true`, an
--      arbitrary `sponsor_name`, and `reward_points` of their choosing. That is
--      phishing inside the app's own UI: a fake "Vaylo official" challenge, or
--      one wearing a brand's name that never agreed to appear. It is also a
--      money bug, because completion writes `points_events` using the
--      challenge's own `reward_points` — so the creator priced their own
--      payout, and combined with (1) could force the completion that paid it.
--
--   3. An empty or id-less basket returned `{"success": true}`. Nothing was
--      granted, so this is not a money hole, but the client shows a success
--      toast for a request that bought nothing — which trains athletes to
--      ignore the one signal that would tell them a purchase failed.
--
-- The trigger below is the fix for (2). It is a BEFORE INSERT OR UPDATE that
-- normalises the privileged columns rather than raising, because the columns are
-- not part of any client contract: src/pages/Challenges.tsx sends only
-- creator_id, title, description, type, sport, scope, target_value and
-- target_unit. Rejecting with an error would break a future client that
-- harmlesslysends a default; normalising cannot be reached by an athlete at all,
-- which is the property that matters.
--
-- `auth.uid()` is null for service-role callers, so seeding, the official
-- challenges and any future editorial tool are untouched by this trigger. The
-- official rows are identified by `creator_id IS NULL` and keep their rewards.
-- ============================================================================

-- ── 1. Progress is server-owned ────────────────────────────────────────────
-- Dropped, not narrowed: there is no client code path that needs UPDATE on this
-- table, so re-adding it later should be a deliberate decision with a reason.
drop policy if exists "update self" on public.challenge_participants;

-- Belt and braces for anything granted later: the table has no UPDATE policy at
-- all now, so this only documents intent for the next reader.
comment on table public.challenge_participants is
  'Progress, status and completion are server-owned. Clients may INSERT (join) and DELETE (leave) their own row; every progress change goes through update_challenge_progress(), which clamps to the challenge target.';

-- ── 2. Privileged challenge columns are server-owned ───────────────────────
create or replace function public.guard_challenge_privileges()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- Caps for an athlete-created challenge. Set to the maximum the official
  -- seeds pay (20 credits / 250 points) so a user challenge is never worth more
  -- to mint than a real one. Raising these is a product decision.
  max_credits constant integer := 20;
  max_points  constant integer := 250;
begin
  if auth.uid() is not null then
    new.is_official       := false;
    new.sponsor_brand_id  := null;
    new.sponsor_name      := null;
    new.sponsor_disclosure := null;
    new.participant_count := 0;
    new.reward_credits    := least(greatest(coalesce(new.reward_credits, 0), 0), max_credits);
    new.reward_points     := least(greatest(coalesce(new.reward_points, 0), 0), max_points);
  end if;
  return new;
end;
$$;

drop trigger if exists guard_challenge_privileges on public.challenges;
create trigger guard_challenge_privileges
  before insert or update on public.challenges
  for each row execute function public.guard_challenge_privileges();

comment on function public.guard_challenge_privileges() is
  'Strips is_official, sponsor_* and participant_count and caps rewards on any challenge written by a client. Service-role writes (auth.uid() is null) are untouched.';

-- ── 3. An empty basket is a bad request, not a purchase ─────────────────────
-- Guarded in the edge function rather than here, so the client gets the 400.
