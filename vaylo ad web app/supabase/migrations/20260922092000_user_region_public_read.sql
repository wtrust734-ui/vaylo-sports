-- ============================================================================
-- VAYLO SPORTS — user_region: full public read (supersedes the column-level grant)
-- ----------------------------------------------------------------------------
-- The previous migration made only `(user_id, country)` selectable, intending to
-- keep `currency` private. Live testing showed that narrowing breaks ordinary
-- writes: PostgREST implements `upsert()` as INSERT ... ON CONFLICT DO UPDATE,
-- and Postgres requires SELECT privilege on every column read by the DO UPDATE
-- SET list. So saving your own country failed with
-- "permission denied for table user_region" — the athlete could not set the very
-- field the leaderboards read.
--
-- Rather than working around that with a two-step update/insert (which would
-- leave the same trap for the next `upsert`, and for any `select("*")`), the
-- narrowing is reverted. The privacy argument for it was weak:
--
--   * `country` has to be public anyway — it is what the country and continental
--     leaderboards rank on.
--   * `currency` is the price tier derived from that country, via the public
--     `country_pricing_map`. Anyone who knows the country already knows it, and
--     prices themselves are public.
--   * `detected_at` / `updated_at` are timestamps with no personal content.
--
-- The privacy boundary that matters is elsewhere and unchanged: `profiles`
-- (date of birth, body weight, credits, coins) and all training and health
-- tables remain self-read-only.
-- ============================================================================

-- Restores SELECT on every column of the row; the column-level grants from the
-- previous migration become redundant rather than being dropped individually.
GRANT SELECT ON public.user_region TO authenticated;

COMMENT ON TABLE public.user_region IS
  'Per-athlete country and price tier. Publicly readable so country and continental leaderboards can resolve every ranked athlete; currency is derived from country via country_pricing_map. Never store personal data here.';
