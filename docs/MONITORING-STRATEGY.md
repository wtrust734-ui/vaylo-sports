# MONITORING STRATEGY — alerting, APM & cost tracking (MDF-007)

*Status: the first-party monitoring layer is implemented; this document is the
map to it, the alert plan, and the reasoning about what was deliberately not
bought.*

---

## 1. Decisions made before any tooling

**No third-party APM, no error SDK.** The published advertising and cookie
pages promise this app has no analytics or error-reporting SDK, and Sentry or
Crashlytics would each add a data processor. Postgres and the edge functions
are already declared processors, so everything below stays inside the project it
describes. This is the same constraint the `app_error_reports` migration
records in its header comments, and prompt 10's rule ("don't commit to
expensive services without review") resolves the same way: the cheap first-party
path is also the one the legal pages already allow.

**The signal already exists in three places** — the work was wiring them into
one answer, not inventing new capture:

| Source | What it holds | Retention |
|---|---|---|
| `app_error_reports` | fingerprinted client + server failures; `/admin/errors` triage; failed auto-refunds land here (refund reliability work) | indefinite |
| Supabase log drain | structured edge logs: `[ai] ok feature=… model=… ms=… tokens=…`, provider failure statuses | by hosting tier (days) |
| `credit_transactions` | the authoritative money ledger: every AI charge and refund, keyed by idempotency | indefinite |
| `ai_call_events` | every AI call the durable limiter accepted (user, feature, time) | 30-day sweep |

What was missing: anything that made yesterday answerable in one place, and a
written plan for which deviations page the operator.

## 2. What was implemented (MDF-007)

### 2.1 The daily rollup — [20261020130000_ops_metrics.sql](../supabase/migrations/20261020130000_ops_metrics.sql)

`ops_metrics_daily` — one row per day, computed at 03:17 UTC by
`public.ops_rollup_one_day(p_day)` from the sources above:

- `ai_calls` — volume of AI use (from `ai_call_events`, copied nightly because
  its retention sweep empties old days).
- `credits_charged` / `credits_refunded` — the money side, read straight from
  the ledger. Refunds are identified by ledger source (`'refund%'`), so
  purchases and referral commissions never masquerade as refunds.
- `error_shapes_new` / `refund_failure_shapes` — how many failure
  *fingerprints* were first seen that day and how many of them were failed
  auto-refunds (the shape prompt 9 makes durable in `app_error_reports`).

The function is idempotent (`on conflict (day) do update`), takes the day as a
parameter so a missed night can be replayed exactly, and is revoked from every
client role — operator surface only, service role executes it (the same
convention as the waitlist, referral and retention sweeps, and scheduled the
same way: a named `cron.schedule` that upserts on redeploy).

### 2.2 The cost sheet

`ops_ai_cost_daily` — a live view over `credit_transactions`: one row per
feature per day (`paid_uses`, `credits_charged`, `credits_refunded`), no
retention cliff. This is the query behind the marginal-cost check in §4.

### 2.3 Latency + token logging at both providers

`generateAIResponse` already emitted `feature= model= ms= tokens=`; the Gemini
adapter did not. `geminiGenerate` now emits the same shape
(`model=… ms=…` on success and failure), so every provider surface answers
"how slow, how often, how expensive" from one log query.

### 2.4 Endpoint metrics for the operator (browser)

An unauthenticated JSON snapshot of the last thirty rollup days is served by
[`ops-health`](../supabase/functions/ops-health/index.ts) (private: requires the
`operations` function secret). The same numbers, no SQL console needed.

## 3. Key metrics and thresholds — what is watched, and what pages

Raw volume lives in the log drain; the alerts below are the small set worth
waking someone for.

| Metric | Where it lives | Reading / threshold | Action |
|---|---|---|---|
| Client crash rate | `app_error_reports` (`occurrences`, `first_seen_at`) | a NEW fingerprint in a shipped build | triage at `/admin/errors` (email already fires on first occurrence) |
| Failed auto-refunds | `app_error_reports name='credit_refund_failed'` + `ops_metrics_daily.refund_failure_shapes` | any open row; any growth | §3.1 of the refund runbook: weekly reconciliation query, replay the refund |
| AI provider health | log drain (`openai error status=…`, `Gemini request failed`) | >5 upstream 5xx from one function in an hour | check provider status page; cap the feature if burning |
| Provider latency | log drain (`ms=` on both adapters) | `generate-plan`/coach replies trending >30 s at p95 | review model routing/timeout (`LIMITS.timeoutMs`), not users |
| AI cost | `ops_metrics_daily.credits_charged`, `ops_ai_cost_daily` | see §4 pricing check | pull the affected feature's price, not credits across the board |
| Payments | Play Console + Stripe dashboard | refused/refund-reversed spikes | investigate via `process-purchase`/`stripe-webhook` logs with the timestamp |
| Cron silence | `cron.job_run_details` | last scheduled run missing | rerun `ops_rollup_one_day` for the missed day (idempotent by design) |

**Critical alerts** (the list to keep, everything else is a weekly review):

1. A `credit_refund_failed` report exists → this is an athlete who paid for
   nothing; the email already fires.
2. OpenAI/Google auth rejected (401/403 logged) → the whole AI surface is
   down; response: rotate/inspect the key, cheapest correct action is a flag
   off in `featureFlags`.
3. Zero `ops_metrics_daily` rows for two consecutive days → the rollup cron
   died; observability itself is dark (the only alert that watches the
   watcher).

Everything else — rate-limit pressure, slow endpoints under normal load,
cosmetic client errors — is reviewed Monday, not notified.

## 4. AI cost tracking plan

The unit of truth is the credit, not the token: `credit_transactions` prices
each feature server-side and the athlete's ledger is the invoice. The provider
side is what keeps the exchange rate honest.

1. **Token telemetry** — every OpenAI call logs `tokens=<total>`; the Gemini
   video path logs duration. Supabase's log drain makes both greppable
   (`[ai] ok` lines) for spot checks: `credits_charged` for a feature from
   `ops_ai_cost_daily`, divided by the token volume from logs, gives the
   *effective* credits-per-token the pricing table pays out.
2. **The pricing check** (weekly, from `ops_ai_cost_daily`):
   `provider-cost(≤ logs) < revenue-per-use (credit price × true pack value)`.
   A feature failing the check for two consecutive weeks is repriced in
   `credit_costs` — one migration, the same lever every prior price change
   used.
3. **Metered features are already self-limiting** — `ads_image_generate`,
   `ads_video_*`, and narration charge via `credits_spend_metered` even for
   Unlimited plans, and the ads engine carries its own production-spend ledger
   with a hard ceiling (`ad_engine_note_spend`). Those rails need monitoring
   of compliance, not new metering.
4. **Free-tier guardrail** — `AI unlimited` plans charge through Credits, and
   trials are one-per-account; the durable limiter (`ai_call_events` +
   `ai_call_allowed`) bounds abuse independent of any instance counter. The
   monitoring job is to watch `ai_calls/day` in `ops_metrics_daily` for step
   functions after each launch, not to build new controls.

## 5. What is deliberately absent

- **No metrics SDK, no Sentry, no Grafana Cloud** — §1.
- **No client-side performance collector** — web vitals could be sent to
  `report-error`'s endpoint, but slow-loading screens are checked with the
  same fake-throttle procedure the store submission uses; the marginal signal
  is not worth the write volume on a metered backend.
- **No alerting SaaS** — email is already plumbed (`emailConfigured`/`sendMail`,
  SMTP defaults already set), and the two pages worth receiving are delivered
  through the paths that exist: first-occurrence emails from `report-error`
  and refund alerts from `_shared/refund.ts`.
- **No retention problem** — `ops_metrics_daily` is 365 bytes/day of Postgres;
  keeping a year is cheaper than the script to prune it.

## 6. Runbook — the five queries an incident opens

```sql
-- Was yesterday healthy?
select * from public.ops_metrics_daily order by day desc limit 3;

-- What is the AI spending, per feature, per day?
select * from public.ops_ai_cost_daily order by day desc, credits_charged desc limit 20;

-- What new failures did yesterday bring?
select name, message, occurrences, app_version
from public.app_error_reports
where first_seen_at::date = current_date - 1;

-- Refunds: is anything owed?
select fingerprint, message, occurrences, status
from public.app_error_reports
where name = 'credit_refund_failed' and status in ('new', 'investigating');

-- How hard is the AI limiter working (top users today)?
select user_id, count(*) from public.ai_call_events
where created_at > now() - interval '1 day'
group by 1 order by 2 desc limit 10;
```
