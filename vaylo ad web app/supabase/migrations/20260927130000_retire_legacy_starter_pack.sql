-- ============================================================================
-- Retire the legacy 'starter_pack' offer row for real.
-- ----------------------------------------------------------------------------
-- `20260927120000_welcome_starter_offer.sql` already meant to do this, but its
-- guard was `ends_at < now()`. The legacy rows were re-seeded on 2026-09-20
-- 16:42:15 with `ends_at = created_at + interval`, which stamps values like
-- created_at + 7 days — so when the migration ran, starter_pack's ends_at was
-- still ~11 minutes in the FUTURE and the UPDATE matched zero rows. It reported
-- success and the Market kept rendering a second, competing "Welcome Bundle"
-- (pack_120 + 80 bonus = 200 credits for $7.99) alongside the intended one
-- (pack_50 + 25 bonus = 85 credits for $3.99).
--
-- The lesson: never gate a retirement on a self-renewing timestamp. Retire by
-- slug, and let the intent — not the clock — decide. Idempotent, safe to re-run.
-- ============================================================================

UPDATE public.special_offers
SET active = false
WHERE slug = 'starter_pack';
