# REFUNDS — the refund system, and the contract Google Play must satisfy

*Status: implemented and tested without a payment provider. Credit restorations
run for real. Monetary refunds are **recorded, reviewed and approved**, but no
money moves — and the system says so rather than pretending otherwise.*

---

## 1. What works today

| Capability | State |
|---|---|
| Credit ledger for AI charges (reserve/spend/restore) | Already existed (`credits_spend` / `credits_grant`); now linked to a `service_jobs` row per charged call |
| Refund request in the app (Profile → Purchases & refunds) | Working |
| Automatic credit restoration for a verified failed AI job | Working, idempotent |
| Deterministic eligibility engine | Working, unit-tested |
| Persistent case + audit timeline | Working |
| Administrator review desk (`/admin/refunds`) | Working |
| E-mail to the administrator with a secure case link | Working, retried, deduped |
| Approve / reject with administrator identity and reason | Working |
| Customer e-mails on submission and decision | Working |
| Monetary refund execution | **Not implemented.** Recorded as `awaiting_provider`; never marked completed |
| Google Play subscription cancellation / entitlement reconciliation | Not implemented; model and hooks exist |

The one thing to say plainly: **an approved money refund means "we owe this and
will pay it once a provider can execute it", not "paid".**

---

## 2. Layers

```
app screen          src/pages/PurchasesRefunds.tsx       (customer)
admin desk          src/pages/AdminRefunds.tsx           (administrator)
transport           src/lib/refunds.ts                   (types + invoke)

edge functions
  refund-request    options | submit | case | escalate
  refund-admin      list | get | decide | retry_notification
  refund-notify     cron: retry the e-mail outbox (x-cron-secret)

engines (pure)
  _shared/refundPolicy.ts     eligibility, amounts, rule ids, statuses
  _shared/refundProvider.ts   provider seam (Google Play / unconfigured)
  _shared/refundEmail.ts      the words, the review link
  _shared/refundNotify.ts     outbox: enqueue, claim, send, backoff
  _shared/serviceJobs.ts      started / delivered / failed per charge

database
  20261023120000_refunds_core.sql
    service_jobs · refund_cases · refund_case_events · refund_notifications
    refund_execute_credit_restore()            atomic, ledger-keyed
    refund_case_reject()                       reason mandatory
    refund_case_record_provider_decision()     provider stage only
    refund_trigger_notification_retry()        pg_cron → refund-notify
```

The browser never chooses an amount, a status or an eligibility outcome. It sends
a reason, optional words, the id of a transaction it can see, and a submission key.

---

## 3. Data model

### `service_jobs` — what happened to a charged AI call

| Column | Meaning |
|---|---|
| `charge_key` | the same idempotency key `credits_spend()` wrote on the debit |
| `status` | `started` (charged, no outcome) · `delivered` (success return) · `failed` (failure established) |
| `credits` | credits the call cost |
| `error_code` | provider/validation code, when known |

`started` is **not** failed. A request against it goes to a person; only
`failed` can auto-restore.

### `refund_cases` — one durable request

`public_ref` is the customer-facing reference (`RF-261023-AB12`). It is not a
secret: authorisation is the reader's session, and for an administrator
`has_role(auth.uid(),'admin')`.

Key constraints:

- `unique (user_id, submission_key)` — a double-tapped submit returns the same case.
- unique `(user_id, charge_key)` where status is active — one open case per charge.
- `status` is a closed set; `escalation_rules` records the exact rules that sent
  the case to review.
- `eligibility` stores a snapshot of what the engine saw (audit only, never an
  authorisation input).

### `refund_case_events` — append-only timeline

Every transition, actor, rule and grant key. The customer sees a filtered,
human-readable subset; an administrator sees all of it.

### `refund_notifications` — the e-mail outbox

One row per `(case_id, kind, dedupe_key)`. `pending → sending → sent | failed`
with bounded exponential backoff (6 attempts). The case is written **before**
this table is touched.

### Statuses

```
submitted ─┬─→ under_review ─┬─→ approved_processing ─→ completed
           │                 ├─→ awaiting_provider ──→ completed (provider only)
           │                 ├─→ declined
           │                 └─→ processing_failed
           └─→ declined (automatic, status + human-review route)
```

`completed` for a **money** case requires a provider-issued refund id; the RPC
raises if it is missing.

---

## 4. The decision engine

`evaluateRefundRequest(facts)` is pure and deterministic. No model call, no
client input beyond the reason and details. Outcomes: `auto_credit_restore`,
`review`, `auto_reject`.

| Rule id | Outcome | Meaning |
|---|---|---|
| `ai_job_failed_verified` | restore | The job is failed; credits come from the charge, not the request |
| `ai_job_delivered` | reject (escalatable) | Policy does not refund a delivered service; a human can still look |
| `ai_job_unverified` / `ai_job_missing` | review | Delivery cannot be proven either way |
| `nothing_charged` | reject | Unlimited plan or zero-price call |
| `already_restored` | reject | This charge was already returned |
| `active_case_exists` | reject | Another open case for the same charge |
| `charge_verification_incomplete` | review | Failed job without a loadable charge |
| `purchase_fully_used` | reject | No unused credits to refund |
| `purchase_unverified` | review | No matching purchase |
| `provider_not_connected` | review | Money path needs a provider |
| `subscription_requires_provider` | review | Store holds the money |
| `duplicate_or_unauthorised_review` | review | Never auto-rejected |
| `submission_velocity_review` | flag | ≥5 submissions/day adds a review flag — never a rejection |

Deliberate non-rules: there is **no lifetime refund cap**, and a previous refund
is not evidence of abuse. The only hard duplicate guard is the same charge.

Unused purchased credits are estimated from the ledger (`grants − spend`, floored
at zero, newest purchase first) and only ever presented to a human as an amount.

---

## 5. E-mail → approval

1. `refund-request` inserts the case (and its `submitted` event) first.
2. If the outcome is `review`, it enqueues an `admin_review` notification and
   attempts delivery immediately.
3. The mail contains: subject `[Refund review] RF-… — <kind>, <amount>`, the case
   ref, type, requested amount, the rule ids that escalated it, and a link to
   `<PUBLIC_APP_URL>/admin/refunds?case=RF-…`.
4. Opening the link authorises nothing. `RequireAdmin` sends a signed-out reader
   to sign in (remembering the case URL) and refuses a non-administrator.
5. The desk shows the facts and two buttons. **APPROVE** and **REJECT** each need
   a second confirmation. Reject requires a reason.
6. Approve on a credit case calls `refund_execute_credit_restore()`; approve on a
   money case records `awaiting_provider` (or asks a configured provider).
7. A repeated decision hits the RPC's status guard and a repeated grant collapses
   on the ledger's `refundcase:<charge_key>` key.
8. Mail failure never loses the case: `refund-notify` retries every 15 minutes,
   and the desk has "Retry unsent email" (which also rescues exhausted rows).

Recipients: `REFUND_ADMIN_EMAIL`, else `OPERATOR_EMAIL`, else the operator inbox
already used by `report-error`. Customer addresses come from the auth record,
never from the request.

---

## 6. Configuration and deployment

Apply the migration, then set function secrets:

```bash
supabase db push

supabase secrets set \
  REFUND_ADMIN_EMAIL=you@example.com \
  REFUND_CRON_SECRET="$(openssl rand -hex 32)" \
  PUBLIC_APP_URL=https://your-app-origin.example
```

One Vault entry must match `REFUND_CRON_SECRET`, or the scheduled retry logs a
warning and does nothing:

```sql
select vault.create_secret('<same secret>', 'refund_cron_secret');
```

Deploy the functions (each redeploy must keep the JWT setting in
`supabase/config.toml`; `refund-notify` is the only one with `verify_jwt = false`):

```bash
supabase functions deploy refund-request refund-admin refund-notify
```

Optional but recommended: set `REFUND_PROVIDER=google_play` once Play
verification credentials exist. **Do not** set `REFUND_MONETARY_ENABLED=true`
until refund execution is implemented and verified — it gates the provider, not
the policy.

---

## 7. Google Play integration contract

The refund engine, ledger, admin desk and UI know only `RefundProvider`
(`supabase/functions/_shared/refundProvider.ts`). Adding Google Play means
implementing the methods below **in that class** and flipping its `capabilities`
flags. Nothing above the adapter should need to change.

### 7.1 Purchase verification (already real)

`verifyPurchase({ reference, productId })` must call the Play Developer API with
the configured service account and return the authoritative transaction:
`purchased | pending | cancelled | refunded | unknown`, the product id, purchase
time and a provider reference safe to store. It already delegates to
`_shared/playBilling.ts`; keep that as the only verification path.

### 7.2 Initiate a refund

```ts
initiateRefund({ caseRef, reference, amountCents, currency, idempotencyKey, reason })
```

Obligations:

1. Resolve the store order from `reference`; never trust an amount sent by the
   caller for anything other than reconciliation.
2. Refuse when the order is already refunded — return `state: "executed"` with the
   existing provider refund id, or `state: "pending"`, **not** an error that the
   admin desk would retry blindly.
3. Return `state: "executed"` only with a real `providerRefundId` from the
   provider. `refund-admin` maps anything else to `awaiting_provider`,
   `approved_processing`, `processing_failed` or `unsupported` — never to
   `completed`.
4. `noMoneyMoved` must be `true` for every non-`executed` result.
5. Honour `idempotencyKey` (`refundcase:<public_ref>`) where the API allows it;
   otherwise dedupe on the order id before issuing.
6. Handle provider errors explicitly: `provider_rejected`, `provider_unreachable`,
   `provider_not_configured`. An unreachable provider is `failed`, not success.
7. Never log the purchase token, service-account key or full provider payload.

### 7.3 Refund status

`getRefundStatus(providerRefundId)` must return the authoritative state
(`executed | pending | failed | unsupported`). It is what a reconciliation job
uses to move `approved_processing` → `completed` or `processing_failed`.

### 7.4 Notifications (webhook)

`handleNotification(payload)` must:

1. Authenticate the caller **before parsing semantics** — a Pub/Sub push
   notification must be verified as coming from the configured subscription
   (OIDC token/audience), not merely be well-formed JSON.
2. Treat every field as untrusted input, cap sizes, and never act on an
   instruction embedded in the payload.
3. Map provider events to case transitions only — a notification may never
   approve a case, restore credits or create a refund.
4. Be idempotent: the same notification delivered twice must produce one state
   change. Reconcile against `getRefundStatus` before writing.
5. Store only the minimum identifiers needed to reconcile.

A webhook endpoint for this is not deployed today; when it is, it should follow
`stripe-webhook`'s shape (signature/OIDC check, raw-body verification,
`verify_jwt = false` declared in `config.toml` with the reason written down).

### 7.5 Subscriptions and entitlements

`reconcileEntitlements(userId)` must, on a voided purchase or a refunded
subscription:

1. Read the authoritative subscription/purchase state from Play.
2. Revoke or correct the entitlement (`subscriptions`, `grant_infinite_credits`)
   idempotently, recording what changed.
3. Leave unrelated balances alone; never claw back credits that a separate,
   legitimate purchase granted.
4. Report `entitlementsChanged` so a reconciliation job can log it.

Cancellation itself stays with Google Play (the customer's own control); the app
only explains where it is and records a refund request separately.

### 7.6 Capabilities

Only after 7.1–7.5 are implemented and verified:

```ts
capabilities = {
  verify_purchase: true,
  transaction_state: true,
  initiate_refund: true,   // only when 7.2 is real
  refund_status: true,     // only when 7.3 is real
  notifications: true,     // only when 7.4 is verified
  subscription_reconcile: true,
};
```

`isConfigured()` must keep requiring credentials **and**
`REFUND_MONETARY_ENABLED=true`. `providerCanRefund()` is what the UI and the edge
functions use to decide whether money can move; nothing else may infer it.

### 7.7 Tests the implementation must add

- executed / pending / failed / unsupported provider results each map to the
  right case status, and only `executed` + id is ever `completed`;
- a provider failure does not produce a completed case or a second attempt;
- a replayed provider notification changes nothing the second time;
- a foreign/unsigned notification is refused before any database write;
- entitlement reconciliation is idempotent and does not touch unrelated grants.

---

## 8. Security model

- **RLS**: users can `SELECT` their own cases and events; nobody can
  `INSERT/UPDATE/DELETE` refund rows from a client role. Admin reads use
  `has_role(auth.uid(),'admin')`.
- **Server-only writes**: every mutation goes through an edge function holding the
  service role and re-deriving the facts. Every RPC re-checks
  `auth.jwt()->>'role' = 'service_role'`.
- **Atomicity**: `refund_execute_credit_restore` takes `FOR UPDATE` on the case and
  a per-user/per-charge advisory lock, then grants with a key derived from the
  charge.
- **Idempotency**: submission keys, unique active-case index, ledger keys,
  notification dedupe keys, provider idempotency keys.
- **Rate limiting**: shared guard throttle plus 12 submissions/day and 5 open
  cases per account (hard bounds; the velocity flag is separate and review-only).
- **No secrets in the client**: the app calls functions with its session; provider
  credentials live only in function secrets.
- **No money without a provider**: `completed` for money is unreachable without a
  provider refund id; the adapter returns `unavailable`/`unsupported` otherwise.

---

## 9. Tests

`src/lib/refunds.test.ts` — 57 tests: every policy branch, duplicate prevention,
status vocabulary, e-mail content and link, adapter honesty, SQL/RPC guards, the
two screens, and the website copy.

`src/pages/PurchasesRefunds.test.tsx` — 3 rendered tests: transaction list, the
money caveat, reason filtering, submit payload (ids + submission key, no amount),
and a load failure that is shown rather than swallowed.

What is **not** covered by automated tests, and why:

- The RPCs themselves need a live Postgres with `auth.users`; their guards are
  asserted against the migration source. Apply the migration to a staging project
  and run the manual checklist in §10 before relying on the money path.
- No test issues a real refund. There is no provider to issue one.
- The rendered admin desk is covered by source assertions, not a DOM test; its
  approval path is exercised through the edge function contract, not a live
  session.

---

## 10. Manual verification after deploying the migration

1. Submit a request for a **delivered** AI charge → `declined`, with "ask for a
   human review".
2. Escalate it → `under_review`, and the admin mail arrives with the case link.
3. Approve a **credit** case → balance increases once; press approve again →
   refused, balance unchanged.
4. Approve a **money** case → `awaiting_provider`; confirm no ledger row was
   created and no "completed" text appears anywhere.
5. Reject with a reason → `declined`, customer mail includes the reason.
6. Stop SMTP (unset the secret) and submit a review case → the case still exists,
   the outbox row says `email_not_configured`, and "Retry unsent email" works once
   SMTP is restored.
7. Sign out and open the review link → sign-in is required; after signing in as
   an administrator the same case opens. As a non-admin, the desk refuses and the
   function answers 403.
