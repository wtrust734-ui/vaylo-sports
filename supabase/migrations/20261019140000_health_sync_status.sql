-- ============================================================================
-- HEALTH SYNC STATE — persisted sync status
-- ----------------------------------------------------------------------------
-- The sync engine upserted `last_sync_at` only, and ONLY on success. That made
-- three states the UI cannot express:
--
--   * in-progress — a concurrent device sees nothing and starts a second job;
--   * failed      — nothing was written, so "No sync yet" is the only record of
--                   a failed attempt and no retry affordance survives a
--                   refresh;
--   * succeeded   — indistinguishable from "connected but never synced".
--
-- This adds a per-athlete status column on the same self-service RLS table the
-- engine already writes, plus the timestamp the run was claimed (which is what
-- makes an in-progress row stale-detectable after a crashed device) and the
-- engine's own error token. All three are bookkeeping: no health values ever
-- touch this row.
--
-- Applied with `supabase db query --linked --file` rather than `db push` — the
-- remote migration history has drifted from this tree (docs/FRIENDS.md).
-- ============================================================================

alter table public.health_sync_state
  add column if not exists sync_status text not null default 'idle'
    check (sync_status in ('idle', 'in_progress', 'succeeded', 'failed')),
  add column if not exists sync_started_at timestamptz,
  add column if not exists sync_error text
    check (sync_error is null or char_length(sync_error) <= 200);

-- The engine's calls come from the signed-in athlete; grants already cover
-- INSERT/UPDATE on this table (20260925100000_fix_health_grants.sql). No new
-- grants needed; nothing is revoked — existing client paths keep working even
-- before the client ships the new writes.

comment on column public.health_sync_state.sync_status is
  'Machine-written sync lifecycle: in_progress → succeeded | failed. written by the sync engine only, for the status screen and cross-device dedupe. Never a health value.';
comment on column public.health_sync_state.sync_started_at is
  'When the in_progress status was claimed. A row whose started timestamp is far in the past marks a crashed run and is stealable.';
comment on column public.health_sync_state.sync_error is
  'The engine''s own failure token (sync_failed / upload_failed / permission_revoked / unavailable), not provider text. Never carries health data.';
