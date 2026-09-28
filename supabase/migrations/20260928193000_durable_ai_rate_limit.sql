-- ============================================================================
-- A RATE LIMIT THAT SURVIVES A COLD START
-- ----------------------------------------------------------------------------
-- _shared/guard.ts throttles with an in-memory Map: 20 AI calls a minute per
-- user, per function instance. Supabase runs each function on more than one
-- instance and recycles them, so the counter an attacker is up against is
-- whichever instance happened to answer, and it resets whenever that instance
-- is replaced. It is a speed bump, not a limit.
--
-- That matters more than usual here because every one of these calls is billed
-- to OPENAI_API_KEY. The credit balance is the real bound, and it is a good
-- one now that paid packs are refused and trials are one per account — but a
-- per-instance counter should not be the thing standing between a script and
-- your invoice.
--
-- The counter lives in Postgres because that is the only shared, already-authorised
-- place in the stack: auth.uid() already identifies the caller, and the write
-- needs no new trust.
-- ============================================================================

create table if not exists public.ai_call_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_call_events_user_recent_idx
  on public.ai_call_events (user_id, created_at desc);

alter table public.ai_call_events enable row level security;

-- No policies on purpose: the table is written only by the function below, as
-- the caller, and read by nobody but an operator. RLS with no policy is closed.

-- ---------------------------------------------------------------------------
-- The limiter
-- ---------------------------------------------------------------------------
-- Returns true when the call is allowed, in which case the call is also
-- recorded. One round trip, so it costs the same as the read it replaces.
--
-- `p_max` and `p_window_seconds` are parameters rather than constants so each
-- endpoint can be bounded by what it actually costs: a video analysis is not a
-- text prompt, and a coach reply is not a form analysis.
create or replace function public.ai_call_allowed(
  p_feature text,
  p_max integer default 20,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_max integer := greatest(coalesce(p_max, 20), 1);
  v_window integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_used integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into v_used
    from public.ai_call_events
   where user_id = v_user
     and feature = p_feature
     and created_at > now() - make_interval(secs => v_window);

  if v_used >= v_max then
    return false;
  end if;

  insert into public.ai_call_events (user_id, feature) values (v_user, p_feature);

  -- Housekeeping, in the same transaction, one call in fifty: an append-only
  -- rate-limit table is otherwise a slow leak. Doing it here rather than from a
  -- scheduled job keeps the row count bounded without another moving part.
  if random() < 0.02 then
    delete from public.ai_call_events where created_at < now() - interval '7 days';
  end if;

  return true;
end;
$function$;

revoke all on function public.ai_call_allowed(text, integer, integer) from public, anon;
grant execute on function public.ai_call_allowed(text, integer, integer) to authenticated, service_role;
