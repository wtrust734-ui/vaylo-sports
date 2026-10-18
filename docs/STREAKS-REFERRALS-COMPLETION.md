# Streak Rewards & Referral Programme — Completion Report

Date: 2026-10-19

## 1. What was built

**Streak rewards system** — a server-authoritative streak on qualifying activity days:

- New tables: `streak_activity_days` (one unique row per user/day, with the source that qualified it), `streak_milestone_wins` (one unique row per user/milestone), `streaks` (cached current/longest run, recomputed at every claim).
- Claiming happens at the existing verified activity surfaces: training log save, recovery check-in, learning knowledge check, weekly process-goal completion, and scheduled rest days in the active plan. The backend re-validates every source through the same proof validators the XP service uses, so duplicate events, retries, concurrent claims, forced backdates and device-date manipulation cannot create false qualifying days.
- Milestone XP flows exclusively through the existing `xp_award()` service, its ledger, its proof gate and its idempotency keys — no second balance was created and no level system was touched.
- UI: dashboard streak tile (`StreakCard`), full Streaks screen at `/streaks` (current, longest, next milestone with progress, all eight milestones locked/unlocked, XP each, recent history incl. rest-day reasons, honest rules), Profile menu rows, and a restrained idempotent toast when a milestone grants.

**Referral programme** — cash commissions only from verified revenue:

- New tables: `referral_commission_config` (all knobs: pct, fee/tax exclusions, hold days, £25 threshold, GBP payout currency, 30-day attribution window, on/off), `referral_commissions`, `referral_commission_events` (audit), `referral_payouts`, `referral_admin_audit`, `referral_clicks` (code + time only, no personal data).
- `settle_referral` (called by process-purchase after the store receipt check, service-role only) now also records one commission per referred customer, calculated from money Vaylo keeps, held for the configured hold period. No click, registration, trial or failed payment ever creates one.
- Referrer dashboard section on `/referrals` with honest statuses (paying customers, pending, approved, paid, cancelled), threshold, 18+ eligibility, withdrawal amount and payout-request button; anonymous click recording wired into the auth landing (`/auth?ref=`).
- Admin console at `/admin/referrals` behind `RequireAdmin`: configuration, payout request review/approval/rejection, recording real payouts (provider + reference required), cancelling commissions with reasons, and a JSON reconciliation export. Every mutation checks `has_role(uid,'admin')` server-side and writes before/after audit rows.

## 2. The eight streak milestones

| Days | Name | XP |
|---:|---|---:|
| 3 | The Starter | 25 |
| 7 | The Consistency Badge | 75 |
| 14 | The Momentum Badge | 125 |
| 30 | The Discipline Badge | 250 |
| 60 | The Dedication Badge | 400 |
| 90 | The Elite Habit Badge | 600 |
| 180 | The Unbreakable Badge | 1,000 |
| 365 | The Year of Progress Badge | 2,000 |

Stored as configured rows in `xp_reward_rules` (kinds `streak_milestone_3…365`), one award per account ever, each also stamped permanently into `streak_milestone_wins` as the achievement record.

## 3. XP integration confirmation

Milestone XP is granted **only** inside `streak_claim_day` by calling `public.xp_award(kind, "<user>:<days>")` — the same service, ledger (`xp_transactions`), proof gate (`_xp_validate_source`, extended with a `streak_milestone_*` branch that requires a matching wins row and amount) and idempotency machinery as every other XP kind. The client never sends an XP amount and never calls `xp_award` for milestones. No new balance, ledger or level system was created.

## 4. Referral commission formula

```
net_eligible  = round(gross_minor × (100 − provider_fee_pct − tax_pct) / 100)
commission    = round(net_eligible × commission_pct / 100)
```

Defaults: `provider_fee_pct = 0`, `tax_pct = 0`, `commission_pct = 15`. `gross_minor` is `user_purchases.price_cents` — the price the customer actually paid (discounts are already inside it), not the list price. Refunds, chargebacks and taxes are handled as config exclusions (`tax_pct`) plus administrative cancellation with recorded reasons; the fee/tax percentages are the sanctioned place to model provider fees once real processing rates are known. Example from the config as shipped: £20 net → £3; £40 net → £6 (if kept all of the income in the zone).

## 5. Conditions before commission becomes payable

1. The referee's eligible first paid purchase is verified by the payment provider reference server-side (process-purchase receipt check → settle_referral).
2. The programme is enabled and qualification passed (positive price, transaction reference match, not self-referral, one commission per customer).
3. The hold period (30 days) has elapsed and the commission moved `pending → eligible` (an hourly pg_cron job, `referral-commissions-hold-sweep`, runs `referral_commissions_process_holds`; scheduled in the migration and registered live).
4. No refund/chargeback/fraud cancellation was recorded (admin cancellations are the recorded reversal path).
5. The referrer is adult (`viewer_is_adult()`) and the withdrawal request meets the £25 threshold net of already requested/paid amounts.
6. An administrator approves the payout and separately records the real transfer's provider + reference. Commission is not withdrawable money until approval and execution.

## 6. Payment / payout integrations actually connected

- **Inbound settlement**: the existing verified store-receipt path in `supabase/functions/process-purchase` (`verification.reference`) → `user_purchases` → `settle_referral`. This is the only revenue source considered "verified".
- **Payouts**: **none automated.** The codebase has no real payment-out provider, so payouts are honest pending-review requests approved and executed by the operator, with the provider and real transfer reference recorded by an admin. No payout is ever reported as paid without that recorded reference. This is reported as the remaining manual step: plugging in a real payout provider (e.g. bank transfer/Wise) requires credentials and supplier setup that must be done outside the code.

## 7. Database and access-control changes

- Tables with RLS: `streak_activity_days`, `streak_milestone_wins`, `streaks`, `referral_commissions`, `referral_payouts` (all read-only for owners via `for select` policies), plus no-policy `referral_clicks`, `referral_commission_events`, `referral_admin_audit` (service/admin only) and public-read-only `referral_commission_config`.
- No client insert/update/delete policies anywhere new; all mutations go through SECURITY DEFINER functions that take the caller from `auth.uid()` or require `has_role(uid,'admin')`.
- `xp_reward_rules` gained the 8 milestone kinds; `_xp_validate_source` was renamed to `_xp_validate_source_core` and wrapped with the milestone branch so milestone XP passes a real proof gate.
- Uniques: `(user_id, day)` for activity days, `(user_id, milestone_days)` for wins, `referral_id` and `purchase_id` unique on commissions.

## 8. Tests executed and actual results

- New source-contract suites (35 tests): `streakRewards.test.ts` (milestone exactness, XP-through-service-only, window bounds, once-per-account, client non-minting, server streak feeding achievements) and `referralCommissions.test.ts` (formula, qualification gate, idempotency, payout honesty, 18+, audits, RLS shape, server-issued codes). **All pass.**
- Full regression: **167 test files / 2,736 tests, all passing** (`npx vitest run`).
- Typecheck: `npm run typecheck:app` — clean.
- Production build: `npm run build` — succeeds.
- Live DB: three migrations applied via the management API (`run-sql-file.cjs`, HTTP 201); verification queries confirmed 8 milestone rules (sum 4,475 XP), 9 new tables, config row correct (15% / 30d / £25 / GBP), all RPCs present (`streak_claim_day`, `streak_panel`, `settle_referral`, `_xp_validate_source_core`, `referral_*` admin RPCs), and the hourly hold-sweep cron job registered.

Follow-up hardening applied after the first review pass:

- **Referral codes are now server-issued** (`referral_code_issue`, migration `20261019120000`): crypto-random 11-character codes with collision retry, idempotent per account, replacing the guessable Math.random client generation. Existing live codes were checked (no duplicates; one code per user by primary key). The appeals/admin RPC `referral_admin_record_dispute` (disputes and authorised adjustments recorded as audited events, money untouched) and the admin events list were added in the same migration.
- **Streak achievements now actually earn**: the 3/7/14/30/60-day streak achievements (and others reading the streak counter) previously could never fire because the stats hook passed a hardcoded 0. `useAchievementStats` now reads `streaks.current_streak` — the server's own cached run — and the built-in checks auto-award through the existing achievement insert path.
- Contract suites extended to pin both fixes (35 tests in the two streak/referral suites; 2,736 tests total).

## 9. Missing credentials, manual steps, limitations

- **Automated payouts**: no payout provider is wired. Payouts are operator-executed; admin UI records the real reference.
- **Sandbox E2E of a real payment event**: cannot be executed without running real store test purchases against the live project; not done. The settlement path is covered by source-contract tests and the live function deployment.
- **Attribution window**: clicks are recorded anonymously when the share link lands on `/auth?ref=`; a code typed from memory attributes at redemption without a click record (explicitly documented in-product) — cross-device/install-time deferred attribution is not implemented and is not promised.
- **Refunds**: `user_purchases` has no refund/chargeback table; reversals are admin-recorded cancellations with reasons until a real refund web-hook exists.

## 10. Unresolved profitability, legal, privacy, security concerns

- **Profitability**: 15% of first-payment net is the configured *initial* policy — not a validated margin call. Before real payouts, confirm against actual subscription margins, acquisition and support costs, payment fees and refunds (the config knobs make this tunable without a redeploy).
- **Legal**: commission cash requires 18+ (enforced server-side via DOB-derived adultness), and the referral terms should be reviewed alongside advertising/consumer-protection rules for the launch market; the leaderboard remains aggregate-only and prize-adjacent copy must stay inside published competition terms.
- **Privacy**: referral clicks store only the code + timestamp; no IP, no account, no cross-site identifiers.
- **Security**: users cannot write any balance client-side (RLS + no policies + definer functions); admins cannot act without leaving an audit row; duplicate webhook/settlement replays collapse on unique constraints and the existing 409 already-applied gate.

## 11. Avatar and cosmetics confirmation

No avatar or cosmetics tabs were created or restored. The streak and referral work references none of the removed avatar/cosmetics surfaces; rewards are XP, badges and (referrals) cash — never avatars, skins or virtual outfits.
