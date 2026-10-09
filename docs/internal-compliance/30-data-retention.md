# 30 — Data Retention Policy

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> **No retention schedule is enforced in the database today.** Nothing in this document is
> implemented as an automated deletion job. It is a stated position and a list of what still
> has to be built. It must not be read as a claim that data is deleted on any schedule.

## 1. Principles

Retain personal data only as long as the service needs it for a stated purpose; delete or
anonymise it when that purpose is met. Where a retention period is set by a legal obligation
rather than by choice, that is named as such.

## 2. Proposed schedule, and its current enforcement state

| Category | Proposed period | Basis | Enforced? |
|---|---|---|---|
| Training logs | Life of account | Core service | n/a — kept while account exists |
| Derived metrics (load, recovery, readiness) | Life of account | Recomputable; kept because it is what the user sees | n/a |
| Injury logs | Life of account | Health data the user chose to record | n/a |
| Mental check-ins | Life of account | Same | n/a |
| Nutrition plans | Life of account | Blocked for under-18s | n/a |
| Video clips | Life of account, user-deletable | Large binary, user-controlled | Manual deletion exists; no auto-expiry |
| Wearable imports | Until disconnected, then deleted | User-controlled, per the published notice | **Yes** — disconnecting deletes imported data |
| Activity in the shared feed | Until unshared | Explicit user action | Yes — unshare deletes |
| `content_reports` | **3 years**, then reviewed | Moderation evidence; longer if a dispute is live | **No** |
| `support_requests` | **3 years**, child-safety rows **indefinitely** | Service quality; child-safety records kept for safeguarding | **No** |
| Moderation actions / suspensions | Life of account plus 1 year | Repeat-offender prevention | **No** |
| Auth and session records | Supabase default | Infrastructure | Delegated to Supabase |
| `auth.audit_log_entries` | Supabase default | Infrastructure | Delegated to Supabase |
| IP hashes in `support_requests` | **90 days** | Abuse investigation only; stated as such in the published notice | **No** |
| Backups | **35 days**, then overwritten | Infrastructure | Delegated to Supabase |

## 3. Why the child-safety rows differ

A child-safety report is not a customer-service ticket. Keeping it for a fixed short period
would mean destroying the record of a safeguarding concern while the concern could still be
live. Those rows are therefore retained indefinitely, reviewed annually, and deleted only on
operator decision once no action is possible or needed.

This is a deliberate departure from the general rule, and it is recorded rather than hidden
in a generic table.

## 4. Account deletion — the part that does work

Deleting an account is implemented and is the most complete part of this area:

- a single edge function drives deletion;
- it walks a shared registry of user tables so coverage cannot silently drift from the
  export registry (`supabase/functions/_shared/userTables.ts`);
- foreign keys cascade from `auth.users` on most tables;
- the published page states what survives and what does not.

**Verified 2026-10-02:** `content_reports` is now present in that registry and in the live
schema, which it was not before migration `20261001120000` was deployed. It was the only
table in the registry missing from the database.

**Gap:** deletion relies on `ON DELETE CASCADE` plus the registry. Any table added to the
database but not to the registry would not be cleaned up. There is no automated cross-check
between the live schema and the registry; the coverage is asserted by a test over the file,
not against the database.

## 5. Backups and the honest limit

Supabase retains backups on its own schedule. That means a deletion is not instantaneous in
every copy: data can persist in a backup until it is overwritten. The published account
deletion page says deletion propagates and is then removed from backups within the provider's
retention window; that is a dependency on a schedule this project does not control and has
not verified.

## 6. What must be built before this document is true

| Gap | Risk if unbuilt | Priority |
|---|---|---|
| No automated purge of `content_reports`, `support_requests`, moderation records | Reports and IP hashes retained indefinitely against the stated period | High |
| No expiry of `support_requests.ip_hash` at 90 days | An identifier kept indefinitely, described publicly as short-lived | High |
| No cross-check of the deletion registry against the live schema | Silent orphan data after account deletion | Medium |
| Retention periods published but never enforced | The published statements describe intent, not behaviour | High |
| Backups not verified | Deletion guarantees are approximate | Medium |

## 7. Cannot be completed here

- The 3-year and 90-day figures are **proposals**, not decisions. They have not been approved
  by an operator and should not be published as commitments until they are.
- Whether any retention period is required or overridden by a specific legal obligation in a
  given jurisdiction cannot be determined, because the operator's legal identity is not
  published (document 37).