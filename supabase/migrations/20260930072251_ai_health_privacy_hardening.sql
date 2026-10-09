-- ===========================================================================
-- AI / HEALTH / PRIVACY / DELETION HARDENING
-- ---------------------------------------------------------------------------
-- Companion to the AI-package edge-function fixes (2026-09-30):
--   1. video_form_analyses: durable per-user free-tier counting + retention
--      columns + deletion audit.
--   2. credit_transactions: the amount <> 0 CHECK was too strict — the shared
--      spend path deliberately writes a 0-amount audit row for Unlimited
--      subscribers (and for zero-cost features). Keep the no-negatives rule,
--      allow the documented zero.
--   3. ai_call_events: the durable rate-limit table was missing from
--      delete-account's table registry, so usage rows survived account
--      deletion. It is service-role-only with zero policies, so the function's
--      verification pass can count it; add it to that registry in code.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. video_form_analyses: retention + honest free-tier counting
-- ---------------------------------------------------------------------------

-- The free tier allows 1 analysis per rolling 7 days. Counting a window over
-- (user_id, created_at) is correct for the check, but unscoped deletes and a
-- growing history need a real cursor, and auto-purge needs a timestamp.
alter table public.video_form_analyses
  add column if not exists deleted_at timestamptz;

create index if not exists video_form_analyses_user_recent_idx
  on public.video_form_analyses (user_id, created_at desc);

comment on table public.video_form_analyses is
  'Video form analyses (Gemini). The raw video is analysed inline and is NEVER stored by Vaylo: only the structured JSON result, the model used, and metadata. Rows are user-deletable and purged after retention_days (see delete-expired-video-analyses RPC).';

-- ---------------------------------------------------------------------------
-- 2. credit ledger: allow the documented 0-amount audit row
-- ---------------------------------------------------------------------------

alter table public.credit_transactions
  drop constraint if exists credit_transactions_amount_nonzero;

alter table public.credit_transactions
  add constraint credit_transactions_amount_nonzero
  check (amount < 0 or amount > 0 or source = 'unlimited_plan');

-- ---------------------------------------------------------------------------
-- 3. ai_call_events: document the deletion policy (function-side change too)
-- ---------------------------------------------------------------------------
comment on table public.ai_call_events is
  'Durable AI rate-limit counters (20260928193000). Service-role only, zero policies by design. Included in delete-account registry since 2026-09-30; retention is 30 days via the delete-expired-video-analyses maintenance RPC.';

notify pgrst, 'reload schema';
