-- ==============================================================================
-- Video / AI data retention sweep — actually scheduled (MDF-004, 2026-10-20)
--
-- Migration 20260930072403 created public.delete_expired_ai_data(): the service-
-- role RPC that hard-deletes unsaved video form analyses older than 30 days and
-- ai_call_events older than 30 days ("Documented retention, executed in SQL,
-- callable from a scheduled job").
--
-- Nothing ever scheduled it. Unlike the waitlist sweep and the referral hold
-- sweep, this one was callable-by-hand only, so the documented 30-day retention
-- was not being executed unless someone remembered to call the RPC. The
-- retention windows are announced in the Privacy Policy with this migration's
-- date, so the promise and the execution have to exist together.
--
-- Named (like the other two sweeps) so a redeploy of this migration upserts the
-- existing job instead of stacking a second one; cron.schedule upserts by name.
-- 04:37 UTC daily: an arbitrary quiet hour, deliberately not on the hour so it
-- does not collide with the 09:00 waitlist run or the hourly referral sweep.
-- ==============================================================================

select cron.schedule(
  'video-ai-data-retention-daily',
  '37 4 * * *',
  $$select public.delete_expired_ai_data()$$
);
