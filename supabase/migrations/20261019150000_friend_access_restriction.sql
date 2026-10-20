-- ============================================================================
-- FRIENDS ACCESS RESTRICTION — the >3-distinct-report policy, server-enforced
-- ----------------------------------------------------------------------------
-- Reports existed, blocks existed; nothing connected a pile of reports on one
-- athlete to losing access to the Friends feature. This migration adds exactly
-- that, built the way every other rule in this feature is built: as database
-- machinery, not UI decoration:
--
--   1. Counting. A report on an athlete is a `content_reports` row with
--      `target_type = 'profile'` and `target_id` = the athlete's auth.users id.
--      The qualifying count is DISTINCT reporter_id over NON-dismissed reports
--      — one voice, one vote: the per-(reporter, target, reason) unique index
--      means an athlete hammering Report cannot stack the count, and a
--      moderator dismissing a fabricated report shrinks it.
--
--   2. Threshold. MORE than three qualifying reports — four or more distinct
--      reporters — activates the restriction. Three must not. The threshold is
--      written as `>= 4` once, in one place, and never re-derived.
--
--   3. Enforcement. The restricted athlete loses Friends access SERVER-SIDE:
--      no sending or receiving friend requests, no reading the friend list,
--      no direct messages in either direction. The screens still document
--      what happened; the database does the refusing. Direct API calls hit
--      the same triggers and the same policies, because there is nothing to
--      route around.
--
--   4. Recovery. A moderator dismissing a report recomputes the count; if it
--      falls below the threshold the restriction releases automatically.
--      An authorised operator can also clear it directly. Release deletes
--      nothing: friendships, requests and training data were never deleted by
--      the restriction, and reversal restores them exactly as they were.
--
--   5. Privacy. Access in, restriction state is readable by the restricted
--      athlete (they were told what happened) and by service_role (moderation)
--      only. A report stays private to its reporter — the restriction message
--      names the policy and the count, never a reporter's identity.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. State
-- ---------------------------------------------------------------------------
create table public.friend_restriction_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  -- The qualifying count when the row was last written. Bookkeeping for the
  -- operator's list; the live count is the source of truth in the recompute.
  distinct_reports integer not null default 0
    check (distinct_reports >= 0),
  restricted_at timestamptz not null default now(),
  source text not null default 'report_threshold',
  -- Review trail. Set by the moderation evaluation when the count drops below
  -- the threshold (automatic release), or by an operator override.
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  release_note text check (release_note is null or char_length(release_note) <= 500)
);

alter table public.friend_restriction_state enable row level security;

-- The restricted athlete can READ their own row — the screen needs it to show
-- the explanation. Nobody else reads anyone's; reports stay anonymous.
drop policy if exists "Friend restriction readable by self" on public.friend_restriction_state;
create policy "Friend restriction readable by self"
  on public.friend_restriction_state for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete policy: the athlete cannot write these rows, not
-- even by hand-calling the API against their own user. Only the trigger and
-- service_role moderation can.

comment on table public.friend_restriction_state is
  'Friends-feature restriction state. One row per athlete; written by trg_friend_restriction_recompute on content_reports, read by public.is_friend_restricted(), cleared by moderation. Rows are never dormant for the athlete: active=false means the athlete is NOT restricted.';

-- ---------------------------------------------------------------------------
-- 2. The count and the predicate
-- ---------------------------------------------------------------------------
create or replace function public.friend_qualifying_report_count(
  p_athlete_id uuid
)
returns integer
language sql
security definer
set search_path = 'public'
stable
as $$
  -- DISTINCT reporters of NON-dismissed reports: repeated taps from one
  -- account are one report (the schema's unique index already stores them as
  -- one row), and a dismissed (moderator-invalidated) report stops counting.
  select coalesce(count(distinct r.reporter_id), 0)
    from public.content_reports r
   where r.target_type = 'profile'
     and r.target_id = p_athlete_id::text
     and r.status <> 'dismissed';
$$;

revoke all on function public.friend_qualifying_report_count(uuid) from public, anon, authenticated;

create or replace function public.is_friend_restricted(
  p_user_id uuid
)
returns boolean
language sql
security definer
set search_path = 'public'
stable
as $$
  select coalesce(
    (select s.active from public.friend_restriction_state s where s.user_id = p_user_id),
    false
  );
$$;

revoke all on function public.is_friend_restricted(uuid) from public, anon, authenticated;
grant execute on function public.is_friend_restricted(uuid) to service_role;

comment on function public.is_friend_restricted(uuid) is
  'TRUE when Friends access is restricted for this athlete. Security definer so RLS policies and the guard triggers can call it; NOT granted to authenticated — executable by any caller about ANY uuid, it would be a who-is-restricted oracle. The athlete reads their own state through my_friend_restriction(), which never accepts an argument.';

-- ---------------------------------------------------------------------------
-- 3. Recompute: the 4th qualifying report restricts; a drop below releases
-- ---------------------------------------------------------------------------
create or replace function public.recompute_friend_restriction()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_count integer;
  v_threshold constant integer := 4; -- "more than three"
begin
  if new.target_type <> 'profile' then
    return null;
  end if;

  v_count := public.friend_qualifying_report_count(new.target_id::uuid);

  if v_count >= v_threshold then
    -- Activate (or re-activate) the restriction. Never deletes anything:
    -- friendships, requests and training records are untouched. A row that is
    -- currently released keeps its original restricted_at; a fresh row gets
    -- now().
    insert into public.friend_restriction_state (user_id, active, distinct_reports)
    values (new.target_id::uuid, true, v_count)
    on conflict (user_id) do update
      set active = true,
          distinct_reports = excluded.distinct_reports,
          restricted_at = case
            when friend_restriction_state.active = false
            then now()
            else friend_restriction_state.restricted_at
          end,
          released_at = null,
          release_note = null;
    return null;
  end if;

  -- A moderator just dismissed a report and the count fell under the
  -- threshold: release automatically. The row stays (audit), active=false.
  update public.friend_restriction_state s
     set active = false,
         distinct_reports = v_count,
         released_at = now(),
         release_note = coalesce(
           s.release_note,
           'Auto-released: qualifying distinct reports fell below the threshold after moderation dismissed a report.'
         )
   where s.user_id = new.target_id::uuid
     and s.active = true;

  return null;
end;
$$;

revoke all on function public.recompute_friend_restriction() from public, anon, authenticated;

drop trigger if exists trg_friend_restriction_recompute on public.content_reports;
create trigger trg_friend_restriction_recompute
  after insert or update of status on public.content_reports
  for each row
  when (new.target_type = 'profile')
  execute function public.recompute_friend_restriction();

comment on function public.recompute_friend_restriction() is
  'Runs the >3-distinct-report rule after every new profile report and every moderation status change. Threshold is >= 4 DISTINCT non-dismissed reporters. Service-role only: athletes cannot call it, so they cannot pre-arm a restriction against someone.';

-- The trigger can only be armed by report_content(), which is rate-limited
-- (10/hour) and records one row per (reporter, target, reason) — coordinated
-- reporting cannot inject counts faster than that, and every report is
-- reviewer-visible in content_reports. no collateral: unrelated tables are
-- never touched.

-- ---------------------------------------------------------------------------
-- 4. Enforcement
-- ---------------------------------------------------------------------------

-- 4a. Friend requests: refused in BOTH directions while either side is
-- restricted — the restricted athlete cannot send one, and nobody can open a
-- conversation the other athlete cannot read or answer.
create or replace function public.guard_friendrequest_restriction()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if public.is_friend_restricted(new.from_user_id)
     or public.is_friend_restricted(new.to_user_id) then
    raise exception 'Friends access is restricted for one of these accounts'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_friendrequest_restriction() from public, anon, authenticated;

drop trigger if exists trg_guard_friendrequest_restriction on public.friend_requests;
create trigger trg_guard_friendrequest_restriction
  before insert or update of status on public.friend_requests
  for each row
  execute function public.guard_friendrequest_restriction();

-- 4b. Messages: refused in BOTH directions while either side is restricted.
-- Same neutral sentence as a block would read, without naming what happened
-- to the other account.
create or replace function public.guard_messaging_restriction()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if public.is_friend_restricted(new.sender_id)
     or public.is_friend_restricted(new.recipient_id) then
    raise exception 'Friends access is restricted for one of these accounts'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_messaging_restriction() from public, anon, authenticated;

drop trigger if exists trg_guard_messaging_restriction on public.direct_messages;
create trigger trg_guard_messaging_restriction
  before insert on public.direct_messages
  for each row
  execute function public.guard_messaging_restriction();

-- 4c. Friend-list access: the restricted athlete's own list is unreadable by
-- THEM (their app is expected to show the explanation instead; the table right
-- you already had is unchanged for everyone else — other athletes' views of
-- their own friendships are untouched, and no row is ever deleted).
drop policy if exists "Users can view own friendships" on public.friendships;
create policy "Users can view own friendships"
  on public.friendships for select
  to authenticated
  using (
    ((select auth.uid()) = user_id AND NOT public.is_friend_restricted((select auth.uid())))
    or
    ((select auth.uid()) = friend_id)
  );

comment on policy "Users can view own friendships" on public.friendships is
  'Own friends list blocked while the viewer is restricted (friend_restriction_state). Reversal restores the view without restoring or deleting anything.';

-- ---------------------------------------------------------------------------
-- 5. The athlete's own view of their restriction
-- ---------------------------------------------------------------------------
create or replace function public.my_friend_restriction()
returns jsonb
language sql
security definer
set search_path = 'public'
stable
as $$
  select to_jsonb(r)
    from (
      select
        public.is_friend_restricted((select auth.uid())) as restricted,
        public.friend_qualifying_report_count((select auth.uid())) as qualifying_reports,
        4 as threshold_for_restriction -- "more than three": shown so the why is checkable
    ) as r;
$$;

revoke all on function public.my_friend_restriction() from public, anon;
grant execute on function public.my_friend_restriction() to authenticated, service_role;

comment on function public.my_friend_restriction() is
  'The signed-in athlete''s own Friends-restriction state: restricted?, how many qualifying distinct reports, and the policy threshold. Never other athletes'' state, never a reporter''s identity.';

-- ---------------------------------------------------------------------------
-- 6. Moderation: the review lever
-- ---------------------------------------------------------------------------
create or replace function public.moderation_set_friend_restriction(
  p_user_id uuid,
  p_active boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if p_active then
    insert into public.friend_restriction_state (user_id, active, source)
    values (p_user_id, true, 'moderator_override')
    on conflict (user_id) do update
      set active = true,
          released_at = null,
          release_note = case
            when p_note is null or char_length(p_note) <= 500 then p_note
            else left(p_note, 500)
          end;
  else
    update public.friend_restriction_state
       set active = false,
           released_at = now(),
           release_note = coalesce(p_note, 'Access restored by moderation review.')
     where user_id = p_user_id;
  end if;
end;
$$;

-- Single adapter: p_note length. The helper is inline, so nothing else needs
-- to exist for it.
revoke all on function public.moderation_set_friend_restriction(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.moderation_set_friend_restriction(uuid, boolean, text) to service_role;

comment on function public.moderation_set_friend_restriction(uuid, boolean, text) is
  'The moderation review lever for the Friends restriction: service_role only, callable from the operator''s tooling. p_active=false restores access; nothing else is touched. Not an athlete-callable function, so it cannot be abused as a social weapon.';
