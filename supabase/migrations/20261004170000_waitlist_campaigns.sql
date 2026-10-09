-- ============================================================================
-- waitlist campaigns — the dated launch sequence (countdowns + launch day)
-- ----------------------------------------------------------------------------
-- The waiting list could already receive a one-off broadcast, but a broadcast
-- only exists when a human runs it. A launch announcement has a date, and a
-- date that depends on somebody remembering it is a date that gets missed.
-- This migration makes the sends happen on their own schedule.
--
-- The shape, and why it is this shape:
--
--   * pg_cron decides WHEN. A daily job at 09:00 UTC asks the edge function
--     whether anything is due. It does not hold the message copy: copy belongs
--     in code, where it can be reviewed and tested, not in a cron command.
--
--   * pg_net makes the call. pg_cron cannot open an HTTPS connection to an edge
--     function on its own, and Postgres cannot speak SMTP at all, so the job
--     posts to the function and the function does the sending.
--
--   * The trigger cannot carry a credential inline. A service-role key pasted
--     into a cron command would live in `cron.job` in plain text for anyone who
--     can read that table. Instead the secret is stored once in Supabase Vault
--     (encrypted at rest) and read at fire time; the migration never contains
--     it, and the value can be rotated in one place.
--
--   * Exactly-once per (campaign, address) is enforced in the database, not in
--     the function. SMTP is a network call that can fail or be cut off, so the
--     only safe place for "this person already got this" is a primary key.
--     waitlist_campaign_sends is that key, and the claim below is what stops a
--     retry — or an overlapping run — from mailing the same person twice.
--
--   * The two tables are service-role only and deny everything to anon and
--     authenticated, the same shape as waitlist_signups, because
--     waitlist_campaign_sends is a list of who was mailed, keyed by address.
-- ============================================================================

-- Scheduling primitives. Both are idempotent, so a re-run is a no-op rather
-- than an error. pg_cron lands its objects in pg_catalog and exposes functions
-- in the `cron` schema; pg_net exposes `net.http_post`. Verified on this
-- project before this file was written.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- What campaigns exist, and when each is due
--
-- Defines WHEN and the bookkeeping. The key/subject/body live in the edge
-- function and are synced here on each run; this row is what the run reads to
-- decide "is anything due, and has it finished".
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist_campaigns (
  -- Stable identifier used by the function's copy table (e.g. "launch").
  campaign_key text        primary key,

  -- When the campaign becomes sendable. UTC; the daily job fires at 09:00 UTC
  -- and a campaign whose send_at has passed is picked up on the next run.
  send_at      timestamptz not null,

  -- pending  — not sent yet (or being sent)
  -- done     — every remaining recipient has been mailed
  -- skipped  — deliberately not sent (see waitlist-campaigns: a countdown that
  --            is too far past its date is misleading, so it is skipped rather
  --            than sent late)
  status       text        not null default 'pending'
                 check (status in ('pending', 'done', 'skipped')),

  sent_count   integer     not null default 0,
  last_run_at  timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The exactly-once ledger: one row per (campaign, address)
--
-- A row is inserted as 'claimed' BEFORE the message is sent, so an overlapping
-- run that sees the same candidate loses the race on the primary key and skips
-- it. On success it becomes 'sent'. On failure the row is deleted, so the next
-- run retries the address — a failed send must not look like a delivered one.
-- A claim that is never resolved (the function was cut off mid-send) is
-- reclaimable after an hour; see waitlist_claim_campaign_send.
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist_campaign_sends (
  campaign_key text        not null
                 references public.waitlist_campaigns (campaign_key) on delete cascade,
  email        text        not null,
  status       text        not null default 'claimed'
                 check (status in ('claimed', 'sent')),
  claimed_at   timestamptz not null default now(),
  sent_at      timestamptz,
  primary key (campaign_key, email)
);

-- The recipient query runs "who has NOT got this campaign", so the send rows
-- are looked up by key; the primary key already covers that. This index is for
-- the reverse question operators ask ("what has this address received"), which
-- is a manual lookup rather than a hot path.
create index if not exists waitlist_campaign_sends_email_idx
  on public.waitlist_campaign_sends (email);

-- ---------------------------------------------------------------------------
-- Completing the campaign is a count of what is left, not a flag the function
-- sets when it feels done.
-- ---------------------------------------------------------------------------
create or replace function public.waitlist_campaign_remaining(p_campaign_key text)
returns integer
language sql
security definer
set search_path to 'public'
stable
as $$
  select count(*)::integer
    from public.waitlist_signups s
   where s.unsubscribed_at is null
     and not exists (
       select 1
         from public.waitlist_campaign_sends c
        where c.campaign_key = p_campaign_key
          and c.email = s.email
     );
$$;

-- ---------------------------------------------------------------------------
-- The next batch of recipients for a campaign
--
-- Excludes anyone who has left the list and anyone with a claim or a sent row
-- for this campaign. Ordered by signup time so the longest-standing people are
-- mailed first if a list takes more than one batch.
-- ---------------------------------------------------------------------------
create or replace function public.waitlist_campaign_recipients(
  p_campaign_key text,
  p_limit integer
)
returns table (email text, display_name text, unsubscribe_token uuid)
language sql
security definer
set search_path to 'public'
stable
as $$
  select s.email, s.display_name, s.unsubscribe_token
    from public.waitlist_signups s
   where s.unsubscribed_at is null
     and not exists (
       select 1
         from public.waitlist_campaign_sends c
        where c.campaign_key = p_campaign_key
          and c.email = s.email
     )
   order by s.created_at
   limit greatest(1, least(p_limit, 200));
$$;

-- ---------------------------------------------------------------------------
-- Claim one recipient atomically
--
-- Returns true only to the caller that now owns this (campaign, address):
--
--   * no existing row            -> the insert wins, claim taken
--   * an existing 'sent' row     -> the update's WHERE excludes it, nothing
--                                   returned, false (never mail twice)
--   * an existing fresh 'claimed'-> same, false (a run in flight owns it)
--   * an existing STALE 'claimed'-> reclaimed, because a run that was cut off
--                                   must not strand an address forever
--
-- The staleness window is an hour: long enough that a slow-but-live send is not
-- stolen, short enough that a crashed run is retried the same day.
-- ---------------------------------------------------------------------------
create or replace function public.waitlist_claim_campaign_send(
  p_campaign_key text,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_taken boolean;
begin
  with claimed as (
    insert into public.waitlist_campaign_sends (campaign_key, email, status, claimed_at)
    values (p_campaign_key, p_email, 'claimed', now())
    on conflict (campaign_key, email) do update
      set status = 'claimed',
          claimed_at = now()
      where public.waitlist_campaign_sends.status = 'claimed'
        and public.waitlist_campaign_sends.claimed_at < now() - interval '1 hour'
    returning 1
  )
  select exists (select 1 from claimed) into v_taken;

  return v_taken;
end $$;

-- Mark a claim as genuinely sent. Called only after the SMTP conversation was
-- accepted; a failure deletes the claim instead (see the release function).
create or replace function public.waitlist_mark_campaign_sent(
  p_campaign_key text,
  p_email text
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.waitlist_campaign_sends
     set status = 'sent',
         sent_at = now()
   where campaign_key = p_campaign_key
     and email = p_email;
$$;

-- Give a claim back after a failed send, so the next run retries the address
-- rather than treating a failure as delivered. Only ever removes a row that is
-- still 'claimed' — a sent row is never deleted, so this cannot erase history.
create or replace function public.waitlist_release_campaign_send(
  p_campaign_key text,
  p_email text
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.waitlist_campaign_sends
   where campaign_key = p_campaign_key
     and email = p_email
     and status = 'claimed';
$$;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Deny-everything to the two client roles, exactly like waitlist_signups, and
-- the service role (which bypasses RLS) as the only reader/writer. These tables
-- name who was mailed, so a read grant would be the same disclosure as reading
-- the signup list.
-- ---------------------------------------------------------------------------
alter table public.waitlist_campaigns enable row level security;
alter table public.waitlist_campaign_sends enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'waitlist_campaigns'
       and policyname = 'waitlist_campaigns_denied'
  ) then
    create policy "waitlist_campaigns_denied"
      on public.waitlist_campaigns
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'waitlist_campaign_sends'
       and policyname = 'waitlist_campaign_sends_denied'
  ) then
    create policy "waitlist_campaign_sends_denied"
      on public.waitlist_campaign_sends
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

grant all on public.waitlist_campaigns to service_role;
grant all on public.waitlist_campaign_sends to service_role;

-- The RPCs are called only by the edge function, with the service role. Nothing
-- is granted to anon or authenticated, so the client roles cannot reach the
-- recipient list even by name.
revoke all on function public.waitlist_campaign_remaining(text) from public, anon, authenticated;
revoke all on function public.waitlist_campaign_recipients(text, integer) from public, anon, authenticated;
revoke all on function public.waitlist_claim_campaign_send(text, text) from public, anon, authenticated;
revoke all on function public.waitlist_mark_campaign_sent(text, text) from public, anon, authenticated;
revoke all on function public.waitlist_release_campaign_send(text, text) from public, anon, authenticated;

grant execute on function public.waitlist_campaign_remaining(text) to service_role;
grant execute on function public.waitlist_campaign_recipients(text, integer) to service_role;
grant execute on function public.waitlist_claim_campaign_send(text, text) to service_role;
grant execute on function public.waitlist_mark_campaign_sent(text, text) to service_role;
grant execute on function public.waitlist_release_campaign_send(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The scheduled trigger
--
-- Runs daily and asks the deployed function whether a campaign is due. It is
-- fire-and-forget: the HTTP call returns a request id immediately and the
-- function does the sending in the background, so a slow SMTP run can never
-- hold up cron.
--
-- The secret is read from Vault at fire time. `waitlist_cron_secret` is created
-- out of band (see supabase/functions/DEPLOY_NOTES.md) and must hold the same
-- value as the function's WAITLIST_CRON_SECRET. Absent the secret the job does
-- nothing and logs a warning rather than posting an unauthenticated request.
--
-- The URL is the project's own function endpoint. It is written out rather than
-- derived because there is no reliable way to read the project ref from inside
-- the database, and a cron job that silently points at the wrong project is
-- worse than one that is explicit. If the project is ever moved, this line
-- moves with it.
-- ---------------------------------------------------------------------------
create or replace function public.waitlist_trigger_campaigns()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets ds
   where ds.name = 'waitlist_cron_secret'
   limit 1;

  if v_secret is null then
    raise warning 'waitlist_trigger_campaigns: vault secret "waitlist_cron_secret" is not set; nothing was sent';
    return null;
  end if;

  select net.http_post(
    url := 'https://vvwhausdjzdmsyxekrcl.supabase.co/functions/v1/waitlist-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.waitlist_trigger_campaigns() from public, anon, authenticated;
grant execute on function public.waitlist_trigger_campaigns() to service_role;

-- 09:00 UTC daily. Named so a redeploy of this migration does not stack a
-- second identical job; cron.schedule upserts by job name.
select cron.schedule(
  'waitlist-campaigns-daily',
  '0 9 * * *',
  $$select public.waitlist_trigger_campaigns()$$
);
