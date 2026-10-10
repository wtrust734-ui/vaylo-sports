-- ============================================================================
-- app_error_reports — where a failure on a tester's phone stops being invisible
-- ----------------------------------------------------------------------------
-- Why this exists.
--
-- The app runs inside a WebView. When something throws there, the athlete gets
-- an ErrorBoundary card or a toast, and the only record of what happened is a
-- line in logcat on a phone nobody is holding. During a closed test that is the
-- worst possible place for it: a tester says "it broke when I logged a set",
-- and there is nothing to look at.
--
-- So the app reports its own JavaScript failures — an uncaught error, an
-- unhandled rejection, a React render error — to the report-error edge
-- function, which writes here.
--
-- Why a table in this project rather than Sentry or Crashlytics.
--
-- The published documents promise that no analytics or error-reporting SDK is
-- installed (legal/advertising.html §3, legal/cookies.html §4). A third-party
-- error service would make those pages false, would add a processor holding
-- athlete data, and would need the ad/tracking disclosures this app has
-- deliberately avoided. Postgres and edge functions are already declared
-- processors in this project, so the reports go here and the promise stays
-- true. Supabase remains P1; there is no new P8.
--
-- What must never be stored here: tokens, session material, message bodies,
-- health records, photographs. The client redacts before it sends, the function
-- caps and re-validates, and the constraints below refuse anything oversized.
--
-- There is deliberately NO athlete column on this table, and that is a design
-- decision rather than an omission. A row here is a shared aggregate: one
-- counter for a failure across the whole tester population, not a row belonging
-- to one person. Putting a user id on it would be the worst of both worlds — it
-- would make the row personal data of whoever happened to report the failure
-- first, while giving account deletion and an Article 20 export no honest
-- answer, because deleting it would destroy other testers' counts. So the
-- report carries what identifies a FAILURE (build, screen, platform, browser
-- string) and nothing that identifies a person, which is also why
-- src/lib/accountDeletionCoverage.test.ts needs no entry for it: a table with
-- no user-keyed column cannot leak an athlete's row.
--
-- Design notes that matter:
--
--   * One row per fingerprint per app version, not one row per failure. A
--     closed test can produce thousands of repeats of one bug on day one
--     ("Cannot read properties of undefined" is usually one bug), and a table
--     of a thousand identical rows is a table nobody reads. `occurrences`
--     carries the volume instead.
--
--   * The fingerprint is derived SERVER-SIDE from the error's own text. A
--     client does not get to choose what its failure groups with, so a crafted
--     request cannot bury real errors under a shared fingerprint or scatter one
--     error across thousands of rows.
--
--   * `app_version` is part of the key, so a fixed version stops accumulating
--     rows and the difference between two builds is one query.
--
--   * Reads and writes are both closed to anon. The writer is the edge function
--     via the service role; the readers are admins, who get a select policy so
--     the operator can triage from /admin/errors on their phone instead of
--     opening a SQL console — and, unlike the website's support inbox, nothing
--     here contains a third party's words, so an admin read path is safe.
-- ============================================================================

create table if not exists public.app_error_reports (
  id             uuid        primary key default gen_random_uuid(),

  -- Hash of (name | normalized message | screen). Derived server-side.
  fingerprint    text        not null,

  -- The build it came from. "1.2.17" or "web" — whatever the shell reports.
  app_version    text        not null,

  name           text        not null,
  message        text        not null,

  -- First frames only. Capped: a React component stack can be tens of
  -- kilobytes, and the first lines are where the answer is.
  stack          text,

  -- Route where it happened, with ids normalized out (/coach/<id>). Not the
  -- query string — a URL can carry a token.
  screen         text,

  -- Which shell. "native" is the Android app; "web" is the browser build.
  platform       text        not null default 'web',

  -- The WebView or browser string. Kept because a whole class of failures is
  -- one OS or one WebView version refusing something the others accept, and it
  -- is already disclosed as technical data. It is not an account identifier.
  user_agent     text,

  occurrences    integer     not null default 1,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),

  -- Triage state, so "is anybody looking at this" has an answer. 'fixed' is
  -- set by hand when a release ships the repair, not inferred.
  status         text        not null default 'new',

  constraint app_error_reports_status_check
    check (status in ('new', 'investigating', 'fixed', 'ignored')),
  constraint app_error_reports_platform_check
    check (platform in ('native', 'web')),

  -- Structural limits, matching the caps in report-error. Generous for a real
  -- error, impossible for a script that found the endpoint.
  constraint app_error_reports_fingerprint_len_check
    check (char_length(fingerprint) between 8 and 64),
  constraint app_error_reports_version_len_check
    check (char_length(app_version) between 1 and 40),
  constraint app_error_reports_name_len_check
    check (char_length(name) between 1 and 120),
  constraint app_error_reports_message_len_check
    check (char_length(message) between 1 and 1000),
  constraint app_error_reports_stack_len_check
    check (stack is null or char_length(stack) <= 4000),
  constraint app_error_reports_screen_len_check
    check (screen is null or char_length(screen) <= 200),
  constraint app_error_reports_user_agent_len_check
    check (user_agent is null or char_length(user_agent) <= 300),
  constraint app_error_reports_occurrences_check
    check (occurrences >= 1),

  -- The upsert target. Also the reason a replay flood cannot grow the table:
  -- the same failure, sent a million times, is one row and one counter.
  constraint app_error_reports_key
    unique (fingerprint, app_version)
);

-- The one query the operator runs, and the one the screen runs: what is new or
-- still open, most recently seen first.
create index if not exists app_error_reports_triage_idx
  on public.app_error_reports (status, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled, and every policy for anon is an explicit deny. The edge function
-- uses the service role, which bypasses RLS entirely, so none of this blocks
-- the real writer — what it blocks is a client holding the publishable key
-- trying to forge reports or read other athletes' failures.
-- ---------------------------------------------------------------------------

alter table public.app_error_reports enable row level security;

create policy "app_error_reports_select_denied"
  on public.app_error_reports
  for select
  to anon
  using (false);

-- No client insert, ever. The app goes through the edge function so that the
-- fingerprint, the caps and the rate limit cannot be bypassed by calling
-- PostgREST directly with the publishable key.
create policy "app_error_reports_insert_denied"
  on public.app_error_reports
  for insert
  to anon, authenticated
  with check (false);

-- Status is the only column an operator changes, and it is changed from the
-- admin screen. Deletes stay denied for everyone: a failure that has been fixed
-- is evidence that the fix was needed.
create policy "app_error_reports_delete_denied"
  on public.app_error_reports
  for delete
  to anon, authenticated
  using (false);

-- Reachability for signed-in users (Postgres requires BOTH a grant and a
-- policy; without this grant the admin policy below would be unreachable).
grant select, update on public.app_error_reports to authenticated;
grant all on public.app_error_reports to service_role;

-- Access for signed-in users is decided here: admins only. Every non-admin
-- still matches only the deny policies above and sees nothing.
drop policy if exists "app_error_reports_admin_read" on public.app_error_reports;
create policy "app_error_reports_admin_read"
  on public.app_error_reports
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "app_error_reports_admin_update" on public.app_error_reports;
create policy "app_error_reports_admin_update"
  on public.app_error_reports
  for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- record_app_error_report — the whole write, in one atomic statement
-- ----------------------------------------------------------------------------
-- The function inserts the first report of a fingerprint, or bumps the counter
-- of an existing one, and answers whether this was the first time. The answer is
-- what decides whether the operator gets an email, so it has to be true exactly
-- once per fingerprint per version even when two testers hit the same bug in the
-- same second — which read-then-write in the edge function could not promise.
-- `occurrences = 1` is the signal, and the row lock inside the upsert is what
-- makes exactly one caller see it.
--
-- SECURITY INVOKER on purpose: it runs as the caller, and the caller is the
-- service role from the edge function. It does NOT get its own privileged path
-- around RLS, so if it were ever called by anon instead, the insert would hit
-- the deny policies above and fail rather than write.
--
-- EXECUTE is revoked from every client role. A function that writes without a
-- user, published on PostgREST's RPC surface, is a table with a public insert.
-- ---------------------------------------------------------------------------

create or replace function public.record_app_error_report(
  p_fingerprint text,
  p_app_version text,
  p_name        text,
  p_message     text,
  p_stack       text,
  p_screen      text,
  p_platform    text,
  p_user_agent  text,
  p_seen_at     timestamptz
)
returns table (was_new boolean, times_seen integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seen integer;
begin
  insert into public.app_error_reports as r (
    fingerprint, app_version, name, message, stack, screen,
    platform, user_agent, occurrences, first_seen_at, last_seen_at
  ) values (
    p_fingerprint, p_app_version, p_name, p_message, p_stack, p_screen,
    p_platform, p_user_agent, 1, p_seen_at, p_seen_at
  )
  on conflict on constraint app_error_reports_key do update
    set occurrences  = r.occurrences + 1,
        last_seen_at = greatest(r.last_seen_at, excluded.last_seen_at),
        -- A later report can arrive without a stack (the boundary has a
        -- component stack, a window error may not) or from a device that sends
        -- no user agent. Keep the first non-null of each rather than erasing
        -- what we already know with an empty value.
        stack        = coalesce(r.stack, excluded.stack),
        user_agent   = coalesce(r.user_agent, excluded.user_agent)
  returning r.occurrences into v_seen;

  was_new := (v_seen = 1);
  times_seen := v_seen;
  return next;
end;
$$;

-- Functions are executable by PUBLIC by default, which on PostgREST means
-- `/rest/v1/rpc/record_app_error_report` would be an open writer for anyone with
-- the publishable key. Close it, then open it for the service role only.
revoke all on function public.record_app_error_report(
  text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.record_app_error_report(
  text, text, text, text, text, text, text, text, timestamptz
) to service_role;

comment on table public.app_error_reports is
  'First-party JavaScript failure reports from the app. One row per fingerprint per app version, written only by the report-error edge function via the service role, readable and status-settable by admins. Deliberately not a third-party crash service: the published legal documents promise no analytics or error-reporting SDK.';

comment on column public.app_error_reports.fingerprint is
  'Server-derived hash of (name | normalized message | screen). Derived in report-error, never taken from the client, so a crafted request cannot choose what its failure groups with.';

comment on column public.app_error_reports.screen is
  'Route where the failure happened, with ids normalized out. Never the query string: a URL can carry a token.';

comment on function public.record_app_error_report is
  'Atomic upsert for one failure report, returning whether it was the first of its fingerprint and version. Called by the report-error edge function with the service role; EXECUTE is revoked from anon and authenticated.';
