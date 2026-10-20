-- ============================================================================
-- SECURITY / INTEGRITY HARDENING — 30 Sep 2026
-- ----------------------------------------------------------------------------
-- Scope: closes the remaining findings from the security-gate audit. All are
-- structural (indexes/constraints); no data is modified or deleted. Every
-- change was pre-validated against live data (0 violations) and is idempotent.
--
-- Rollback: each statement is invertible (CREATE INDEX ↔ DROP INDEX,
-- ADD CONSTRAINT ↔ DROP CONSTRAINT); see the per-section notes.
-- ============================================================================

-- 1) Advisor 0001: user_blocks_blocked_id_fkey had no covering index.
--    Also serves reverse lookups used by the blocking triggers and
--    "can this user interact with me" checks.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id);

-- 2) Advisor 0009: duplicate unique on (user_id, log_date).
--    training_loads_user_id_log_date_key and training_loads_user_date_uniq are
--    identical constraints. Drop one CONSTRAINT (not the index — the protection
--    is constraint-backed). training_loads_user_date_uniq is retained and
--    idx_loads_user_date keeps serving reads. If anything ever violates the
--    pair-uniqueness it will still fail — against the retained twin.
ALTER TABLE public.training_loads
  DROP CONSTRAINT IF EXISTS training_loads_user_id_log_date_key;

-- 3) Advisor 0009: idx_video_form_analyses_user_created and
--    video_form_analyses_user_recent_idx are identical (user_id, created_at DESC).
--    Keep the descriptively-named one.
DROP INDEX IF EXISTS public.video_form_analyses_user_recent_idx;

-- 4) Rate-limit path: ai_call_allowed() counts per (user, feature, window) and
--    the in-transaction housekeeping DELETEs rows older than 7 days. The
--    existing (user_id, created_at) index makes the limiter scan every recent
--    row for the user and filter by feature in the heap; the housekeeping
--    DELETE had no index at all on created_at.
CREATE INDEX IF NOT EXISTS ai_call_events_user_feature_time_idx
  ON public.ai_call_events (user_id, feature, created_at);
CREATE INDEX IF NOT EXISTS ai_call_events_created_at_idx
  ON public.ai_call_events (created_at);

-- 5) Engine-enforced friendship pair integrity. guard_friendship_pair() (BEFORE
--    INSERT/UPDATE trigger) already blocks duplicate mutual records on the RPC
--    path; a trigger can be dropped or disabled, so the normalized pair gets a
--    UNIQUE index as well. Expression is immutable, so this is a legal unique
--    index. Pre-validated: 0 rows would violate it.
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_normalized_uniq
  ON public.friendships (LEAST (user_id, friend_id), GREATEST (user_id, friend_id));

-- 6) Cross-account purchase-token replay closure. The old unique index scoped
--    idempotency to (user_id, provider_reference), so the same store token
--    could be applied once per account. Store tokens identify ONE purchase;
--    process-purchase's pre-check still resolves (it queries user_id +
--    provider_reference, which this index serves), and replays now fail at the
--    engine for any account, matching the function's 409 design intent.
--    Pre-validated: 0 references are shared across users today.
DROP INDEX IF EXISTS public.user_purchases_provider_reference_idx;
CREATE UNIQUE INDEX IF NOT EXISTS user_purchases_provider_reference_global_uniq
  ON public.user_purchases (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- 7) Purchase price range guard. The table is currently empty (verified), the
--    only writer is the service-role purchase flow, and every money path in
--    the economy resolves prices from the server catalog — this CHECK makes
--    the invariant structural. NULL is allowed (credit-priced rows).
ALTER TABLE public.user_purchases
  DROP CONSTRAINT IF EXISTS user_purchases_price_non_negative;
ALTER TABLE public.user_purchases
  ADD CONSTRAINT user_purchases_price_non_negative
  CHECK (price_cents IS NULL OR price_cents >= 0);
