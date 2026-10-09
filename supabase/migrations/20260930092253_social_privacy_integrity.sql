-- ===========================================================================
-- SOCIAL & PRIVACY INTEGRITY
-- ---------------------------------------------------------------------------
-- Privacy settings must be enforced by the database, not just honoured by the
-- UI: a toggle that only changes what the client draws is not privacy.
--
-- Rules that need a cross-row lookup are BEFORE triggers (PostgreSQL CHECK
-- constraints cannot contain subqueries). Plain value rules stay CHECKs.
-- Every rule was checked against live data (zero violations) before being
-- added; the social tables are effectively empty today.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. FRIEND REQUESTS — status lifecycle + recipient privacy
-- ---------------------------------------------------------------------------
alter table public.friend_requests
  drop constraint if exists friend_requests_status_allowed;
alter table public.friend_requests
  add constraint friend_requests_status_allowed
  check (status in ('pending', 'accepted', 'declined'));

-- A request can never address the sender (plain check, fires on every write).
alter table public.friend_requests
  drop constraint if exists friend_requests_no_self_request;
alter table public.friend_requests
  add constraint friend_requests_no_self_request
  check (from_user_id <> to_user_id);

-- The recipient's privacy_settings row is authoritative for NEW requests
-- (no row = defaults-on, matching the app default). An opposite-direction
-- pending request is answered with "accept it instead", not a duplicate.
create or replace function public.guard_friend_request_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.friend_requests fr
     where fr.from_user_id = new.to_user_id
       and fr.to_user_id = new.from_user_id
       and fr.status = 'pending'
  ) then
    raise exception 'This athlete has already sent you a request — accept it instead';
  end if;
  if not coalesce((
    select ps.allow_friend_requests
      from public.privacy_settings ps
     where ps.user_id = new.to_user_id
  ), true) then
    raise exception 'This athlete is not accepting friend requests';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_friend_request on public.friend_requests;
create trigger trg_guard_friend_request
  before insert on public.friend_requests
  for each row execute function public.guard_friend_request_insert();

-- Senders can cancel their own pending request (RLS previously had no DELETE,
-- so "cancel" was impossible from any client).
drop policy if exists "Senders cancel their own pending requests" on public.friend_requests;
create policy "Senders cancel their own pending requests"
  on public.friend_requests for delete
  to authenticated
  using (
    (select auth.uid()) = from_user_id
    and status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- 2. FRIENDSHIPS — only creatable against an ACCEPTED request, always in pairs
-- ---------------------------------------------------------------------------
-- A friendship row must be documented: either the reciprocal row already
-- exists, or an accepted friend_request between the two athletes exists (the
-- atomic accept RPC marks the request accepted before inserting the pair).
-- A forged single-row insert — replaying a request, writing a friendship
-- without an accepted request, or accepting someone else's flow — is rejected.
create or replace function public.guard_friendship_pair()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.friendships f
     where f.user_id = new.friend_id
       and f.friend_id = new.user_id
  )
  and not exists (
    select 1 from public.friend_requests fr
     where fr.status = 'accepted'
       and ((fr.from_user_id = new.user_id and fr.to_user_id = new.friend_id)
         or (fr.from_user_id = new.friend_id and fr.to_user_id = new.user_id))
  ) then
    raise exception 'Friendships are created by accepting a friend request';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_friendship_pair on public.friendships;
create trigger trg_friendship_pair
  before insert on public.friendships
  for each row execute function public.guard_friendship_pair();

-- Atomic accept: mark the request accepted, then create BOTH friendship rows
-- in one security-definer call. Two updates of the same row can never both
-- flip it from pending, so double-accept and racing tabs collapse to one
-- friendship; the pair trigger documents each row against the accepted
-- request. Returns the new friend's id, or null when nothing was pending.
create or replace function public.accept_friend_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_from uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  update public.friend_requests
     set status = 'accepted'
   where id = p_request_id
     and to_user_id = v_user
     and status = 'pending'
  returning from_user_id into v_from;

  if v_from is null then
    return null; -- not found, not yours, already handled, or not pending
  end if;

  insert into public.friendships (user_id, friend_id) values (v_user, v_from);
  insert into public.friendships (user_id, friend_id) values (v_from, v_user);

  return v_from;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. CHALLENGES — real targets, sane windows, non-negative progress
-- ---------------------------------------------------------------------------
alter table public.challenges
  drop constraint if exists challenges_valid_window;
alter table public.challenges
  add constraint challenges_valid_window
  check (end_date >= start_date);

-- target_value <= 0 completes instantly on first log; refuse to store it.
alter table public.challenges
  drop constraint if exists challenges_target_positive;
alter table public.challenges
  add constraint challenges_target_positive
  check (target_value > 0);

alter table public.challenge_participants
  drop constraint if exists challenge_participants_progress_non_negative;
alter table public.challenge_participants
  add constraint challenge_participants_progress_non_negative
  check (progress >= 0);

-- ---------------------------------------------------------------------------
-- 4. COMMUNITIES — closed privacy/role sets, owner is the only leader
-- ---------------------------------------------------------------------------
alter table public.communities
  drop constraint if exists communities_privacy_allowed;
alter table public.communities
  add constraint communities_privacy_allowed
  check (privacy in ('public', 'private', 'invite'));

alter table public.community_members
  drop constraint if exists community_members_role_allowed;
alter table public.community_members
  add constraint community_members_role_allowed
  check (role in ('member', 'moderator', 'leader'));

-- Nobody but the community owner can HOLD the leader role — this closes
-- self-promotion regardless of which client writes the row.
create or replace function public.guard_member_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role = 'leader' then
    if exists (
      select 1 from public.communities c
       where c.id = new.community_id
         and c.owner_id <> new.user_id
    ) then
      raise exception 'Only the community owner is a leader';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_role on public.community_members;
create trigger trg_member_role
  before insert or update of role on public.community_members
  for each row execute function public.guard_member_role();

-- Members can update only their own row (notifications toggle, stepping down),
-- and the community OWNER can manage roles inside their community. The
-- trg_member_role trigger remains the single authority on who may hold
-- 'leader'. (The previous policy let the owner UI exist but silently failed
-- every role change with an RLS error — owner role management never worked.)
drop policy if exists "Users update own membership" on public.community_members;
drop policy if exists "Members update only their own row" on public.community_members;
create policy "Members self-serve, owners manage roles"
  on public.community_members for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.communities c
       where c.id = community_id
         and c.owner_id = (select auth.uid())
    )
  )
  with check (
    (
      (select auth.uid()) = user_id
      and role in ('member', 'moderator') -- a member cannot promote themselves
    )
    or exists (
      select 1 from public.communities c
       where c.id = community_id
         and c.owner_id = (select auth.uid())
    )
  );

-- Joining is only self-service for PUBLIC communities. Private and invite-only
-- communities are added by their owner (no invite flow exists yet — see the
-- launch-decision note in the package report); the owner row itself is created
-- by the security-definer handle_community_created trigger.
drop policy if exists "Users join communities" on public.community_members;
create policy "Join public communities"
  on public.community_members for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.communities c
       where c.id = community_id
         and c.privacy = 'public'
    )
  );

alter table public.community_posts
  drop constraint if exists community_posts_content_shape;
alter table public.community_posts
  add constraint community_posts_content_shape
  check (char_length(btrim(content)) between 1 and 2000);

-- Private and invite-only communities are not publicly enumerable: the old
-- "Communities viewable by all" policy handed every private community's name,
-- description and member count to every authenticated (and anonymous) caller.
drop policy if exists "Communities viewable by all" on public.communities;
create policy "Communities visible by privacy"
  on public.communities for select
  to authenticated
  using (
    privacy = 'public'
    or owner_id = (select auth.uid())
    or is_community_member(id, (select auth.uid()))
  );

-- The feed tables were readable by `anon` as well as authenticated athletes;
-- the app has no anonymous surfaces, so scope them to authenticated.
drop policy if exists "Shared activities are viewable by everyone" on public.shared_activities;
create policy "Shared activities viewable by authenticated"
  on public.shared_activities for select
  to authenticated
  using (true);

drop policy if exists "Hypes are viewable by everyone" on public.activity_hypes;
create policy "Hypes viewable by authenticated"
  on public.activity_hypes for select
  to authenticated
  using (true);

drop policy if exists "Members viewable by all authed" on public.community_members;
create policy "Members viewable by community and self"
  on public.community_members for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or is_community_member(community_id, (select auth.uid()))
    or exists (
      select 1 from public.communities c
       where c.id = community_id
         and c.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Pinned avatars viewable by all authed" on public.community_pinned_avatars;
create policy "Pinned avatars viewable by community"
  on public.community_pinned_avatars for select
  to authenticated
  using (
    is_community_member(community_id, (select auth.uid()))
    or exists (
      select 1 from public.communities c
       where c.id = community_id
         and c.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. SHARED ACTIVITIES — one published row per source, idempotent re-share
-- ---------------------------------------------------------------------------
-- (user_id, source_kind, source_id): NULL source_id (free-form notes) stays
-- unconstrained because Postgres unique treats NULLs as distinct.
alter table public.shared_activities
  drop constraint if exists shared_activities_source_unique;
alter table public.shared_activities
  add constraint shared_activities_source_unique
  unique (user_id, source_kind, source_id);

-- ---------------------------------------------------------------------------
-- 6. RPC FIXES
-- ---------------------------------------------------------------------------
-- join_challenge: expired or not-yet-open challenges cannot be joined.
create or replace function public.join_challenge(p_challenge uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if exists (
    select 1 from public.challenges c
     where c.id = p_challenge
       and (c.end_date < current_date or c.start_date > current_date)
  ) then
    raise exception 'This challenge is not open for joining';
  end if;
  insert into public.challenge_participants(challenge_id, user_id)
  values (p_challenge, v_user)
  on conflict (challenge_id, user_id) do update set status = 'active'
  returning id into v_id;
  return v_id;
end;
$$;

-- join_challenge_by_id: only open challenges are joinable, and the participant
-- count is READ BACK after insert — the count-sync trigger owns that column
-- now (the old code added +1 here too, double-counting every join).
create or replace function public.join_challenge_by_id(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_exists boolean;
  v_count integer;
begin
  if v_user is null then
    return jsonb_build_object('joined', false, 'reason', 'auth_required');
  end if;

  select exists(
    select 1 from public.challenges
     where id = p_challenge
       and end_date >= current_date
       and start_date <= current_date
  ) into v_exists;
  if not v_exists then
    return jsonb_build_object('joined', false, 'reason', 'not_found_or_closed');
  end if;

  if exists(
    select 1 from public.challenge_participants
     where challenge_id = p_challenge and user_id = v_user
  ) then
    return jsonb_build_object('joined', true, 'already', true);
  end if;

  insert into public.challenge_participants (challenge_id, user_id, progress, status, joined_at)
  values (p_challenge, v_user, 0, 'active', now());

  select participant_count into v_count
    from public.challenges where id = p_challenge;

  return jsonb_build_object('joined', true, 'already', false, 'participant_count', v_count);
end;
$$;

-- update_challenge_progress: unchanged formula/behaviour, plus a guard so a
-- legacy zero/negative target cannot award completion on the first log.
create or replace function public.update_challenge_progress(p_challenge uuid, p_delta numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_row public.challenge_participants%ROWTYPE;
  v_ch public.challenges%ROWTYPE;
  v_completed boolean := false;
  v_step integer;
  v_max_step integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  -- Reject the shapes that make the old function a one-tap win: negative,
  -- non-finite, larger than the challenge target, or larger than any plausible
  -- single session (a 100km "session" is a typo or an attack).
  if p_delta is null or p_delta <= 0 or p_delta <> trunc(p_delta) then
    raise exception 'Progress must be a positive whole number';
  end if;

  select * into v_ch from public.challenges where id = p_challenge;
  if not found then raise exception 'Challenge not found'; end if;
  if coalesce(v_ch.target_value, 0) <= 0 then
    raise exception 'This challenge has an invalid target';
  end if;

  v_max_step := least(greatest(coalesce(v_ch.target_value, 1), 1), 1000);
  v_step := least(p_delta::integer, v_max_step);
  if p_delta::numeric > v_max_step then
    -- Returned rather than raised so the screen can explain itself, and so the
    -- athlete keeps the (clamped) progress they legitimately logged.
    v_step := v_max_step;
  end if;

  if v_ch.start_date is not null and now() < v_ch.start_date then
    raise exception 'This challenge has not started yet';
  end if;
  if v_ch.end_date is not null and now() > v_ch.end_date then
    raise exception 'This challenge has ended';
  end if;

  select * into v_row from public.challenge_participants
   where challenge_id = p_challenge and user_id = v_user for update;
  if not found then raise exception 'Not joined'; end if;
  if v_row.status = 'completed' then
    return jsonb_build_object('progress', v_row.progress, 'completed', true, 'awarded', false);
  end if;

  update public.challenge_participants
     set progress = progress + v_step
   where id = v_row.id returning * into v_row;

  if v_row.progress >= v_ch.target_value then
    update public.challenge_participants set status = 'completed', completed_at = now() where id = v_row.id;
    v_completed := true;
    insert into public.points_events(user_id, points, source, sport)
    values (v_user, v_ch.reward_points, 'challenge:' || v_ch.id, v_ch.sport);
    insert into public.achievements(user_id, type, title, description, icon)
    values (v_user, 'challenge', 'Completed: ' || v_ch.title, v_ch.description, coalesce(v_ch.icon, 'trophy'));
  end if;

  return jsonb_build_object(
    'progress', v_row.progress, 'target', v_ch.target_value,
    'completed', v_completed, 'reward_points', v_ch.reward_points,
    'clamped', p_delta::numeric > v_max_step
  );
end;
$$;

notify pgrst, 'reload schema';
