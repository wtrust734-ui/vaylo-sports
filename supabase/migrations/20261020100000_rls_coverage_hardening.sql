-- ==============================================================================
-- RLS coverage hardening (MDF-002, 2026-10-20)
--
-- Found by auditing the LIVE database (pg_class / pg_policies / role grants),
-- not just the migration files. Three classes of gap:
--
--   A. Four tables had RLS disabled. All four are service-only (their migrations
--      revoke every client privilege), so nothing was reachable today, but RLS
--      off is one `grant` away from being an exposure. Enabling RLS with NO
--      policies is deny-all for client roles; the service role bypasses RLS, so
--      every edge-function and SECURITY DEFINER path is unchanged.
--
--   B. Two over-permissive SELECT policies existed only on the live DB (drift —
--      they are not in any migration) and contradict their migrations' explicit
--      deny-all design:
--        * support_requests            "Support requests readable"  USING (true)
--        * referral_commission_events  "Referral commission events readable" USING (true)
--      They are inert today (SELECT is revoked from client roles on both
--      tables) but would become live the moment anyone re-grants SELECT —
--      support_requests holds emails, message bodies and ip_hash for every
--      support/child-safety ticket.
--
--   C. ad_engine_* read policies drifted from the source of truth. Migration
--      20261018200000 created them as `using (auth.uid() is not null)` — the
--      live DB had a `using (true)` version (anon-readable) plus a second,
--      duplicate permissive policy per table. This migration drops both shapes
--      and recreates exactly one policy per table with the documented gate,
--      matching 20261018200000's "operator-readable; the engine row comes from
--      the runner (service role)" design. Server-side consumers
--      (supabase/functions/ad-engine-tick) all use the service-role client and
--      bypass RLS, so nothing server-side changes. Client DML grants on these
--      tables are also revoked: writes are runner-only (add_bucket / spawn /
--      tick) and were already RLS-denied for clients.
--
-- account_deletion_events keeps its admin-scoped SELECT but gets its unused
-- client DML grants revoked for least privilege (rows are written only by the
-- delete-account edge function via the service role).
-- ==============================================================================

-- ── A. Enable RLS on the four tables that had it disabled ────────────────────
alter table public.private_secrets   enable row level security;
alter table public.xp_levels         enable row level security;
alter table public.xp_level_config   enable row level security;
alter table public.xp_reward_rules   enable row level security;
-- No policies: deny-all for anon/authenticated. service_role bypasses RLS;
-- xp ledger writes run through SECURITY DEFINER functions (owner, not subject
-- to RLS), so award/level progression is unaffected.

-- ── B. Drop the two live-only permissive reads ───────────────────────────────
drop policy if exists "Support requests readable"
  on public.support_requests;
drop policy if exists "Referral commission events readable"
  on public.referral_commission_events;
-- Both tables are deny-all for client roles by design (support_requests.sql
-- "every policy is an explicit deny"; referral_commissions.sql "No policies").
-- Privilege revocation from their migrations already blocks clients; this just
-- removes the contradicting drift.

-- ── C. ad_engine_* — restore the documented read gate, drop the drift ───────
drop policy if exists "Ad engine budget readable"   on public.ad_engine_budget;
drop policy if exists "Ad engine calendar readable" on public.ad_engine_calendar;
drop policy if exists "Ad engine jobs readable"     on public.ad_engine_jobs;
drop policy if exists "Ad engine spawns readable"   on public.ad_engine_spawns;

drop policy if exists "ad_engine_budget_read"   on public.ad_engine_budget;
create policy "ad_engine_budget_read" on public.ad_engine_budget
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "ad_engine_calendar_read" on public.ad_engine_calendar;
create policy "ad_engine_calendar_read" on public.ad_engine_calendar
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "ad_engine_jobs_read" on public.ad_engine_jobs;
create policy "ad_engine_jobs_read" on public.ad_engine_jobs
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "ad_engine_spawns_read" on public.ad_engine_spawns;
create policy "ad_engine_spawns_read" on public.ad_engine_spawns
  for select to authenticated
  using (auth.uid() is not null);

-- Writes are runner-only and were already RLS-denied for client roles (no
-- write policies exist between them). Revoking the still-standing grants makes
-- that deny structural, matching the service-role-only pattern used elsewhere.
revoke insert, update, delete, truncate
  on public.ad_engine_budget, public.ad_engine_calendar,
     public.ad_engine_jobs, public.ad_engine_spawns
  from anon, authenticated;
revoke select on public.ad_engine_budget, public.ad_engine_calendar,
     public.ad_engine_jobs, public.ad_engine_spawns
  from anon;

-- ── D. account_deletion_events — audit table, service-role writes only ───────
-- The anonymous, hashed audit rows are inserted by the delete-account edge
-- function via the service role; client DML grants are unused (no policies)
-- and revoked here for least privilege. The admin-scoped SELECT policy is
-- untouched.
revoke insert, update, delete, truncate
  on public.account_deletion_events
  from anon, authenticated;
