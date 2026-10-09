-- ===========================================================================
-- SOCIAL BLOCKING
-- ---------------------------------------------------------------------------
-- Minimal, complete abuse control: an athlete can block another athlete, and
-- the database then refuses friend requests between the two in EITHER
-- direction. Blocking is private — only the blocker sees their blocks.
--
-- Deliberately out of scope (documented in the package report as pending
-- product decisions): hiding blocked athletes from feed/leaderboard surfaces,
-- content reports, and admin review tooling.
-- ===========================================================================

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_not_self check (blocker_id <> blocked_id),
  constraint user_blocks_pair_uniq unique (blocker_id, blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "Blocks are private to the blocker" on public.user_blocks;
create policy "Blocks are private to the blocker"
  on public.user_blocks for select
  to authenticated
  using ((select auth.uid()) = blocker_id);

drop policy if exists "Users block anyone but themselves" on public.user_blocks;
create policy "Users block anyone but themselves"
  on public.user_blocks for insert
  to authenticated
  with check ((select auth.uid()) = blocker_id);

drop policy if exists "Users unblock" on public.user_blocks;
create policy "Users unblock"
  on public.user_blocks for delete
  to authenticated
  using ((select auth.uid()) = blocker_id);

-- Blocked means no requests in either direction, regardless of the recipient's
-- other privacy settings. (A separate trigger so this rule reads on its own.)
create or replace function public.guard_friend_request_blocked()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = new.to_user_id and b.blocked_id = new.from_user_id)
        or (b.blocker_id = new.from_user_id and b.blocked_id = new.to_user_id)
  ) then
    raise exception 'This connection is blocked';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_friend_blocked on public.friend_requests;
create trigger trg_guard_friend_blocked
  before insert on public.friend_requests
  for each row execute function public.guard_friend_request_blocked();

-- Client API surface: block, list, unblock. Nothing for anon.
grant select, insert, delete on table public.user_blocks to authenticated;

notify pgrst, 'reload schema';
