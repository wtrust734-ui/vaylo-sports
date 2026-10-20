-- ============================================================================
-- Offer windows: stop serving expired offers, and enforce the window on read.
-- ----------------------------------------------------------------------------
-- Rows in `special_offers` were seeded with `ends_at = created_at + interval`,
-- and nothing ever clears `active` when that deadline passes. Two production
-- rows showed the consequence:
--
--   * `double_weekend` expired 2026-09-23 and was still `active = true`, so it
--     was still the row the double-credits lookup picked up. Harmless only
--     because its `bonus_multiplier` happened to be 1.0 — raising that
--     multiplier would have silently doubled every pack's bonus, on the client
--     AND in `process-purchase`, which reads offers with the service role.
--   * `starter_pack` stayed active and kept rendering a competing
--     "Welcome Bundle" (retired separately in 20260927130000).
--
-- Retire what has already expired, then make the window part of the read policy
-- so an out-of-window row can never reach a client again, whatever `active`
-- says. Idempotent — safe to re-run.
-- ============================================================================

-- 1. Retire rows whose own deadline has passed.
UPDATE public.special_offers
SET active = false
WHERE active = true
  AND ends_at IS NOT NULL
  AND ends_at <= now();

-- 2. Serve only live offers. The previous policy exposed every `active` row,
--    including expired ones and ones whose start is still in the future. The old
--    and new policy names are both dropped so this is safe either way.
DROP POLICY IF EXISTS "Public read active offers" ON public.special_offers;
DROP POLICY IF EXISTS "Public read live offers" ON public.special_offers;

CREATE POLICY "Public read live offers"
ON public.special_offers
FOR SELECT
USING (
  active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
);

-- NOTE: management paths read with the service role (RLS bypassed), so nothing
-- here restricts what ops can see or edit — only what an athlete's client can.
-- The service-role readers enforce the same window in code, because this policy
-- cannot protect them: see `supabase/functions/_shared/offerWindow.ts`.
