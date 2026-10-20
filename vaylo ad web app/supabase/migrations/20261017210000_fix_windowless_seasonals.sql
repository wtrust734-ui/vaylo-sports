-- ============================================================================
-- FIX: the two legacy windowless seasonal rows
-- ----------------------------------------------------------------------------
-- The seasonal seed created six items; only four got availability windows
-- (Christmas Hat, Halloween Mask, Summer Shades, Winter Scarf — see
-- 20260704114724). Olympic Medallion and World Cup Jersey have season labels
-- with NO bounds, and both the client and the server treat a windowless
-- seasonal as a content defect: never on sale, with no honest reason shown
-- (documented in src/lib/cosmeticCatalog.ts as "two legacy seed rows").
--
-- This gives each row an explicit window so it reads correctly instead of
-- reading as broken:
--
--   * Olympic Medallion — on sale for the LA 2028 Games window; correctly
--     off-sale until then.
--   * World Cup Jersey  — the 2026 tournament window has already passed, so
--     this records the historical window it always meant: the item now reads
--     "season ended" (off-sale by an honest clock) instead of "defect"
--     (off-sale forever with no dates). Retired, not broken — consistent
--     with the honesty rule that items return in later seasons rather than
--     expiring by threat.
--
-- WHERE … IS NULL keeps the migration re-runnable and never clobbers a real
-- date an operator may have set by hand.
-- ============================================================================

UPDATE public.reward_definitions
SET available_from = '2028-07-14',
    available_to   = '2028-08-12'
WHERE id = 'seasonal_olympics_med'
  AND type = 'seasonal'
  AND available_from IS NULL
  AND available_to IS NULL;

UPDATE public.reward_definitions
SET available_from = '2026-06-11',
    available_to   = '2026-07-19'
WHERE id = 'seasonal_wcup_jersey'
  AND type = 'seasonal'
  AND available_from IS NULL
  AND available_to IS NULL;
