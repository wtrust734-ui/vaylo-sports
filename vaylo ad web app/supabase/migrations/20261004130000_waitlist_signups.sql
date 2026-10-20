-- ============================================================================
-- waitlist_signups — the waiting list behind the public Vaylo Sports website
-- ----------------------------------------------------------------------------
-- Why this exists.
--
-- Vaylo Sports is not on the Play Store yet (site/data/site.mjs: playStoreUrl
-- is null, and the homepage says so rather than linking a dead button). There
-- was nowhere for someone who wants it to say so, which means the interest went
-- nowhere rather than being captured.
--
-- So /waitlist/ posts here through the waitlist-signup edge function, which
-- validates, rate-limits and writes. The operator reads the list in the
-- Supabase dashboard. There is no mail provider wired into this project, so
-- this table is deliberately the whole mechanism: a claim on a place, not a
-- promise about email that nothing currently fulfils.
--
-- Design notes that matter:
--
--   * No public read access, at all. Same reasoning as support_requests: a
--     signups table that anyone can select is a list of other people's email
--     addresses. RLS below denies everything to anon and authenticated; the
--     edge function writes with the service role, which bypasses it by design.
--     There is no client insert either, so validation and rate limiting cannot
--     be bypassed by calling PostgREST directly with the publishable key.
--
--   * UNIQUE on the email, lower-cased. The same person clicking twice must
--     not become two rows, and a duplicate click is the normal case on a slow
--     connection. The casing is what makes that true: "A@b.com" and "a@b.com"
--     are the same inbox, and without the lower-case index they would be two
--     rows and two "you are already on the list" emails.
--
--   * No "your position in the queue" column and no sequence. There is nothing
--     to wait for in a queue: this is an interest list, not a served one, and
--     publishing a rank would imply an order of service that does not exist.
--
--   * ip_hash is salted per deployment and used for rate limiting and abuse
--     investigation only — never as an identifier, never for analytics. This
--     project has no analytics, deliberately.
--
--   * unsubscribed_at is a real column rather than a DELETE, so a removal
--     request is recorded and auditable. There is no self-service removal by
--     email: an endpoint that deleted a row for an address anyone typed would
--     both be an enumeration oracle ("is this person on the list?") and let one
--     person remove another. Removal goes through the Contact form, where the
--     operator verifies and sets this column.
-- ============================================================================

create table if not exists public.waitlist_signups (
  id            uuid        primary key default gen_random_uuid(),

  -- The address the person gave us, stored lower-cased. The only thing on this
  -- table that identifies anybody.
  email         text        not null unique,

  -- Optional. Never required: demanding a name to join a list is a good way to
  -- lose signups, and it buys nothing.
  display_name  text,

  -- Where the signup came from, from a closed set. "web" is the form on
  -- /waitlist/; the rest exist so a campaign link can be told apart from
  -- somebody who typed the URL in.
  source        text        not null default 'web',

  -- Salted hash of the client address: rate limiting and abuse investigation
  -- only. Cleared on schedule by the operator.
  ip_hash       text,
  user_agent    text,

  -- Set when the operator removes someone. The row is kept so the removal is
  -- recorded; see the note above for why there is no self-service route.
  unsubscribed_at timestamptz,

  created_at    timestamptz not null default now()
);

-- The rate limit runs "how many has this IP joined in the last hour".
create index if not exists waitlist_signups_ip_recent_idx
  on public.waitlist_signups (ip_hash, created_at desc);

-- A closed source set, so "which campaign worked" is answerable by reading one
-- column instead of parsing a string.
alter table public.waitlist_signups
  drop constraint if exists waitlist_signups_source_check;
alter table public.waitlist_signups
  add constraint waitlist_signups_source_check
  check (source in ('web', 'home', 'play', 'share', 'qr'));

-- Structural limits. Generous for a real signup, impossible for a script.
alter table public.waitlist_signups
  drop constraint if exists waitlist_signups_email_len_check;
alter table public.waitlist_signups
  add constraint waitlist_signups_email_len_check
  check (char_length(email) between 3 and 320);

alter table public.waitlist_signups
  drop constraint if exists waitlist_signups_display_name_len_check;
alter table public.waitlist_signups
  add constraint waitlist_signups_display_name_len_check
  check (display_name is null or char_length(display_name) <= 120);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled, and then every policy is an explicit deny — the same shape as
-- support_requests, for the same reason. The service role bypasses RLS, so
-- nothing here blocks the one writer that should exist.
-- ---------------------------------------------------------------------------

alter table public.waitlist_signups enable row level security;

-- No select for anyone: a list of people's email addresses is not public data.
create policy "waitlist_signups_select_denied"
  on public.waitlist_signups
  for select
  to anon, authenticated
  using (false);

-- No client insert. The website goes through the edge function so validation
-- and rate limiting cannot be bypassed with the publishable key.
create policy "waitlist_signups_insert_denied"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (false);

-- No client update either. In particular nobody may clear unsubscribed_at.
create policy "waitlist_signups_update_denied"
  on public.waitlist_signups
  for update
  to anon, authenticated
  using (false)
  with check (false);

-- No client delete. Removal is an operator action recorded in
-- unsubscribed_at, not a row vanishing.
create policy "waitlist_signups_delete_denied"
  on public.waitlist_signups
  for delete
  to anon, authenticated
  using (false);

-- The edge function is the only writer.
grant all on public.waitlist_signups to service_role;
-- Nothing is granted to anon or authenticated on purpose. No grant means the
-- roles cannot reach the table at all, and the deny policies above are the
-- second lock rather than the only one.