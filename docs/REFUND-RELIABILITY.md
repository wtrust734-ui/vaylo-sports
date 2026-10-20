# REFUND RELIABILITY — auto-refunds for failed AI charges (MDF-008)

*Status: implemented. This doc is the operator's map to the refund path:
what happens when a refund fails, where that failure is visible, and how to
reconcile.*

---

## 1. The chain that already works (unchanged)

Every AI edge function **charges first, produces second**:

| Function | Feature | Refund on failure |
|---|---|---|
| `coach-chat` | `vaylo_coach_message` | 3 paths (AI error / empty body / throw) |
| `weekly-review` | `weekly_coach_review` | 2 paths |
| `ai-analyze` | per-type (`nutrition_scan`, `form_analysis`, …) | 3 paths |
| `video-form-analysis` | per analysis | via `cleanupFailedCall` |
| `generate-plan` | `training_plan_week` × weeks | via `refundAndReset` |
| `edit-plan` | `plan_edit` / `plan_edit_full` | via `refundAndReset` |
| `generate-nutrition-plan` | `nutrition_plan_week` × weeks | via `refundAndReset` |

`spendForUser` (in `_shared/guard.ts`) is the single charge path; `refundCredits`
(in `_shared/refund.ts`) is the single refund path, granted only through the
service-role-only `credits_grant` RPC. A crafted client amount or a stray
`credit_transactions` insert cannot mint credits.

## 2. What this prompt changed and why

### Before
Each refund used a **fresh random idempotency key per attempt** and on failure
**only logged** `console.error("credit refund failed")`. Consequences:

- A retry of the same refund minted a **second** grant (two UUIDs → two ledger
  rows). Nothing in the codebase retried, so this was latent, not active — but
  any future call site loop would have over-credited.
- A refund that failed was invisible: one log line in dropped edge logs. The
  athlete was charged, got nothing, kept the charge, and the operator never knew.

### After
1. **Deterministic keys.** `spendForUser` always charges under an idempotency
   key (its own UUID when the caller passes none) and returns it as
   `spend.idempotencyKey`. Every refund call site threads it through as
   `dedupeKey`; the refund's ledger key is `refund:<charge key>`. Charge and
   refund therefore pair 1:1 in `credit_transactions` by construction, and any
   number of retries of the same refund collapses into one grant.
2. **Bounded in-function retry.** Every refund attempt is retried once
   (`MAX_ATTEMPTS = 2`, 300 ms apart). A refund is a single RPC, so transient
   fetch kills — the common edge-function failure — usually recover on
   attempt two. Long backoff loops were deliberately avoided: this runs inside
   a request the athlete is waiting on.
3. **Durable alert.** If both attempts fail, `refundCredits` writes an
   aggregated row into the existing `app_error_reports` store (name
   `credit_refund_failed`, screen `server:refund`, app version `server`) via
   the service-role `record_app_error_report` RPC — **no new table, no new
   third-party processor**, so the published legal pages (no analytics/error
   SDK) stay true. The first time a given failure fingerprint is seen the
   operator is also emailed; repeats just bump `occurrences`.
4. **Orphan copy removed.** `wearable-oauth/_shared/refund.ts` was an unused
   duplicate of the old helper; deleted so there is exactly one refund
   implementation.

### What is still a deliberate limit

The in-function retry covers transient failures. A sustained outage (credits
unreachable for minutes) fails both attempts and **hands over to alerting +
reconciliation** rather than retrying forever — correct trade-off here, since
the alternative is athlete-visible latency while they wait for a response that
reports an AI failure anyway.

## 3. Monitoring strategy

**Primary surface: `/admin/errors`** (the `app_error_reports` triage queue).
A `credit_refund_failed` row is a real unpaid refund, counted per fingerprint
per app version, so volume is visible at a glance. Anything other than `new`
at the end of a triage pass is handled or deliberately parked.

**The weekly ledger pass** (run from the SQL console, service role):

```sql
-- 3a. Every failed refund the system knows about, most urgent first
select fingerprint, message, occurrences, last_seen_at, status
from app_error_reports
where name = 'credit_refund_failed' and status in ('new', 'investigating')
order by last_seen_at desc;

-- 3b. The reconciliation itself: charges whose refund never landed.
--     The charge row carries the spend key; its refund would be the row
--     keyed `refund:<spend key>`.
select t.user_id, t.feature, t.idempotency_key as spend_key,
       abs(t.amount) as charged, t.created_at
from credit_transactions t
where t.amount < 0
  and not exists (
    select 1 from credit_transactions r
    where r.user_id = t.user_id
      and r.amount > 0
      and r.idempotency_key = 'refund:' || t.idempotency_key
  )
  and t.idempotency_key is not null
order by t.created_at desc;
```

3b is the ground truth and must return **zero rows** in steady state. If it
does not (or if `credit_refund_failed` shows unhandled rows), reconcile by
replaying the same refund key — replay-safe by design:

```sql
select public.credits_grant(
  '<user_id>', '<charged amount>', 'Reconciliation: failed auto-refund replay',
  'refund-reconciliation', 'refund:<spend_key>', '{"kind":"refund"}'::jsonb
);
```

**Email alerting** piggybacks on the existing operator inbox
(`emailConfigured`/`sendMail` — the same SMTP settings `report-error` and the
waitlist already use): one email per NEW failure fingerprint, then counting.
No extra email volume during an incident, no missing alert for a novel one.

**Metric to treat as a red flag:** any `credit_refund_failed` row whose
`occurrences` grows while its status is not `fixed` — that pattern means the
underlying grants are failing persistently and 3b will be backing up.

## 4. Runbook: an athlete reports being double-charged / not refunded

1. Confirm with their `credit_transactions` ledger: find the negative charge
   row, check for a matching `refund:<spend_key>` positive row.
2. Charge without matching refund + an open `credit_refund_failed` report →
   replay via 3b's SQL snippet (the key means replay cannot double-pay).
3. Call site passed the wrong key (should be impossible now) or the athlete is
   wrong → mark the report row `fixed` or `ignored` with a note.
4. If the alert row keeps re-appearing for the same function, fix the cause in
   that function's refund call, then set the row's `status` to `fixed`
   manually — nothing infers it.
