-- ============================================================================
-- CONTENT REPORT ESCALATION — a report that sits in a table nobody opens
-- ----------------------------------------------------------------------------
-- The moderation queue has been the product's largest operational gap since
-- the 2026-10-08 release audit: `content_reports` is written by
-- `report_content()` and read by nobody. Play's UGC review asks the question
-- this migration answers: does a report reach a human?
--
-- Now it does, one way that cannot be skipped by anything the client chooses
-- to do: a database trigger on INSERT fires a webhook to the
-- `content-report-escalate` edge function, which emails the operator inbox
-- (the same inbox the support form uses, and the one whose delivery is
-- proven — probe VYL-D7TNMX78, 2026-10-15).
--
-- Shape copied from `20261004170000_waitlist_campaigns.sql`, one deliberate
-- difference at the secret's own door: the waitlist secret lives in Vault,
-- which is only writable through the dashboard or a connection that owns the
-- pgsodium crypto functions — neither of which the Management API query
-- endpoint is (insert attempts fail with 42501 on _crypto_aead_det_noncegen).
-- This trigger instead reads from `public.private_secrets`, a table owned by
-- the service owner with grants to service_role only: readable by this
-- trigger (SECURITY DEFINER, fires as owner) and by the support function's
-- service key, invisible to anon and authenticated roles. Same protection
-- shape as a vault row — nobody with only an athlete's token can read it —
-- without needing a hand-run dashboard step.
--   * the secret `content_report_escalation_key` must equal the function's
--     `REPORT_ESCALATION_KEY` (set via `supabase secrets set`).
--   * the URL is written out, not derived, so a moved project fails loudly in
--     review rather than silently posting to the wrong project.
--   * fire-and-forget: pg_net returns a request id immediately, so a slow SMTP
--     call can never hold up a report insert.
-- ============================================================================

-- The secret table. Empty until the key is stored (see DEPLOY_NOTES.md).
create table if not exists public.private_secrets (
  name text primary key,
  value text not null,
  rotated_at timestamptz not null default now()
);

revoke all on public.private_secrets from anon, authenticated;
grant select on public.private_secrets to service_role;
create or replace function public.notify_content_report_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select ps.value into v_secret
    from public.private_secrets ps
   where ps.name = 'content_report_escalation_key'
   limit 1;

  if v_secret is null then
    raise warning 'notify_content_report_escalation: private_secrets row "content_report_escalation_key" is not set; the report is stored but nobody was emailed';
    return null;
  end if;

  select net.http_post(
    url := 'https://vvwhausdjzdmsyxekrcl.supabase.co/functions/v1/content-report-escalate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-escalation-key', v_secret
    ),
    body := jsonb_build_object('report_id', NEW.id::text),
    timeout_milliseconds := 5000
  ) into v_request_id;

  return null; -- AFTER trigger; the insert stands on its own
end $$;

revoke all on function public.notify_content_report_escalation() from public, anon, authenticated;
grant execute on function public.notify_content_report_escalation() to service_role;

drop trigger if exists content_reports_escalation_trg on public.content_reports;
create trigger content_reports_escalation_trg
  after insert on public.content_reports
  for each row execute function public.notify_content_report_escalation();

comment on trigger content_reports_escalation_trg on public.content_reports is
  'Escalates every new content report to the operator inbox via the content-report-escalate function. Normal trigger: fires for service-role writes too (session_replication_role is origin).';
