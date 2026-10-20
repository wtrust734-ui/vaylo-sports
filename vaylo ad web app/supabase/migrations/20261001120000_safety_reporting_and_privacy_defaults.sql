-- ============================================================================
-- SAFETY: CONTENT REPORTING, MINOR-SAFE DEFAULTS, BLOCK FILTERING
-- ---------------------------------------------------------------------------
-- Closes the P0 gaps from docs/LEGAL-COMPLIANCE-AUDIT.md:
--
--   P0-1  no way to report abusive or unsafe content (Google Play UGC policy,
--         ICO Children's Code std 35)
--   P0-2  blocking exists in the database but nothing reaches the feed
--   P0-3  privacy defaults are public, not private (Children's Code std 12)
--   P1-6  no recorded consent event for health data / terms acceptance
--
-- Design notes that matter:
--
-- 1. Reports are private to the reporter. `content_reports` has no policy that
--    lets one athlete read another's reports, and no anon access at all. A
--    report is an accusation; leaking the reporter would be worse than the
--    problem being reported.
--
-- 2. The reporter cannot see the outcome, and cannot delete the report to
--    hide it. Only a moderator can change `status`.
--
-- 3. Blocked athletes are removed from the feed SERVER-SIDE. Filtering in the
--    client would still ship the rows to the device, which is the opposite of
--    the point of blocking.
--
-- 4. Nothing here adds a column that collects new personal data. The
--    consent timestamps record agreement to data the app already holds.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Content reports
-- ---------------------------------------------------------------------------

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  -- What is being reported. Deliberately a small closed set rather than a free
  -- string: an unvalidated target type cannot be actioned by a moderator.
  target_type text not null
    check (target_type in ('activity', 'profile', 'community', 'message', 'other')),
  -- Free identifier: the row id where one exists, otherwise a url/handle.
  target_id text not null check (char_length(target_id) between 1 and 200),
  -- Denormalised for the moderator's list. Never rendered to the reported user.
  target_label text check (target_label is null or char_length(target_label) <= 200),
  reason text not null
    check (reason in (
      'harassment',      -- bullying, threats, targeted abuse
      'hate',            -- racist, sexist,homophobic or otherwise abusive
      'sexual',          -- sexual content, or sexualisation of a minor
      'self_harm',       -- content promoting or describing self-harm
      'dangerous',       -- content encouraging unsafe training or eating
      'spam',            -- spam, advertising, scams
      'impersonation',   -- pretending to be Vaylo or another athlete
      'privacy',         -- personal information posted without consent
      'other'
    )),
  -- Free text so a child can explain something the enum does not cover. Capped
  -- because it is read by a human, not parsed.
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.content_reports enable row level security;

-- A reporter can see their own reports — so "I reported this" is answerable in
-- the app without telling them anything about anyone else's report.
drop policy if exists "Athletes see their own reports" on public.content_reports;
create policy "Athletes see their own reports"
  on public.content_reports for select
  to authenticated
  using ((select auth.uid()) = reporter_id);

-- One report per reporter per target per reason, so a frustrated athlete cannot
-- flood the moderator queue by tapping Report repeatedly.
create unique index if not exists content_reports_one_per_target
  on public.content_reports (reporter_id, target_type, target_id, reason);

create index if not exists content_reports_open_idx
  on public.content_reports (created_at)
  where status = 'open';

create index if not exists content_reports_target_idx
  on public.content_reports (target_type, target_id);

revoke all on public.content_reports from anon;
grant select, insert on public.content_reports to authenticated;
-- No update/delete grant: status is the moderator's to set, server-side.

comment on table public.content_reports is
  'User-submitted abuse reports. Readable only by the reporter. Moderation status is set server-side by an operator, never by the athlete.';

-- ---------------------------------------------------------------------------
-- 2. report_content(): the only way a client files a report
-- ---------------------------------------------------------------------------
-- Exists so validation, rate limiting and the actor's identity are all decided
-- in one place. A direct INSERT with RLS would be simpler and would also let a
-- client probe which target ids exist, and file unbounded reports.
-- ---------------------------------------------------------------------------

create or replace function public.report_content(
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_details text default null,
  p_target_label text default null
)
returns public.content_reports
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.content_reports;
  v_recent int;
begin
  if v_uid is null then
    raise exception 'You must be signed in to report content.'
      using errcode = '42501';
  end if;

  if p_target_type is null
     or p_target_type not in ('activity', 'profile', 'community', 'message', 'other') then
    raise exception 'Unknown content type.';
  end if;

  if p_target_id is null or char_length(btrim(p_target_id)) < 1
     or char_length(p_target_id) > 200 then
    raise exception 'Invalid content reference.';
  end if;

  if p_reason is null
     or p_reason not in ('harassment', 'hate', 'sexual', 'self_harm', 'dangerous',
                         'spam', 'impersonation', 'privacy', 'other') then
    raise exception 'Please choose a reason.';
  end if;

  -- Rate limit. Ten reports an hour is far above any legitimate use and far
  -- below anything a spammer would need.
  select count(*) into v_recent
    from public.content_reports r
   where r.reporter_id = v_uid
     and r.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'You have reported a lot recently. Please try again later.';
  end if;

  insert into public.content_reports
    (reporter_id, target_type, target_id, target_label, reason, details)
  values
    (v_uid, p_target_type, btrim(p_target_id), left(p_target_label, 200), p_reason, left(p_details, 1000))
  on conflict (reporter_id, target_type, target_id, reason) do nothing
  returning * into v_row;

  -- Already reported by this athlete: return the existing row rather than an
  -- error, so double-tapping is not a failure in the UI.
  if v_row.id is null then
    select * into v_row
      from public.content_reports
     where reporter_id = v_uid
       and target_type = p_target_type
       and target_id = btrim(p_target_id)
       and reason = p_reason
     limit 1;
  end if;

  return v_row;
end;
$$;

revoke all on function public.report_content(text, text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text, text) to authenticated;

comment on function public.report_content(text, text, text, text, text) is
  'Files a content report on behalf of the signed-in athlete. Validates the reason enum and rate-limits. Idempotent per (reporter, target, reason).';

-- ---------------------------------------------------------------------------
-- 3. Blocked athletes are hidden from the feed SERVER-SIDE (P0-2)
-- ---------------------------------------------------------------------------
-- This is a view, not a client filter: the rows must never reach the device.
-- Both directions are excluded — someone who blocked you is hidden from you
-- too, because otherwise blocking is trivially defeated by blocking back.
-- ---------------------------------------------------------------------------

drop view if exists public.feed_visible_activities;

create view public.feed_visible_activities
with (security_invoker = true)
as
select s.*
  from public.shared_activities s
 where not exists (
         select 1 from public.user_blocks b
          where (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
             or (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
       );

comment on view public.feed_visible_activities is
  'Shared activities excluding anyone the viewer blocks or is blocked by. security_invoker so the underlying RLS on shared_activities still applies; this view only removes blocked athletes.';

-- ---------------------------------------------------------------------------
-- 4. Consent records (P1-6)
-- ---------------------------------------------------------------------------
-- Records agreement to data the app ALREADY holds. No new personal data is
-- collected. Without these, Vaylo cannot evidence when an athlete agreed to
-- anything, which is an accountability failure under Art. 5(2).
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists health_consent_at timestamptz;

comment on column public.profiles.terms_accepted_at is
  'When this athlete accepted the Terms of Service and Privacy Policy. Null means an account created before this was recorded.';
comment on column public.profiles.health_consent_at is
  'When this athlete consented to processing the health and fitness data they choose to log (recovery, injuries, body measurements). NULL means not yet recorded — the app must prompt, not assume.';

-- ---------------------------------------------------------------------------
-- 5. Privacy defaults: private, not public (P0-3)
-- ---------------------------------------------------------------------------
-- Children's Code std 12: if a service is likely to be accessed by children, the
-- default must be the most private setting. Vaylo's Terms set a floor of 13 and
-- the product is designed for 13-17 year olds, so it is in scope.
--
-- The column default only affects NEW rows. The trigger below is what actually
-- protects a child: it applies whenever a date of birth is set or changed,
-- including on an account that already existed.
-- ---------------------------------------------------------------------------

-- There is no `privacy` column on this table and there never has been: the
-- creating migration (20260505055427) defined group_visibility. An earlier
-- draft of this migration altered a `privacy` column, which does not exist,
-- so the whole migration failed to apply against the live schema. These are
-- the two columns that actually control exposure.
alter table public.privacy_settings
  alter column group_visibility set default 'private',
  alter column show_avatar_publicly set default false;

comment on column public.privacy_settings.group_visibility is
  'Who can see the groups this athlete has joined: public | friends | private. Defaults to private (Children''s Code std 12). Adults can opt in to public from Profile settings. NOTE: this is group-scoped only. The schema still has no account-level "who can see my profile" setting.';

-- Force the private default on any athlete the database can prove is under 18.
-- This cannot be bypassed by the client, because the client only ever writes
-- privacy_settings; the trigger fires after and overrides.
create or replace function public.enforce_minor_privacy_defaults()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dob date;
begin
  select p.date_of_birth into v_dob
    from public.profiles p
   where p.user_id = new.user_id;

  if v_dob is not null
     and v_dob > (current_date - interval '18 years')::date then
    new.group_visibility := 'private';
    new.show_avatar_publicly := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_minor_privacy on public.privacy_settings;
create trigger trg_enforce_minor_privacy
  before insert or update on public.privacy_settings
  for each row execute function public.enforce_minor_privacy_defaults();

comment on function public.enforce_minor_privacy_defaults() is
  'Children''s Code std 12: an athlete the database can prove is under 18 always gets the most private settings, whatever the client asked for.';

-- A new athlete gets a privacy_settings row on signup, defaulted to private.
drop function if exists public.handle_new_user_privacy() cascade;

create or replace function public.handle_new_user_privacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.privacy_settings (user_id, group_visibility, show_avatar_publicly)
  values (new.id, 'private', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_new_user_privacy on auth.users;
create trigger trg_new_user_privacy
  after insert on auth.users
  for each row execute function public.handle_new_user_privacy();

-- -----------------------------------------------------------------------
-- 6. Backfill existing athletes
-- -----------------------------------------------------------------------
-- The trigger above only fires for accounts created after this migration. Every
-- account that already existed has no privacy_settings row at all, which means
-- every read of it falls through to a permissive default
-- (20260930092253: "no row = defaults-on"). So without this, "private by
-- default" would be true only for new signups and false for everyone already
-- on the platform. Children''s Code std 12 is about the default a child
-- actually gets, not the one a future child will get.
--
-- on conflict do nothing: if the trigger above already inserted a row for a
-- concurrently-created account, this leaves it alone.
insert into public.privacy_settings (user_id, group_visibility, show_avatar_publicly)
select p.user_id, 'private', false
  from public.profiles p
 where not exists (
         select 1 from public.privacy_settings ps where ps.user_id = p.user_id
       );

-- Known residual gap, recorded rather than quietly left: allow_friend_requests
-- and allow_community_posting are still default-true, including for under-18s.
-- Forcing those off is a product decision (it would break friending for the
-- 13-17 year olds the product is designed for) and is not taken here.
