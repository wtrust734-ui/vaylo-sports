-- ==============================================================================
-- OPERATIONS METRICS — one honest row per day about how the product ran (MDF-007)
-- ===============================================================================
-- Why this exists.
--
-- The observability that already works is real but scattered:
--   * every provider call logs structured key=value lines ([ai] ok feature=…
--     ms=… tokens=…) into Supabase's log drain, which is readable but not
--     queryable and expires by tier;
--   * client failures are fingerprinted into app_error_reports and triaged at
--     /admin/errors, and failed auto-refunds land there too (see the refund
--     reliability work);
--   * every AI use is a row in credit_transactions (charged) and — on
--     failure — its refund, so the money side is in the ledger already.
--
-- What was missing is the roll-up: "was yesterday healthy, and what did the AI
-- bill look like" required opening three consoles. This migration adds the
-- smallest thing that answers that from SQL: nightly inputs folded into ONE
-- row per day, plus a per-feature cost view built live from the ledger.
--
-- Deliberately NOT in here:
--   * No third-party APM. The published advertising and cookie pages promise
--     no analytics or error-reporting SDK, and a paid tool needs a new data
--     processor. Postgres and the edge functions are already declared
--     processors — so the numbers stay inside the project they describe.
--   * No latency histogram. Edge latency is in the log drain (see the
--     monitoring strategy doc); a table the roll-up itself cannot source
--     honestly would be a table full of nulls. The [ai] lines carry
--     feature=… ms=… tokens=… for the calls that make slow requests matter.
--   * No payment metrics table. Charges and refunds are already the ledger's
--     job; external payment health is stated at its source (Play Console,
--     Stripe dashboard) and only named in the alerting plan.
--
-- Safety properties (same conventions everywhere in this repo):
--   * ops_rollup_one_day is idempotent — a cron that fires twice rewrites the
--     same row with the same numbers, never a doubled count.
--   * EXECUTE is revoked from every client role: a function that reads the
--     whole ledger is an operator surface, not an app surface.
-- ===============================================================================

create table if not exists public.ops_metrics_daily (
  day             date primary key,

  -- Every AI call the durable limiter accepted that day. ai_call_events has a
  -- 30-day retention sweep, which is exactly why these are copied nightly
  -- rather than queried live: old days stay in history after the source empties.
  ai_calls        integer not null default 0,

  -- Money side of the ledger: what was charged and what came back.
  credits_charged integer not null default 0,
  credits_refunded integer not null default 0,

  -- Failure shapes seen (not raw occurrences): app_error_reports names of new
  -- fingerprints, and how many of them were failed auto-refunds.
  error_shapes_new integer not null default 0,
  refund_failure_shapes integer not null default 0,

  computed_at     timestamptz not null default now(),

  -- A day that failed its rollup must be visibly wrong, not silently zero:
  -- the operator queries WHERE later and reruns the day by hand.
  constraint ops_metrics_daily_nonnegative
    check (ai_calls >= 0 and credits_charged >= 0 and credits_refunded >= 0
      and error_shapes_new >= 0 and refund_failure_shapes >= 0)
);

alter table public.ops_metrics_daily enable row level security;
-- No policies on purpose: written and read only by the rollup function and the
-- operator's SQL console. RLS with no policy is closed, exactly like
-- ai_call_events.

-- ---------------------------------------------------------------------------
-- The nightly rollup — one day in, one row out, safe to rerun on a miss.
-- p_day is explicit (not now()) so a missed night can be replayed and so the
-- numbers never depend on what time the cron fired.
-- ---------------------------------------------------------------------------
create or replace function public.ops_rollup_one_day(p_day date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.ops_metrics_daily (
    day, ai_calls, credits_charged, credits_refunded,
    error_shapes_new, refund_failure_shapes, computed_at
  ) values (
    p_day,

    (select count(*) from public.ai_call_events
     where created_at >= p_day and created_at < p_day + interval '1 day'),

    -- Any deduction. Positive-grant rows (purchases, referral commissions,
    -- promotional grants) never count as charges, and neither do zero-amount
    -- Unlimited audit rows, which sum contributes nothing to by definition.
    (select -coalesce(sum(amount), 0) from public.credit_transactions
     where amount < 0
       and created_at >= p_day and created_at < p_day + interval '1 day'),

    -- A return of credits is a refund when the same ledger row says so:
    -- sources are subtractive on "refund <anything>" ("refund",
    -- "video-form-analysis-refund", "refund-reconciliation"). Purchases and
    -- referral commissions use other sources and stay out of this sum.
    (select coalesce(sum(amount), 0) from public.credit_transactions
     where amount > 0
       and source like 'refund%'
       and created_at >= p_day and created_at < p_day + interval '1 day'),

    (select count(*) from public.app_error_reports
     where first_seen_at >= p_day and first_seen_at < p_day + interval '1 day'),

    (select count(*) from public.app_error_reports
     where name = 'credit_refund_failed'
       and last_seen_at >= p_day and last_seen_at < p_day + interval '1 day'),

    now()
  )
  on conflict (day) do update set
    ai_calls              = excluded.ai_calls,
    credits_charged       = excluded.credits_charged,
    credits_refunded      = excluded.credits_refunded,
    error_shapes_new      = excluded.error_shapes_new,
    refund_failure_shapes = excluded.refund_failure_shapes,
    computed_at           = excluded.computed_at;
end;
$function$;

-- Operator surface, not app surface: the same shape every scheduled function
-- in this project uses (retention sweep, waitlist campaigns, referral holds).
revoke all on function public.ops_rollup_one_day(date) from public, anon, authenticated;
grant execute on function public.ops_rollup_one_day(date) to service_role;

-- ---------------------------------------------------------------------------
-- The per-feature AI cost sheet, built live from the ledger — no retention
-- cliff, so any historic day is still answerable. One row per feature per day:
-- how many paid uses, what was charged, what was handed back after failures,
-- and the net the AI feature actually consumed. This is the number that feeds
-- the marginal-cost check in the monitoring strategy ("does this feature still
-- cover what it costs its provider").
-- ---------------------------------------------------------------------------
create or replace view public.ops_ai_cost_daily as
select
  t.created_at::date                       as day,
  t.feature                                as feature,
  count(*) filter (where t.amount < 0)     as paid_uses,
  -coalesce(sum(t.amount) filter (where t.amount < 0), 0) as credits_charged,
  coalesce(sum(t.amount) filter (
    where t.amount > 0 and t.source like 'refund%'), 0)   as credits_refunded
from public.credit_transactions t
where t.amount <> 0
  and t.feature is not null
group by 1, 2;

comment on view public.ops_ai_cost_daily is
  'Daily per-feature credit economics, computed live from credit_transactions. Charged = abs(sum of deductions); refunded = credits returned with a refund source. Read by the operator (service role / SQL console) to price AI features against provider costs.';

-- The digest the operator actually reads first (the doc's alert tables build
-- on these queries).
grant select on public.ops_metrics_daily to service_role;
grant select on public.ops_ai_cost_daily to service_role;

-- ---------------------------------------------------------------------------
-- Schedule — named so a redeploy upserts the job rather than stacking a second
-- one. 03:17 UTC: after the retention sweep (04:37 UTC reads thirty-day-old
-- rows, the rollup only needs yesterday) and out of the way of the waitlist
-- campaign run at 09:00 and the referral sweep.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'ops-metrics-daily',
  '17 3 * * *',
  $$select public.ops_rollup_one_day(current_date - 1)$$
);
