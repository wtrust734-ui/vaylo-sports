-- New notification toggles for the 07:10 schedule release (2026-10-14):
--   low_balance     — warning at <= 15 credits, at most every 3 days
--   recovery_alerts — gentle note when today's readiness <= 35
--
-- Both default ON (missing row already means "everything on" client-side).
-- Idempotent: safe to re-run.

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS low_balance boolean NOT NULL DEFAULT true;

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS recovery_alerts boolean NOT NULL DEFAULT true;
