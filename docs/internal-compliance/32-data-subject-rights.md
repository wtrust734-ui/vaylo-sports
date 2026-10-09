# 32 — Data Subject Rights Procedure

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> Two of the rights are genuinely implemented and verifiable. One is blocked by an
> undeployed function. The rest are described in published policy but have no procedure
> behind them. This document says which is which, rather than implying they are all handled.

## 1. Status at a glance

| Right | Mechanism | Status, verified 2026-10-02 |
|---|---|---|
| Erasure | `delete-account` edge function | **Deployed and working** |
| Portability / access | `export-my-data` edge function | **Source exists; function is NOT deployed — returns 404** |
| Rectification | Direct database writes by the athlete | Works |
| Restriction | Not implemented | **Gap** |
| Objection | Not implemented | **Gap** |
| Consent withdrawal | Wearable disconnect | Works for wearables only |
| Automated decision-making | Not applicable, and this is stated | See §6 |

## 2. Access and portability — blocked

`supabase/functions/export-my-data/index.ts` exists and is written to the correct shape: it
authenticates the caller with `admin.auth.getUser(token)`, it takes no user id parameter (so a
caller cannot request someone else's data), and it walks the shared `USER_TABLES` registry
covering 88 tables.

**It returns 404.** The function is not deployed. The same applies to `support-request`.

This matters more than a normal broken feature, because **the published Privacy Policy
promises portability and the in-app Legal screen has a "Download your data" tile**. An athlete
who exercises that right today gets an error. A portability right that is described in
policy and dead in the app is worse than one that is honestly described as unavailable.

The export code does have a good property worth preserving: it reports partial exports rather
than claiming completeness, setting `complete: false` and listing unreadable tables. That is
the right instinct and should survive whatever replaces it.

**Action:** deploy the function, or change the published wording. Do not leave both promises
live and neither fulfilled.

## 3. Erasure — implemented

`delete-account` is deployed. It uses the same `USER_TABLES` registry, so deletion coverage and
export coverage cannot silently diverge — a genuinely good property of this codebase.

Verified 2026-10-02: `content_reports` is in the registry and in the live schema. It was the
only registry table absent from the database before migration `20261001120000` was deployed,
which would have meant a reporter's report surviving account deletion.

**Caveats:**

- Deletion depends on `ON DELETE CASCADE` plus the registry. No automated check compares the
  registry against the live schema, so a newly added table could be missed (document 30, gap 4).
- Deletion propagates at the database level but data can persist in provider backups until
  they are overwritten (document 30, §5).
- A report about another person, or a safety report about a child, may need to be retained even
  after the reporter deletes their account. **No exception logic for this exists.** Deleting a
  reporter's account today would cascade into their safety report. That is a live conflict
  between two good intentions and is not resolved.

## 4. Rectification

Works. The athlete owns their rows and RLS restricts writes to their own. This is the right
shape: no back-office process is needed for the common case.

## 5. Restriction and objection — not implemented

There is no mechanism for either. The natural implementation is a column on `profiles`
alongside the consent columns, plus a trigger that withholds rows from the shared feed. That
work has not been done.

**Consequence:** the Privacy Policy cannot currently honour a restriction or objection request
through the product. Both are described there as rights. They would have to be actioned by
hand, and there is no procedure, owner or timescale for doing that.

## 6. Automated decision-making

**None exists**, and that is a favourable position rather than a gap. There is no profiling,
no scoring that determines access, and no ranking that affects an athlete's access to anything.
Leaderboards are opt-in and cosmetic.

Stating this plainly is useful: it is the sort of thing that is easier to lose than to gain,
and it should be re-checked if any personalisation or recommendation feature is added.

## 7. Consent records

Migration `20261001120000` added `profiles.terms_accepted_at`, `profiles.terms_version` and
`profiles.health_consent_at`, deployed and verified 2026-10-02. `health_consent_at` is `NULL`
for every existing account, which the Policy correctly treats as "not yet recorded — the app
must prompt, not assume".

**Gap:** there is no withdrawal mechanism for recorded consent beyond disconnecting a wearable.

## 8. Cannot be completed here

- The time limits for responding to a rights request depend on the operator's establishment and
  regulator (document 37).
- Whether a specific request must be refused on any ground cannot be assessed here.
- Identity verification for a rights request has no procedure. The account being authenticated
  is currently the whole check, which is acceptable for self-service and insufficient for
  anything acting on an athlete's behalf.