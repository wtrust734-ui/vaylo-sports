# Payment Sandbox Test Plan & Safety Confirmation (Prompt 07)

**Prepared 20 October 2026 · Mode: logic verification only — NO payments enabled, NO real transactions**
**Verdict: safety guards confirmed in place and fail-shut. One hardening gap fixed (FIX-002 residual). NOT ready to enable payments until the sandbox test plan below passes.**

---

## 1. Safety confirmation — every switch verified OFF

| Guard | Location | Verified value | Fail direction |
|---|---|---|---|
| `PAYMENT_MODE` | [process-purchase/index.ts](../supabase/functions/process-purchase/index.ts) (`Deno.env.get("PAYMENT_MODE") ?? "disabled"`) | **`disabled` by default** — no secret = no money path | Fails shut: losing the secret restores nothing (previously defaulted to client-trusting `test`; Prompt-01-era fix made `disabled` the default, re-verified today) |
| Money refusal | Same file, price loop | Every `priceCents > 0` item is refused with **503 `payments_not_available`** unless `store` mode or agreed free grant | Fail shut |
| `STORE_BILLING_ENABLED` | [billing.ts](../src/lib/billing.ts) | **`false`** (a hard `const`, not a feature flag) — `storeProvider.available()` can never pass | Fail shut |
| Free-grant double switch | Server secret `PAYMENT_MODE=free` **and** client `closed_testing: true` must both agree; server flag is the authority | Both verified in the grant path | Mismatch ⇒ `free_grant_unavailable`, nothing granted |
| Unlimited in free mode | `FREE_GRANT_BLOCKED` | `infinite_*` refused (402 `free_grant_excluded`) even in free mode | Fail shut |
| Store receipt verification | [playBilling.ts](../supabase/functions/_shared/playBilling.ts) | `purchaseState` must be exactly `0`; pending (1) and cancelled/refunded (2) refused; package name must equal `GOOGLE_ANDROID_PACKAGE_NAME`; product must exist in the money catalog **and** in the basket | Refusal, never grant-on-trust |
| Service-role-only grants | `credits_grant`, `grant_coins`, `user_purchases` INSERT | No INSERT/UPDATE policy for `authenticated`; clients only ever read | Fail shut |
| **NEW (this prompt): single-money-item guard** | `verifyStorePurchase` | Store-mode basket may contain **exactly one** money-priced item and it must equal the Play-verified `productId` | 400 refusal |

**Conclusion: it is not possible to spend real money in the app today. Every path that could charge or grant for money answers `payments_not_available` / 503 / is dead code behind `STORE_BILLING_ENABLED = false`.**

## 2. Entitlement flow (documented, traced end-to-end)

### 2.1 Purchase path (all types)

```
ClientUI (Market / TopUpSheets / Subscription / Unlocks / StarterOffer)
  → purchaseItems(items)                    src/lib/billing.ts — the one seam
      • DEMO_MODE → local free grant, no network (clone build)
      • storeProvider (disabled — dead code path)
      • webProvider → supabase.functions.invoke("process-purchase", …)
process-purchase (edge, service role)
  1. Auth: Authorization header + auth.getUser() — 401 without both
  2. Basket validation: every product_id must resolve in a server table
     (catalog / FEATURE_PRODUCTS / special_offers); server price wins
  3. Closed-tests predicate: freeGrant = secret"free" && client flag
  4. Money verification: only if the basket contains money-priced items
  5. Idempotency pre-check: same provider_reference → 409
  6. Offers filtered by isOfferLive() window (expired promos can't grant)
  7. Deprecated products → 410
  8. Affordability pass BEFORE any row is written (machine-readable shortfall)
  9. Grant loop, per item (see §2.2); every failure → rollBackPurchase()
 10. credits_grant (shared grant, idempotency key prefers store reference)
 11. grant_infinite_credits via RPC (guard trigger bypass-proof)
 12. Basket_items cleanup; referral settle (best-effort); segment recompute
```

### 2.2 Entitlement writes per purchase type

| Type | Money? | Grant mechanism | One-time? | Verification after |
|---|---|---|---|---|
| Credit packs `pack_25…500` (+legacy) | Yes | single `credits_grant` with `store:<reference>` idempotency key; amount = base+bonus from catalog (e.g. pack_500 → 660) | No | `credit_transactions` row; `profiles.credits` |
| Coin bundles `coins_120…5000` | Yes | `grant_coins` RPC (service-role only; add_coins not user-callable) | No | `coin_transactions` |
| First-purchase bundle `coins_first` | Yes | `grant_coins`; **one-time list** ⇒ prior purchase row → 409 | **Once per account** | `user_purchases` + coins |
| Unlimited `infinite_lifetime/month/year` | Yes | `grant_infinite_credits` RPC (guard trigger, not raw UPDATE); FREE path blocked | No (but lifetime is naturally once-effect) | `profiles.infinite_credits`, `subscriptions` |
| Feature unlocks (mental_gym etc.) | No — **credits** | pre-validated affordability → `spend_credits` (user-authed, SECURITY DEFINER) via `credit_cost()` server price | Effectively (row presence = owed unlock) | `user_purchases` row with `price_cents NULL` |
| Special offers `offer_<slug>` | Yes (or 0-price) | linked pack credits + flat bonus, window-gated | Once per account | `user_purchases` |
| Basket mixes (money + credits) | Mixed | money item verified once (single-item rule now); each unlock charged individually in sequence | per-item | n/a |

### 2.3 Entitlements read path

- [SubscriptionContext](../src/contexts/SubscriptionContext.tsx): `get_my_entitlements()` RPC + `user_purchases.product_id` list.
- Server is the authority: `get_my_entitlements()` zeroes expired/cancelled rows; the client derives `isActive` via the shared `deriveEntitlementFlags` so client behaviour cannot drift.
- Feature gating: `hasFeature(f) = (unlimited && isActive) || purchases.includes(f)`; `credits_spend()` re-checks unlimited server-side per call, so a stale client flag cannot mint credits.
- Auto-refill (`apply_credit_refill`) server re-checks allowance/due-date/status — a stale client cannot create credits.

### 2.4 Failure-path guarantee (Prompt-01 fix, re-verified)

`compensatePurchase()` runs in compensating-ledger order on **every** grant failure: claw back granted credits (user-authed `spend_credits`, balance-guarded) → refund unlock charges (service-role `credits_grant`, fresh idempotency keys) → claw back coins (`spend_coins`) → **only then** delete `user_purchases` rows, releasing the retry. A thrown error mid-grant is caught by an outer safety net that compensates the same way. Ledgers are emptied after each rollback so a second failure can never double-undo.

## 3. Changes made in this prompt (one surgical fix)

### FIX-002 residual — multi-money-item basket guard

**Where:** `verifyStorePurchase` in [process-purchase/index.ts](../supabase/functions/process-purchase/index.ts).

**Before:** any basket containing the Play-verified product was accepted even if it carried additional (or duplicated) money-priced items — in `store` mode a crafted request could get `pack_50` granted off a receipt for `pack_25`. The official client can't send this (`items.length !== 1` rejected in billing.ts), but the edge function is a public endpoint. The prior code also carried a comment claiming a "48h purchase-time staleness check" that does not exist anywhere.

**After (behaviour in `PAYMENT_MODE=store` only — a path that cannot run until payments are enabled):**
1. The basket must contain **exactly one** money-priced item (`PRODUCT_PRICES[id] != null` or `offer_*`), else 400 `"Store purchases are one product at a time."` — closes both "two different packs" and "same pack twice".
2. That single money item must **equal** the Play-verified `productId` (exact match, stronger than the old `includes`).
3. The stale 48h comment was corrected — the comment no longer claims a guarantee that isn't implemented (a replay-window check is now a documented *decision for the enable checklist*, not an implied one).

**Unchanged:** credit-priced unlocks beside a paid item still work with no receipt (they're charged against the credit balance); free path unaffected; exact-match error text preserved.

**Not fixed by design here:** repeated *free* pack grants during closed testing (each retry re-grants, since packs aren't one-time) — an accepted closed-testing behaviour, worth a rate-limit before launch; listed as test case P-14.

## 4. Sandbox test plan

Run with `PAYMENT_MODE=store` **only** against a Play license-tester account, alongside a `PAYMENT_MODE=disabled` baseline suite. Never on production.

### 4.1 Disabled-mode baseline (P-01…P-06) — must pass as-is

| ID | Case | Expected |
|---|---|---|
| P-01 | Attempt every money product (packs, coins, coins_first, infinite_*) from the UI | 503 `payments_not_available`; UI shows "not available yet" (not a red "failed") |
| P-02 | Attempt money products via raw HTTP without `closed_testing` | 503, ledger untouched (`credit_transactions` empty, no `user_purchases` rows) |
| P-03 | Client flag says free, server secret unset | 503 / `free_grant_unavailable` — mismatch surfaces, nothing granted |
| P-04 | Free-grant mode (`free` + flag), normal pack | Granted, response `free: true`, receipt language "free during closed testing" |
| P-05 | Free-grant attempt on `infinite_*` | 402 `free_grant_excluded` |
| P-06 | Credit-priced unlock with and without balance | Affordable: spent + entitlement row. Unaffordable: 402 with `shortfall`, **no** `user_purchases` row (client then shows top-up sheet with the gap) |

### 4.2 Store-mode sandbox (license testers) — grant/deny matrix

| ID | Case | Expected |
|---|---|---|
| S-01 | Successful pack_25 purchase through Play Billing | Play purchaseState 0 → granted 30 credits (base+bonus), one `user_purchases` row with token as `provider_reference`, `credit_transactions` idempotency key `store:<ref>` |
| S-02 | Retry the same purchase (Play replay / client retry / network timeout retry) | 409 `duplicate: true` **or** 23505 path → rollback already posted side effects; second grant impossible |
| S-03 | Replay Alice's token as user Bob (cross-account) | Engine-level 23505 on the global `provider_reference` index → compensation rollback → 409 |
| S-04 | Cheap token replayed as expensive product (pack_25 receipt → request pack_500) | Exact-match failure: 400 "does not match the requested product" |
| **S-05** | **NEW guard:** basket `[pack_25, pack_50]` + valid pack_25 receipt | 400 "one product at a time" — the fix above |
| **S-06** | **NEW guard:** basket `[pack_25, pack_25]` + valid receipt | 400 — duplicate money item |
| S-07 | Money pack + credit unlock in one basket (`[pack_25, mental_gym]`) with sufficient credits | Both proceed: pack verified+granted; unlock charged via `spend_credits`; unlock failure rolls back the pack too (grant-loop compensation) |
| S-08 | Pending purchase (purchaseState 1) | Refused, clear message, nothing granted |
| S-09 | Cancelled/refunded purchase (2) | Refused; `reversed` honoured |
| S-10 | Receipt with wrong packageName | Receipt-package check fails |
| S-11 | Receipt productId not in money catalog (`res_json`) | "not a Vaylo Sports product" refusal |
| S-12 | Grant failure mid-basket (simulate `credits_grant` error / unlimited RPC failure) | Full compensation: granted credits clawed back, unlock charges refunded, coins clawed back, `user_purchases` rows removed, retry unblocked |
| S-13 | Coin grants: bundles and **first bundle** | Correct amounts incl. bonus (330/920/2500/7500/700); first bundle second attempt → 409 one-time |
| S-14 | Unlimited purchase → `profiles.infinite_credits` set via trigger; then `credits_spend` writes amount=0 transactions | Entitlement visible in `get_my_entitlements`; metered video path still charged (unlimited does NOT bypass `credits_spend_metered`) |
| S-15 | Offers: double_credits multiplier while live, then after `ends_at` | Live: bonus applied. Expired: offer filtered, `offer_<slug>` → 400 unknown offer |
| S-16 | Deprecated product ids in basket | 410 refusal |
| S-17 | Refund scenario (Play console refund after grant) | Ledger intact; entitlement remains until a deliberate reversal job — **documented gap**, no auto-reconciler (UX/finance decision, note for launch) |

### 4.3 Idempotency verification checklist

- [ ] `credit_transactions(user_id, idempotency_key)` unique (partial, NOT NULL) — retry of any spend returns `duplicate=true` and does not double-charge.
- [ ] `user_purchases_provider_reference_global_uniq` (global, WHERE NOT NULL) — cross-account replay verified in S-03.
- [ ] Refund idempotency: AI-feature failure refunds use fresh keys (`refund:<uuid>`), verified in the coach-chat/generate-plan suites — one refund per failed attempt.
- [ ] `credits_spend_metered` service-role-only; unlimited plans NOT exempt (video analysis charged for everyone).

### 4.4 Payment-enable Go decision (checklist to flip anything ON)

- [ ] All P-01…P-06 and S-01…S-17 pass on a sandbox deployment.
- [ ] `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_ANDROID_PACKAGE_NAME` set; 401/403 from Play API surfaces a human-readable config error.
- [ ] Decide on the replay window (purchaseTime staleness): implement or record the accepted risk.
- [ ] Closed-testing free-grant repeat-mint rate limit (P-14) decided.
- [ ] Refund/reversal reconciliation path exists (S-17).
- [ ] `STORE_BILLING_ENABLED` flipped together with `PAYMENT_MODE=store` — and the client/server switches are re-verified to agree (P-03 direction).

## 5. Readiness assessment

**Now: NOT ready to enable.** Payments remain disabled at every layer (client `const false`, server default `disabled` — both verified unflippable by accident). Correctness state:

- Undo/rollback guarantee (Prompt-01's critical bug class): **implemented and verified** in source, including the thrown-error safety net.
- Single-receipt/single-product integrity: **made structural with this prompt's guard**, exercised by S-05/S-06 once store mode is ever turned on.
- Credit economy (AI features): production-ready design with monitoring recommendations unchanged from the earlier audit.
- Remaining before enable: run §4.2 matrix, decide replay-window policy, rate-limit free-grant repeats, and stand up reversal reconciliation.
