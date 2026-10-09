# 35 — Age Assurance / Age Verification Policy

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> **Verified 2026-10-02 against the live database: 11 accounts exist and 0 of them have a date
> of birth recorded.** Every under-18 protection in this product is conditioned on that field.
> The protections are correctly implemented and currently apply to nobody. That is the single
> most important sentence in this document.

## 1. What age is used for

| Control | Condition | Status |
|---|---|---|
| Nutrition and calorie features switched off | Under 18 | Implemented in code |
| Advertising and sponsored content | Sponsors database-constrained to 18+ | Implemented (and no ads are served at all) |
| Purchases unavailable | Under 18 | Implemented |
| Training volume capped by age | Under 18 | Implemented |
| Group visibility and avatar forced private | Under 18 | Implemented as a database trigger |
| Excluded from sponsor reporting | Under 18 | Implemented |

The column is `profiles.date_of_birth`, populated by athlete self-report at sign-up.

## 2. How age is established — and it is self-report

There is no age verification, no ID check, no third-party age assurance service and no
estimation from behavioural signals. **The athlete types a date of birth and we take it at
face value.**

This is a deliberate trade-off, and it is the right one at this scale: collecting identity
documents to confirm an age band would be a larger intrusion than the risk it addresses, and
would create a new category of sensitive document to protect. The published Child Safety page
says so in plain words.

**It is also, plainly, a weakness.** An under-18 can enter an adult's date of birth and receive
none of the protections. A 20-year-old can enter a child's and receive all of them. There is no
mechanism to detect either.

## 3. The concrete consequence, measured

The protections in §1 depend on `profiles.date_of_birth` being set. As of 2026-10-02:

- 11 accounts exist in production.
- **0 have a date of birth.**
- Therefore `date_of_birth > current_date - interval '18 years'` is `NULL` for every account,
  the minor-privacy trigger cannot fire for anyone, and no age-based switch has any data to
  act on.
- Separately, **all 11 accounts had no `privacy_settings` row at all** before migration
  `20261001120000` was deployed on 2026-10-02. They were all falling through to permissive
  defaults, and the backfill in that migration set all 11 to private with the avatar hidden.
  That part is fixed. The date-of-birth part is not.

**This is a live gap with a simple fix that has not been done:** prompt for date of birth
during sign-up and store it. It is not a technical obstacle; it is unimplemented.

## 4. What the under-18 trigger does, and its limits

`enforce_minor_privacy_defaults()` is a `BEFORE INSERT OR UPDATE` trigger on
`privacy_settings`. When the athlete's date of birth proves them under 18, it overrides
whatever the client asked for and forces `group_visibility = 'private'` and
`show_avatar_publicly = false`.

**Verified by test, 2026-10-02:** a 15-year-old's client request for `public / avatar visible`
is stored as `private / hidden`. A 30-year-old making the identical request is stored as
`public / visible`, so the trigger does not over-reach onto adults.

**Its limits, all real:**

1. It only protects **group visibility and avatar display**. There is **no account-level
   profile-visibility setting in the schema at all**. Five published statements describe one;
   see document 37 and the audit's L-series.
2. It does **not** force `allow_friend_requests` or `allow_community_posting` off. Both still
   default to `true`, including for under-18s. That is a deliberate product decision recorded
   in the migration, because forcing them off would break friending for the 13–17 year olds the
   product is for — but it does mean the "private by default" claim is narrower than the phrase
   suggests.
3. It fires on write, so a minor's settings are only forced the next time they are written. A
   row set before the date of birth is added would not be corrected until then.
4. It depends entirely on self-reported age (§2).

## 5. Age band versus exact date

Most age-based logic uses a **band** (13–15, 16–17, 18+), not the exact date, because the exact
date is more identifying and the bands are what the controls need. `ageBand()` implements this
in the app.

The exception is the database trigger, which compares against an exact 18-year boundary. That
is correct for a legal threshold, but it means the exact date of birth is retained in the
database where a band would do. Worth revisiting if the band can be materialised instead.

## 6. What is not done

- No prompt for date of birth at sign-up, so the field is empty for everyone.
- No age re-check, so a 13-year-old's account does not transition to adult controls at 18.
- No parental consent mechanism, and no parental account (document 29, standards 3.1–3.4).
- No age assurance beyond self-report, and no decision to escalate to a third party.
- No record of an explicit decision that self-report is sufficient. This document is the first
  place that position has been written down.

## 7. Cannot be completed here

- Whether a specific age-assurance standard is legally required cannot be assessed without the
  operator's establishment (document 37).
- Whether the Children's Code threshold test is met — "age assurance is required in a way that
  is proportionate and proportionate to the rights and freedoms of the user" — is a judgement
  for the operator, and is not made here.