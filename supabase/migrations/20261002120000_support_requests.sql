-- ============================================================================
-- support_requests — the inbox behind the public Vaylo Sports website
-- ----------------------------------------------------------------------------
-- Why this exists.
--
-- The website has forms a visitor can use without an account: support, privacy
-- and data rights, safety and child-safety reports, purchase problems, and
-- account-deletion requests. A form that submits nowhere is worse than no form,
-- because it tells a person their report was received when it was not — and for
-- a child-safety report that is a serious harm, not a cosmetic bug.
--
-- So the website posts to a real edge function (support-request), which
-- validates, rate-limits and writes here. Rows are read by the operator in the
-- Supabase dashboard. There is no email provider wired up in this project, and
-- this table is the honest answer to "where does my message actually go".
--
-- Design notes that matter:
--
--   * No public read access, at all. A submissions table must never be
--     selectable by anon or authenticated roles: anyone could enumerate other
--     people's reports, including the email addresses of people who reported
--     child safety concerns. RLS below denies everything; the edge function
--     writes with the service role, which bypasses RLS by design.
--
--   * A short random reference, not a sequential id. It is quoted back to the
--     sender and lets an operator find the row without exposing a row count
--     that tells a spammer how busy the service is.
--
--   * `is_child_safety` is a first-class column rather than a string match on
--     the body. It is the one category where response time is a safety
--     question rather than a service question, and it has to be queryable.
--
--   * Rate limiting is per-IP and lives in the edge function, because only the
--     function can see the client address. Here we keep the structural limits
--     that protect the table itself.
-- ============================================================================

create table if not exists public.support_requests (
  id            uuid        primary key default gen_random_uuid(),

  -- Short, quotable, random. Shown to the sender as their reference.
  reference     text        not null unique,

  -- Closed set. Kept deliberately small so "is this urgent?" is answerable by
  -- reading one column rather than by interpreting prose.
  category      text        not null,

  -- True only for the child-protection category. The edge function sets this
  -- from the category rather than trusting the client, so a crafted request
  -- cannot demote a child-safety report out of the urgent queue.
  is_child_safety boolean   not null default false,

  -- The contact the person gave us. This is the only way we reply, so it is
  -- required for anything that needs a response; a complaint with no way back
  -- is not a complaint we can act on.
  email         text        not null,

  -- Optional: the email or handle of the Vaylo account the request is about.
  -- A deletion request carries one; a copyright complaint usually does not.
  account_ref   text,

  -- Optional display name. Never required, because requiring a name for a
  -- safety report is a good way to lose reports.
  display_name  text,

  subject       text,
  body          text        not null,

  -- Kept for abuse investigation only, and cleared on schedule by the operator.
  -- Not used for analytics: this project has no analytics, deliberately.
  ip_hash       text,
  user_agent    text,

  status        text        not null default 'new',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One-click: an address that replies to a ticket can end it. Only an address
  -- a person actually wrote can do this, so a script cannot enroll a third
  -- party's inbox. The support-request-email function sets both; neither is
  -- reachable by the client.
  email_message_sent boolean not null default false,
  email_sent_at      timestamptz,

  constraint support_requests_category_check
    check (category in (
      'general',        -- general support, "how do I..."
      'account',        -- sign-in, locked out, wrong account
      'privacy',        -- access, correction, restriction, objection
      'deletion',       -- delete my account / my data
      'safety',         -- unsafe content, unsafe coaching, a feature caused harm
      'child_safety',   -- a child is at risk, or a child account exists
      'purchase',       -- charged, not credited, cancel, refund
      'bug',            -- something is broken
      'copyright'       -- IP / copyright / trademark complaint
    )),

  constraint support_requests_status_check
    check (status in ('new', 'in_progress', 'resolved', 'closed')),

  -- Structural limits. Generous for a genuine message, impossible for a
  -- script. Anything longer belongs in an email, which the page offers.
  constraint support_requests_body_len_check
    check (char_length(body) between 10 and 8000),
  constraint support_requests_email_len_check
    check (char_length(email) between 3 and 320),
  constraint support_requests_subject_len_check
    check (subject is null or char_length(subject) <= 200),
  constraint support_requests_account_ref_len_check
    check (account_ref is null or char_length(account_ref) <= 320),
  constraint support_requests_display_name_len_check
    check (display_name is null or char_length(display_name) <= 120)
);

-- The one query an operator actually runs: the queue, oldest first, with the
-- child-safety rows first among the new ones.
create index if not exists support_requests_queue_idx
  on public.support_requests (status, is_child_safety desc, created_at);

-- The one query rate limiting runs: "how many has this IP sent in an hour".
create index if not exists support_requests_ip_recent_idx
  on public.support_requests (ip_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled, and then every policy is an explicit deny. The edge function uses
-- the service role, which bypasses RLS, so nothing here blocks the real writer
-- — what it blocks is a client with the publishable key trying to read the inbox
-- or forge rows.
-- ---------------------------------------------------------------------------

alter table public.support_requests enable row level security;

-- No select policy for anyone. A submissions table that anyone can read is a
-- breach of the people who wrote to us.
create policy "support_requests_select_denied"
  on public.support_requests
  for select
  to anon, authenticated
  using (false);

-- No client insert. The website goes through the edge function so that
-- validation and rate limiting cannot be bypassed by calling PostgREST directly.
create policy "support_requests_insert_denied"
  on public.support_requests
  for insert
  to anon, authenticated
  with check (false);

create policy "support_requests_update_denied"
  on public.support_requests
  for update
  to anon, authenticated
  using (false);

create policy "support_requests_delete_denied"
  on public.support_requests
  for delete
  to anon, authenticated
  using (false);

-- Belt and braces: no privileges for anon or authenticated on this table at all.
revoke all on public.support_requests from anon, authenticated;
grant all on public.support_requests to service_role;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists support_requests_touch on public.support_requests;
create trigger support_requests_touch
  before update on public.support_requests
  for each row execute function public.touch_updated_at();

comment on table public.support_requests is
  'Website enquiries: support, privacy and data rights, safety and child-safety reports, purchase problems, deletion requests and copyright complaints. Written only by the support-request edge function via the service role; no client role can read or write it.';

comment on column public.support_requests.is_child_safety is
  'Derived server-side from category = ''child_safety''. Not settable by the client, so a crafted request cannot demote a child-protection report out of the urgent queue.';

comment on column public.support_requests.ip_hash is
  'Salted hash of the client address, used only to rate-limit and investigate abuse. Not an identifier, not reused for anything else, and clearable.';

comment on column public.support_requests.email_message_sent is
  'True when the support-request-email function has sent mail to the sender. Not reachable by the client.';

comment on column public.support_requests.email_sent_at is
  'Timestamp of the first delivery attempt to the sender. Not reachable by the client.';