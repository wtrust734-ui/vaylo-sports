# Backend changes — applied

Written during the September audit/hardening pass.

> **STATUS: APPLIED to `vvwhausdjzdmsyxekrcl` on 2026-09-21** via
> `supabase db push --linked` (all 8 migrations, in this order, no errors), and
> the four changed edge functions were redeployed with
> `supabase functions deploy … --use-api` (now at VERSION 2).
>
> Also applied since: **auth URLs** pushed from `supabase/config.toml` with
> `supabase config push` (`site_url` was the dead `localhost:3000`, now
> `localhost:8080`; redirect allow-list set for the dev ports; the 11 other
> hosted auth/storage settings were left untouched), and the secret
> **`PAYMENT_MODE=test`** (`supabase secrets list` confirms it).
>
> Live verification after apply: `public.coins_per_credit()` returns **7.5**;
> `viewer_is_adult()` and `sponsored_placements()` return `permission denied`
> to an unauthenticated caller; `add_credits` / `credits_grant` do not appear in
> Supabase's "anon can execute SECURITY DEFINER function" advisory, confirming
> the minting paths are revoked.
>
> End-to-end check with two confirmed test athletes (since deleted; every user
> table is back to 0 rows): `handle_new_user()` seeded a profile with 20 starter
> credits, 100 coins and a `credit_transactions` row; sign-in returned a session;
> RLS showed an athlete only their own `profiles` row and refused a cross-user
> update; and the 18+ gate returned `[]` / `false` for a non-adult while an adult
> with a 1990 date of birth received the seeded sponsor with its disclosure label.
>
> See `CUTOVER.md` for the full runbook. Still outstanding: the AI provider keys,
> the production auth URL, the Google/Apple OAuth credentials, and publishing the
> frontend (`dist/`, with the SPA fallback in `public/_redirects`).

## Bugs found and fixed by the end-to-end verification (2026-09-21)

Both were found by calling the *deployed* functions as a real signed-in athlete,
and neither was visible to `tsc`, to lint or to the app build. Both are fixed and
re-deployed (`process-purchase` at VERSION 3).

**1. `process-purchase` could not run at all — every checkout returned
`{"code":"WORKER_ERROR"}`.** The generated mirror
`supabase/functions/_shared/moneyCatalog.ts` ended with
`export const ONE_TIME_PRODUCTS: string[] = [FIRST_PURCHASE.id];`, but that const
is emitted as `FIRST_PURCHASE_BUNDLE`. An undefined identifier at module scope is
a `ReferenceError` while the module is being evaluated, so the edge worker died
before the handler ran — which is why *every* request failed identically,
including an empty basket, and why only this function was affected: it is the only
one that imports the mirror.

The fix belongs in the generator, not the generated file:
`scripts/gen-money-mirror.cjs` was emitting its own internal variable name into
the TypeScript it writes. Corrected to `FIRST_PURCHASE_BUNDLE.id` and regenerated
(diff: one line; `MONEY.md` unchanged; all money invariants still pass).

`src/lib/moneyMirror.test.ts` now imports the mirror and asserts its structural
invariants, so this class of error fails `npm test` instead of reaching
production. That matters because **`supabase/functions/**` is covered by no
tsconfig in this repo** — the Deno code is invisible to `tsc --noEmit`.

**2. A completed purchase was reported to the athlete as a failure.**
`process-purchase` finished with
`await supabase.rpc("recompute_user_segment", …).catch(() => {})`. A PostgREST
builder is thenable but has no `.catch`, so that threw a `TypeError` — *after*
the credits were granted and the purchase recorded. The ledger proved it: the
row `Pack purchase: 25` existed while the caller received a 500. Now wrapped in
`try/catch` that logs and continues, because a best-effort segment recompute must
never turn a granted purchase into an error.

### Checkout, verified live after the fixes

| Request | Result |
|---|---|
| `pack_25` | `success: true, credits_added: 25` |
| `coins_300` | `success: true, coins_added: 330` (300 + 30 bonus) |
| `coins_first` | `success: true, coins_added: 700` |
| `coins_first` again | **409** "The one-time first-purchase offer has already been used." |
| unknown product id | 400 `Unknown product: …` |
| empty basket | 400 `Empty basket` |

Balances and the ledger matched exactly (20 starter + 25 = 45 credits;
100 + 330 + 700 = 1,130 coins), and the test accounts were removed through the
app's own `delete-account` function. See "Known gap" below before reading that as
"payments work" — nothing is actually charged yet.

## Type checking the edge functions — `npm run typecheck:functions` (new)

`supabase/functions/**` was covered by no tsconfig, which is precisely why the
boot-crash bug below could be deployed at all. There are now three projects:

| Command | Covers |
|---|---|
| `npm run typecheck:app` | `tsconfig.app.json` + `tsconfig.node.json` (as before) |
| `npm run typecheck:functions` | `tsconfig.functions.json` — the Deno functions |
| `npm run typecheck` | all three |

`tsconfig.functions.json` needs no Deno installed. `types/edge-runtime.d.ts`
declares only the runtime surface the functions actually use (`Deno.env.get`,
`Deno.serve`, and the one `deno.land/std` import), and the
`https://esm.sh/@supabase/supabase-js*` plus `npm:@supabase/supabase-js@2/cors`
specifiers are mapped to the installed client, so `.from()` and `.rpc()` are
checked against real types rather than collapsing to `any`. Where Deno is
available, `deno check` is stronger; this is the zero-dependency guard.

It now reports **zero errors**, after three **type-only** corrections (none change
runtime behaviour, so none required a redeploy):

- `_shared/aiModels.ts` — `ModelName` was `(typeof MODELS)[keyof typeof MODELS]`,
  which counted the nested `CHAT` *object* as a union member, so the type was not
  assignable to `string`. It is now the union of leaf string values, which also
  makes passing the `CHAT` object where a model id belongs a compile error instead
  of sending `[object Object]` to the AI provider.
- `process-purchase` — basket items arriving as `unknown[]` meant `item.product_id`
  was an unresolved access; the two permitted fields are now declared once
  (`BasketItem`) while remaining untrusted and re-derived from the server tables.
- `process-purchase` — `!verification.verified` does not narrow that union under
  these compiler options; the explicit `=== false` comparison does.

Both guards were verified by re-introducing the original defect: the checker
reports `TS2304: Cannot find name 'FIRST_PURCHASE'` and `moneyMirror.test.ts`
fails with the same `ReferenceError` the edge worker hit. Run `npm run typecheck`
before deploying functions.

`npm run lint` still reports pre-existing `no-explicit-any` errors in the functions
(`rpc("…" as any)`, `(o: any)` casts around untyped RPC names); those predate this
work and were deliberately left alone.

## Migrations, in order applied

| # | Migration | What it does |
|---|-----------|--------------|
| 1 | `20260921090000_security_and_integrity_fixes.sql` | Locks down the credit/points RPCs, drops the `points_events` self-insert policy, adds `find_user_by_friend_code` |
| 2 | `20260921090100_local_day_streaks.sql` | `touch_streak(p_date)` — streaks counted on the athlete's local day, clamped to ±1 day |
| 3 | `20260921090200_avatar_catalog_server_prices.sql` | New `avatar_catalog` table with server-side cosmetic prices (generated) |
| 4 | `20260921090300_coin_economy_hardening.sql` | Guards `profiles.coins`, makes `add_coins` service-only, adds `grant_coins`, buys cosmetics at server prices, stops client `avatar_items` writes |
| 5 | `20260921090400_coin_rate_7_5.sql` | **1 credit = 7.5 coins** (was 1.25), now stored in `economy_config.coins_per_credit` so it's admin-tunable |
| 6 | `20260921090500_profile_cosmetics.sql` | Profile cosmetics go on sale for Coins (`reward_definitions.coin_cost`), adds `purchase_cosmetic` / `equip_cosmetic` / `unequip_cosmetic`, and stops clients writing ownership/equipped state directly |
| 7 | `20260921090600_iap_readiness.sql` | `user_purchases.provider_reference` + `platform`, with a unique index so a retried store transaction can never grant twice |
| 8 | `20260921090700_sponsored_age_gate.sql` | Brand/sponsorship tables plus a **server-enforced 18+ gate** for sponsored content (`viewer_is_adult()`, `sponsored_placements()`, `record_brand_event()`); sponsored challenges hidden from under-18s. See `SPONSORSHIP.md` |

Order matters: migration 4 replaces functions that read `avatar_catalog`, and
migration 1 adds the `find_user_by_friend_code` RPC the current client calls.

Migration 8 replaces the `challenges` SELECT policy (`Anyone can view
challenges` → `View challenges (sponsored only for adults)`). Ordinary
challenges are unaffected; only rows with a `sponsor_brand_id` are hidden from
athletes without an adult date of birth. Onboarding now collects a date of
birth, and existing athletes have none — which means they see no sponsored
content until they add it, which is the intended safe default.

## Redeploy these edge functions

```
supabase functions deploy coach-chat weekly-review learning-recommend process-purchase
```

- `coach-chat`, `weekly-review` — refund the 3 credits when the AI call fails
- `learning-recommend` — now requires a verified user
- `process-purchase` — validates the basket, records server prices, one
  redemption per offer, grants coins through `grant_coins`

## Money model (solved)

The coin ladder was re-anchored to the 7.5 coins/credit rate so both ways of
getting coins are coherent — see **`MONEY.md`** (generated):

| Path | $/coin |
|------|--------|
| Best credit pack ($0.0385/credit) converted at 7.5:1 | 0.00513 |
| Biggest coin bundle (7,500 coins, $37.49) | 0.00500 |
| Smallest coin bundle (convenience) | 0.02492 |
| One-time first-purchase bundle | 0.00284 |

Buying coins for cash is now the best coin value; converting credits stays the
instant option; small bundles are a convenience premium.

### Generated artifacts — re-run after changing any price config

```
node scripts/gen-money-mirror.cjs        # prices → edge mirror + MONEY.md (asserts the invariants)
node scripts/gen-avatar-catalog-sql.cjs  # avatar prices → SQL
```

`gen-money-mirror.cjs` **fails the run** if the economy stops making sense
(bundle value not improving with size, cash coins no longer beating conversion,
etc.), and `src/lib/topUp.test.ts` re-checks the same rules in CI.

## Payments: nothing to add on web (Capacitor-ready)

No billing provider is wired up on purpose — the app is moving to Capacitor, so
the store will provide billing. The client calls `purchaseItems()`
(`src/lib/billing.ts`), which uses the web provider today and is the single place
to switch to store billing later.

Server side, `process-purchase` is **verify → validate basket → grant**, with the
store check isolated in `verifyStorePurchase()`:

- `PAYMENT_MODE=test` (default) — current behaviour; everything works.
- `PAYMENT_MODE=store` — requires a store transaction id + receipt and, until the
  verifier is implemented, **refuses** rather than granting on trust.
- Replay safety: `user_purchases.provider_reference` has a unique index, and the
  credit grant uses the store reference as its idempotency key.

Full conversion runbook, plugin list and store-review checklist: **`CAPACITOR.md`**.

## After applying migration 6

Regenerate the Supabase types so `reward_definitions.coin_cost` exists in the
client types (`supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`).
It has already been added by hand so the app compiles in the meantime.

Profile cosmetics are priced by rarity at 150 / 400 / 900 / 2,400 / 4,800 Coins.
Badges are deliberately **not** for sale — they stay chest/challenge rewards.

## Regenerating the cosmetic price table

`20260921090200_*` is generated from `src/lib/avatarCatalog.ts`. After changing
the catalog:

```
node scripts/gen-avatar-catalog-sql.cjs
```

## Known gap (needs a product decision, not a code fix)

`process-purchase` records a purchase and grants credits/coins **without
verifying any payment** — there is no Stripe/RevenueCat/StoreKit integration in
the repository. The basket is now validated and priced server-side, but a
logged-in user can still call the function and receive credits for free. Real
verification needs a billing provider.
