-- ============================================================================
-- MARKETPLACE MODERATION GATE — the prerequisite for flipping coachMarketplace
-- ----------------------------------------------------------------------------
-- The coach marketplace flag exists and is off precisely because publishing
-- supply changes what the platform is responsible for: once a coach profile
-- or a purchased plan can be seen by someone else, that content must be
-- reportable through the same safety stack as every other surface.
--
-- This migration widens the report pipeline to carry marketplace targets:
--
--   * content_reports.target_type gains 'marketplace_plan' and
--     'marketplace_profile'. Everything downstream (the escalation trigger,
--     the admin queue, rate limits, dedup) already keys off target_type, so
--     widening the vocabulary is the whole integration — no second pipeline,
--     no parallel queue.
--
-- Also here rather than in client code: the moderation decision lives in the
-- DATABASE so report UI cannot be skipped, and so the escalation alarm (see
-- 20261015210000) fires for marketplace reports exactly as it does for
-- community ones.
--
-- Constraint widening notes: ALTER ... DROP/ADD validates against existing
-- rows, and none exist with the new types, so this is safe on any backup that
-- contains reports.
-- ============================================================================

alter table public.content_reports
  drop constraint content_reports_target_type_check;

alter table public.content_reports
  add constraint content_reports_target_type_check
  check (target_type in ('activity', 'profile', 'community', 'message',
                         'marketplace_plan', 'marketplace_profile', 'other'));

-- The RPC re-validates the same vocabulary; keep it in lockstep with the
-- table constraint above. (report_content lives in 20261001120000; re-issuing
-- the function with the widened list is how a live ALTER reaches it.)
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
     or p_target_type not in ('activity', 'profile', 'community', 'message',
                              'marketplace_plan', 'marketplace_profile', 'other') then
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
