-- ===========================================================================
-- AI DATA RETENTION MAINTENANCE
-- ---------------------------------------------------------------------------
-- One service-role maintenance RPC purges what retention policies promise:
--   1. video_form_analyses rows the athlete unsaved (deleted_at is null, saved
--      = false) are hard-deleted after 30 days — they are kept briefly so the
--      free-tier 7-day window stays honest, then they are gone.
--   2. ai_call_events older than 30 days are usage history, not state — the
--      durable rate limit only ever looks at the current window.
-- Documented retention, executed in SQL, callable from a scheduled job.
-- ===========================================================================

create or replace function public.delete_expired_ai_data()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_purged integer := 0;
  v_calls  integer := 0;
begin
  -- 1. Unsaved video analyses past 30 days: retention ends, hard delete.
  with gone as (
    delete from public.video_form_analyses
     where saved = false
       and deleted_at is null
       and created_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into v_purged from gone;

  -- 2. Durable AI rate-limit counters older than 30 days: history, not state.
  with gone as (
    delete from public.ai_call_events
     where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into v_calls from gone;

  return v_purged + v_calls;
end $$;

revoke all on function public.delete_expired_ai_data() from public, anon, authenticated;
grant execute on function public.delete_expired_ai_data() to service_role;

comment on function public.delete_expired_ai_data() is
  'Retention sweep: hard-deletes unsaved video analyses older than 30 days and ai_call_events older than 30 days. Service-role only; call from a scheduled job (pg_cron or external).';
