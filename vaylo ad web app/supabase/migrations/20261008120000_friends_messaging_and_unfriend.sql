-- ============================================================================
-- FRIENDS: MESSAGING, UNFRIENDING, AND BLOCK COHERENCE
-- ----------------------------------------------------------------------------
-- The friend graph already existed (friend_codes, friend_requests, friendships,
-- accept_friend_request) and so did the safety controls (user_blocks,
-- content_reports, report_content). What was missing was everything an athlete
-- does with a friend afterwards: talk to them, hand them something they did,
-- and — when it goes wrong — unfriend or block them without the friendship
-- quietly surviving the block.
--
-- Four rules this file makes the database's business rather than the client's,
-- because a UI-only rule is not a rule:
--
--   1. Messaging is friends-only, in BOTH directions, and stops the moment
--      either athlete blocks the other. Enforced in a BEFORE INSERT trigger, so
--      a client that skips the screen cannot send around it.
--   2. A conversation is readable only by its two participants — and not by
--      either of them once a block exists between them. Blocking has to stop
--      the messages already in flight, which is the whole point of blocking.
--   3. An attachment can only be YOUR OWN published activity. Otherwise
--      sending a message would be a way to surface somebody else's share.
--   4. Unfriending and blocking are atomic and complete: the friendship rows,
--      the accepted friend_request that authorised them, and any pending
--      request in either direction all move together. Leaving an 'accepted'
--      row behind matters — guard_friendship_pair() certifies a friendship row
--      against it, so a surviving request would let either athlete re-insert
--      the friendship by hand after being unfriended.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CONVERSATION
-- ---------------------------------------------------------------------------
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  -- A message carries words, an attachment, or both — never neither.
  body text not null default '',
  -- The activity being handed over. on delete set null: withdrawing a share
  -- removes the card from the conversation but not the sentence around it.
  activity_id uuid references public.shared_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_not_self check (sender_id <> recipient_id),
  constraint direct_messages_content_shape check (
    char_length(btrim(body)) between 1 and 2000 or activity_id is not null
  )
);

comment on table public.direct_messages is
  'One-to-one messages between friends. Readable only by the two participants, and by neither of them once a block exists between them. Sent only by the signed-in athlete, to a friend, with no block in either direction.';
comment on column public.direct_messages.read_at is
  'Set through mark_messages_read() by the recipient. There is no UPDATE grant on this table, so a recipient cannot edit the words of a message they received.';

-- The three questions this table is read to answer: "our conversation",
-- "my conversations, newest first", and "how many of mine are unread".
create index if not exists idx_direct_messages_recipient
  on public.direct_messages (recipient_id, created_at desc);
create index if not exists idx_direct_messages_sender
  on public.direct_messages (sender_id, created_at desc);
create index if not exists idx_direct_messages_unread
  on public.direct_messages (recipient_id)
  where read_at is null;
create index if not exists idx_direct_messages_activity
  on public.direct_messages (activity_id);

alter table public.direct_messages enable row level security;

-- Participants only, and nothing once a block exists in either direction.
--
-- The block test goes through public.blocked_with() rather than an inline
-- subquery on user_blocks, and that is not a style choice. A policy subquery
-- runs as the querying athlete, and user_blocks is readable only by the
-- BLOCKER ("Blocks are private to the blocker") — so an inline EXISTS cannot
-- see a block where somebody else blocked the viewer, and the blocked athlete
-- would go on reading messages from the athlete who blocked them. A live probe
-- against a first draft of this policy did exactly that.
--
-- This is the same trap the activity feed hit on 2026-10-06
-- (20261006140100_feed_block_filter_both_directions.sql) and blocked_with() is
-- that fix, reused rather than reinvented: security definer, stable, takes only
-- the OTHER athlete's id and pairs it with auth.uid(), so calling it directly
-- reveals nothing beyond the caller's own blocking relationships.
drop policy if exists "Athletes read only their own conversations" on public.direct_messages;
create policy "Athletes read only their own conversations"
  on public.direct_messages for select
  to authenticated
  using (
    ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id)
    and not public.blocked_with(
      case
        when sender_id = (select auth.uid()) then recipient_id
        else sender_id
      end
    )
  );

drop policy if exists "Send only as yourself" on public.direct_messages;
create policy "Send only as yourself"
  on public.direct_messages for insert
  to authenticated
  with check ((select auth.uid()) = sender_id);

-- Unsend. Deleting removes the message for both sides, which is what "unsend"
-- means; there is no per-side copy, so this is the only delete that exists.
drop policy if exists "Unsend your own messages" on public.direct_messages;
create policy "Unsend your own messages"
  on public.direct_messages for delete
  to authenticated
  using ((select auth.uid()) = sender_id);

-- ---------------------------------------------------------------------------
-- 2. WHO MAY BE MESSAGED, AND WHAT MAY BE SENT WITH IT
-- ---------------------------------------------------------------------------
create or replace function public.guard_direct_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sender uuid := auth.uid();
begin
  -- Service-role maintenance has no `sub` claim, so auth.uid() is null there
  -- and there is nothing to compare against; clients always have one, and the
  -- INSERT policy has already pinned the row to them.
  if v_sender is not null and new.sender_id <> v_sender then
    raise exception 'You can only send a message as yourself';
  end if;

  if not exists (
    select 1 from public.friendships f
     where f.user_id = new.sender_id and f.friend_id = new.recipient_id
  ) or not exists (
    select 1 from public.friendships f
     where f.user_id = new.recipient_id and f.friend_id = new.sender_id
  ) then
    raise exception 'You can only message athletes you are friends with';
  end if;

  -- Defence in depth. In practice this is the SECOND guard to fire: a block
  -- also ends the friendship (guard_block_coherence below), so the friendship
  -- check above is what refuses the next message. This one covers a block that
  -- was written with triggers bypassed — a migration, a replica-mode import, an
  -- operator script — where the friendship could still be standing.
  if exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = new.sender_id and b.blocked_id = new.recipient_id)
        or (b.blocker_id = new.recipient_id and b.blocked_id = new.sender_id)
  ) then
    raise exception 'This connection is blocked';
  end if;

  if new.activity_id is not null and not exists (
    select 1 from public.shared_activities s
     where s.id = new.activity_id and s.user_id = new.sender_id
  ) then
    raise exception 'You can only send an activity you have shared yourself';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_direct_message on public.direct_messages;
create trigger trg_guard_direct_message
  before insert on public.direct_messages
  for each row execute function public.guard_direct_message();

-- ---------------------------------------------------------------------------
-- 3. THE BELL
-- ---------------------------------------------------------------------------
-- A message should reach the athlete who is not looking at the chat, and it
-- should not bury every other notification when one friend types six lines in
-- a row: one unread entry per conversation per ten minutes.
--
-- It also respects the athlete's own `notification_prefs.friend_activity`
-- switch, which NotificationPrefs offers and push-notify already reads. A
-- preference that changes nothing is a decoration, not a setting.
create or replace function public.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text;
  v_link text := '/friends/' || new.sender_id::text;
begin
  -- Off means off, for the transcript as well as the push.
  if not coalesce((
    select np.friend_activity
      from public.notification_prefs np
     where np.user_id = new.recipient_id
  ), true) then
    return new;
  end if;

  if exists (
    select 1 from public.notifications n
     where n.user_id = new.recipient_id
       and n.type = 'message'
       and n.link = v_link
       and n.read = false
       and n.created_at > now() - interval '10 minutes'
  ) then
    return new;
  end if;

  -- `avatars` is the schema's public identity table; `profiles` is self-only
  -- and could never name another athlete here.
  select nullif(btrim(a.display_name), '') into v_name
    from public.avatars a
   where a.user_id = new.sender_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.recipient_id,
    'message',
    coalesce(v_name, 'A friend') || ' sent you a message',
    left(coalesce(nullif(btrim(new.body), ''), 'Shared an activity'), 160),
    v_link
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_direct_message on public.direct_messages;
create trigger trg_notify_direct_message
  after insert on public.direct_messages
  for each row execute function public.notify_direct_message();

-- ---------------------------------------------------------------------------
-- 4. MARKING A CONVERSATION READ
-- ---------------------------------------------------------------------------
-- An RPC rather than an UPDATE policy: the recipient needs to write `read_at`
-- and nothing else, and a policy that allowed UPDATE on the row would also
-- allow rewriting the message they were sent.
create or replace function public.mark_messages_read(p_friend_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  update public.direct_messages
     set read_at = now()
   where recipient_id = v_user
     and sender_id = p_friend_id
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. UNFRIENDING
-- ---------------------------------------------------------------------------
-- The two friendship rows are one relationship. Deleting them from a client
-- would be two round trips that can half-fail, and it would leave the accepted
-- friend_request behind — which is what guard_friendship_pair() certifies a
-- friendship against, so either athlete could put the friendship back by hand.
create or replace function public.unfriend(p_friend_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_removed integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_friend_id is null or p_friend_id = v_user then return false; end if;

  delete from public.friendships
   where (user_id = v_user and friend_id = p_friend_id)
      or (user_id = p_friend_id and friend_id = v_user);
  get diagnostics v_removed = row_count;

  -- Pending requests in either direction go too, so neither athlete is left
  -- looking at a request from someone who has just unfriended them.
  delete from public.friend_requests
   where (from_user_id = v_user and to_user_id = p_friend_id)
      or (from_user_id = p_friend_id and to_user_id = v_user);

  return v_removed > 0;
end;
$$;

comment on function public.unfriend(uuid) is
  'Ends a friendship in one transaction: both directional rows, the accepted request that authorised them, and every pending request between the two. The conversation itself is kept — history is both athletes'' data.';

-- ---------------------------------------------------------------------------
-- 5b. A REQUEST TO SOMEONE WHO IS ALREADY A FRIEND IS NOT A REQUEST
-- ---------------------------------------------------------------------------
-- Codes are the only way to address an athlete you have not met, and nothing
-- maps a friend's code for you, so an athlete can paste a code for somebody
-- they already train with. Without this the pair would sit in the friends list
-- AND in the request list at once, and accepting would try to insert two
-- friendship rows that are already there.
create or replace function public.guard_friend_request_existing_friend()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.friendships f
     where f.user_id = new.from_user_id and f.friend_id = new.to_user_id
  ) and exists (
    select 1 from public.friendships f
     where f.user_id = new.to_user_id and f.friend_id = new.from_user_id
  ) then
    raise exception 'You are already friends with this athlete';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_friend_request_existing_friend on public.friend_requests;
create trigger trg_guard_friend_request_existing_friend
  before insert on public.friend_requests
  for each row execute function public.guard_friend_request_existing_friend();

-- ---------------------------------------------------------------------------
-- 6. BLOCKING IS ALSO UNFRIENDING
-- ---------------------------------------------------------------------------
-- Blocking used to leave the friendship in place: user_blocks refused new
-- friend requests, but the friend could still see the friend list entry, and
-- messaging would have started from a graph that says "still friends". This
-- makes the two states agree, whatever client writes the block.
create or replace function public.guard_block_coherence()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.friendships
   where (user_id = new.blocker_id and friend_id = new.blocked_id)
      or (user_id = new.blocked_id and friend_id = new.blocker_id);

  delete from public.friend_requests
   where (from_user_id = new.blocker_id and to_user_id = new.blocked_id)
      or (from_user_id = new.blocked_id and to_user_id = new.blocker_id);

  return new;
end;
$$;

drop trigger if exists trg_guard_block_coherence on public.user_blocks;
create trigger trg_guard_block_coherence
  after insert on public.user_blocks
  for each row execute function public.guard_block_coherence();

comment on function public.guard_block_coherence() is
  'A block ends the friendship and clears every friend request between the two athletes, in both directions. Keeps the friend graph and the block list from disagreeing about the same relationship.';

comment on function public.notify_direct_message() is
  'Writes one notification for a new message, at most once per conversation per ten minutes, and only while the recipient has notification_prefs.friend_activity on (no row = on).';

-- ---------------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------------
-- Nothing for anon, no UPDATE for anyone: read receipts are the RPC's job.
revoke all on table public.direct_messages from anon;
revoke all on table public.direct_messages from public;
-- Supabase's default privileges hand every new table ALL to anon and
-- authenticated, so `grant select, insert, delete` alone would leave UPDATE,
-- TRUNCATE, REFERENCES and TRIGGER in place. RLS has no UPDATE policy here and
-- would deny the write anyway, but a grant nobody needs is exactly what the
-- least-privilege passes in this repo exist to remove — and "no UPDATE" should
-- be true of the live database, not only of this file.
revoke update, truncate, references, trigger on table public.direct_messages from authenticated;
grant select, insert, delete on table public.direct_messages to authenticated;

revoke execute on function public.guard_direct_message() from public, anon, authenticated;
revoke execute on function public.notify_direct_message() from public, anon, authenticated;
revoke execute on function public.guard_block_coherence() from public, anon, authenticated;
revoke execute on function public.guard_friend_request_existing_friend() from public, anon, authenticated;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

revoke all on function public.unfriend(uuid) from public, anon;
grant execute on function public.unfriend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. LIVE DELIVERY
-- ---------------------------------------------------------------------------
-- A message that arrives only when the recipient pulls to refresh is not really
-- a message. Supabase Realtime can only stream a table that is in the
-- `supabase_realtime` publication, and `notifications` was never added to it —
-- so useNotifications()'s subscription has never fired either, which is why the
-- bell only updates on a fresh page load.
--
-- Wrapped in a publication check so this migration is not Supabase-specific:
-- on a plain Postgres without the publication there is nothing to add to.
-- Realtime applies RLS per subscriber, so a client is still only sent its own
-- rows (and, once a block exists, neither athlete's).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.direct_messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';
