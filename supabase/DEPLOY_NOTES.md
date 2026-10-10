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
| 9 | `20260922090000_entitlement_and_referral_fixes.sql` | **Applied 2026-09-22.** Drops the client `INSERT` on `user_purchases` (entitlements were forgeable) and makes `redeem_referral()` actually pay the configured credits to both sides |

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
  redemption per offer, grants coins through `grant_coins`, checks that a
  credit-priced unlock is affordable **before** writing its entitlement row, and
  rolls that row back if the grant fails (§"Audit round, 2026-09-22")

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

---

## Audit round, 2026-09-22 — what was broken and what changed

A full read-through of the app, cross-checked against the live schema. Four
defects were real; the rest of the surface held up.

### 1. The entire social layer could not resolve another athlete's name
`profiles` is protected by self-only RLS (`auth.uid() = user_id`). Leaderboard,
Feed, Friends, Communities, ChallengeDetail and PublicProfile all selected
`profiles.full_name` for *other* users, so every name fell back to "Athlete" —
or, on PublicProfile, never resolved at all. `avatars` is the table the schema
deliberately makes readable to every athlete and it carries `display_name`, so
all cross-user naming now goes through the new `src/lib/publicIdentity.ts`.
Nothing new is exposed: it reads a column already granted to every signed-in
user, and no private column (`date_of_birth`, `credits`, `coins`, `weight_kg`,
`sex`) is touched.

### 2. Two pages queried columns that do not exist
PostgREST rejects the whole request, so:
- `Workouts.tsx` selected `user_settings.ar_overlay_name` → the athlete's saved
  AR metrics never loaded.
- `Leaderboard.tsx` selected `profiles.region` / `profiles.city` → the request
  400'd. Its "Regional" scope was removed too: the only country a client may
  read belongs to the signed-in user, so that tab could never match a row.
  Reinstating geo rankings needs a publicly readable country column plus the
  athlete's consent — a product decision, recorded in the audit report.

`scripts/audit-columns.cjs` cross-references column references in `src/` against
the live schema; run it after any schema change.

### 3. Paid entitlements were forgeable — and one was granted without paying
`user_purchases` granted `INSERT` to `authenticated`, and `Injury.tsx` was the
only client that used it: it spent the credits, then inserted the entitlement
and **ignored the insert result**, reporting "unlocked" even when nothing was
recorded. Any signed-in athlete could insert any product id and unlock a paid
feature for free. Two fixes:
- The page now goes through `process-purchase`, like every other purchase.
- Migration 9 drops the client insert; entitlements are written by the service
  role only.

Separately, `process-purchase` wrote the entitlement row **before** checking the
balance, so a refused 402 unlock still left its row behind — and since the apps
treat "a row exists" as proof of purchase, an athlete who could not afford the
unlock got it on the next load. A live test caught this (a 20-credit account was
refused at 29 credits, then showed two `injury_management` rows). The
affordability check now runs before anything is written, in the validation pass,
and the insert's failure paths roll the row back. `src/lib/purchaseSequence.test.ts`
asserts that ordering so it cannot silently regress.

### 4. Referral rewards were never paid
The share links (`/auth?ref=CODE`) were dead — nothing in the app read the `ref`
parameter. `redeem_referral()` recorded attribution as `status = 'granted'` with
`reward_granted_at = now()` but granted nothing, and the UI advertised "14 days
of Pro" and "3 credits per friend" — neither of which existed. Now:
- `redeem_referral()` pays both sides from `economy_config.promo_bonuses`
  through the shared `credits_grant`, with idempotency keys derived from the
  referee id (`referrals.referee_id` is UNIQUE, so one payout per athlete).
- `Auth.tsx` parks the `ref` code from the URL and redeems it once a session
  exists, so invite links work end to end.
- `Referrals.tsx` and `Friends.tsx` state the real credit amounts. The duplicate
  "Refer & Earn" card in Friends (which invented its own numbers and shared the
  *friend* code as a referral link) is now a link to the Referrals page.

### Verified live (not just typechecked)
8/8 checks on two disposable accounts: client insert into `user_purchases` →
**403**; `redeem_referral` → referee +10, referrer +15; replay → refused;
balances exactly right. 7/7 on the unlock path: unaffordable → **402** with no
credits taken and **no entitlement row**, `pack_25` → +25, unlock → exactly the
29-credit database price, entitlement recorded once. Both accounts removed
through the app's own `delete-account`.

Also removed: `src/components/_archive/` (11 files, zero imports anywhere — it
shadowed real components like `ui/toast.tsx`). Recoverable from git.

### Closed since (see "Geo, sharing and deletion" below)
- ~~**Feed shows only your own activity.**~~ Replaced by explicit per-activity
  sharing — friends' private training is no longer read by anything.
- ~~**Geo leaderboards** (country / continent) need a public country column.~~
  Country is now collected at signup and the boards exist.

### Still open (needs you, not code)
- **The creator store is paused.** Its sidebar entry (`/marketplace`) is gone, so
  "You" now shows one store surface (`/market`) instead of two overlapping ones.
  The route and the pages are untouched — restore the one nav line to bring it back.
- Several disposable test accounts left **anonymous** `account_deletion_events`
  audit rows. That is the app's intended post-deletion trace (no personal data);
  clearing them needs SQL access, which this environment does not have.

## Geo, sharing and deletion — 2026-09-22 (later)

Three product changes, each needing schema work. Migrations
`20260922091000_geo_scopes_and_activity_sharing.sql` and
`20260922092000_user_region_public_read.sql`, both applied.

### Country rankings (world / continental / country)
`user_region` already existed for exactly this — `country` + `currency` per
athlete — but nothing had ever written to it, and its only policy was self-only,
which is why the geo scope had to be removed earlier. Now:

- Country is collected as its own onboarding step (searchable picker, ~210
  countries) and is editable in Profile → Settings.
- `user_region` is publicly readable, so a leaderboard can resolve every ranked
  athlete's country. Continent comes from the UN M49 mapping in `src/lib/geo.ts`
  — an objective standard, so no athlete's board placement is a judgement call.
  (Türkiye, Israel, Cyprus, Georgia, Armenia and Azerbaijan are Western Asia;
  Russia is Eastern Europe.)
- A `^[A-Z]{2}$` CHECK constraint rejects a malformed country at the database,
  and an unrecognised value resolves to `null` rather than a guessed default —
  a wrong guess would silently file an athlete on the wrong board.

**The first attempt was wrong and is documented here on purpose.** It narrowed
the SELECT grant to `(user_id, country)` to keep `currency` private. Live testing
showed that breaks ordinary writes: PostgREST implements `upsert()` as
`INSERT ... ON CONFLICT DO UPDATE`, and Postgres needs SELECT on every column the
`DO UPDATE` set list reads — so saving your own country failed with *permission
denied for table user_region*. The narrowing is reverted in the second migration.
The privacy argument was weak anyway: `country` must be public for these boards,
and `currency` is derived from it through the public `country_pricing_map`.

### Activity sharing replaces reading friends' private training
The feed aggregated `workouts`, `achievements` and `outcome_goals` across a
friendship graph. All three are self-read-only under RLS, so it only ever showed
the signed-in athlete their own rows — and relaxing RLS would have exposed every
athlete's training and health data. Now:

- `shared_activities` holds exactly the rows an athlete chose to publish, with a
  partial unique index making re-sharing the same workout idempotent.
- **Nothing reads friends' private training any more.** The friendship-based
  aggregation is gone from the feed entirely.
- Share buttons live on completed workouts and on each feed item, and the button
  reports the real result of the write before the UI changes.
- `activity_hypes` makes hype counts real. They were previously stored in
  `localStorage`, so every athlete saw their own numbers and a shared post's
  "Hype · 3" meant nothing. A trigger now also refuses self-hype, so a count
  presented as social proof can't be inflated by its own author.

### Account deletion: it did not delete everything
Two defects, both invisible at runtime:

1. **Tables missing from the delete list.** `event_pack_ownership`,
   `fair_usage_events` and `learning_feedback` were never deleted — rows that
   would have survived account deletion permanently.
2. **Deletes aimed at columns that do not exist.** `challenges` and
   `marketplace_listings` are keyed by `creator_id` (not `user_id`) and
   `team_assignments` by `assigned_to`/`assigned_by`. Those deletes errored, the
   error was logged and ignored, and the function still answered
   `success: true`.

The registry is now built by cross-referencing every table in the schema for a
user-identifying column (79 tables), dependent rows of owned containers
(team/community/challenge/group) are removed by container id first, failures are
collected instead of swallowed, and after the identity is gone the function
**counts every table again** and returns HTTP 500 with the residuals rather than
claiming success. `src/lib/accountDeletionCoverage.test.ts` fails the build if a
user-keyed table is added without being handled, or if the registry names a
column that doesn't exist.

### Verified live, on the real project
- **25/25** checks with two disposable accounts: country writes; B reads A's
  country but **not** A's private workouts; sharing; re-share rejected as a
  duplicate (23505); spoofed shares and spoofed hypes refused (42501); self-hype
  refused by the trigger; real shared hype count.
- **Deletion, aimed at the old gaps:** 7 rows planted in the exact places the old
  registry missed (`learning_feedback`, `event_pack_ownership`, `challenges`,
  `marketplace_listings`, `team_assignments` ×2, `shared_activities`) → deletion
  returned `verified: true`, 79 tables checked, **zero residuals, zero failures**.
  `fair_usage_events` is service-role-only, so a row can't be planted from a
  client; it is in the registry and is counted by the verification pass.
- The guard test was itself tested: removing an entry, or renaming a column to one
  that doesn't exist, makes it fail with the exact table named.

## Audit round, 2026-09-27 — what was broken and what changed

Migrations `20260927150000` … `20260927190000`, all applied. Every claim below
was checked against the live project; the checks are quoted so they can be
re-run.

### 1. No subscription could ever be bought, and the free trial never worked

The headline defect, and it was invisible from the app — the button just failed.
`subscriptions.plan_type` still carried its legacy CHECK:

```
CHECK (plan_type = ANY (ARRAY['free','minimum','pro','elite']))
```

but both writers had moved on. `activate_subscription()` sets
`plan_type = subscription_plans.plan_key`, whose live values are `credit` and
`unlimited`; `grant_unlimited_trial()` wrote `trial`. Every insert raised
`23514 ... violates check constraint "subscriptions_plan_type_check"`. That is
why all three rows in the table read `free`/`free`/`provider='none'` — nothing had
ever completed a write.

Found by simulating a purchase inside a rolled-back transaction rather than by
reading the code. The constraint now matches the client's `PlanKey` union
(`free | credit | unlimited`, legacy values kept so old rows still validate), and
the trial writes `plan_type = 'unlimited'` to mirror `plan_key` exactly as
`activate_subscription` does.

Live proof, one transaction, rolled back:

```
activate_subscription   {"ok":true,"plan_key":"unlimited","expires_at":"…+1 month"}
entitlements            plan=unlimited status=active unlimited=true
cancel                  {"ok":true,"access_until":"…","cancel_at_period_end":true}
status after cancel     active          ← the paid period survives cancellation
unlimited after period  false status=expired
```

`subscriptions_user_id_key` (the `UNIQUE (user_id)` that `ON CONFLICT` needs) does
exist, so the constraint was the only obstacle.

### 2. Cancelling revoked time the user had already paid for

`cancel_my_subscription()` set `status = 'cancelled'` immediately and *then*
returned `access_until = expires_at`. Since `has_unlimited_credits()` requires a
live status, access died at once while the response claimed otherwise. It now
keeps the live status and sets `cancel_at_period_end`, revoking immediately only
when there is no future `expires_at` to honour.

### 3. The 7-day Unlimited trial never expired, and repeated

`grant_unlimited_trial` was the **only** object in the entire schema that
mentioned `trial_ends_at`; nothing read it. It also never set `expires_at`, so the
generic expiry path (which only inspects `active` rows) could not catch it, and
the client treats `status = 'trial'` as live. One tap bought unlimited credits
permanently. The `trial_already_used` branch was unreachable too — the preceding
`status <> 'free'` check returned first — so the one-trial-per-account guarantee
its comment advertised was not enforced.

Trials now set both `trial_ends_at` and `expires_at`, are refused once
`trial_ends_at` is non-null, and `has_unlimited_credits()` /
`get_my_entitlements()` both expire them:

```
trial #1   {"ok":true,"days":7}
trial #2   {"ok":false,"error":"trial_already_used"}
trial ended: unlimited=false  status=expired
```

`has_unlimited_credits()` also had a second, quieter problem: it accepted
`trialing`/`renewing` (which nothing writes) and not `trial` (which the trial
writes), so a trial user was shown Unlimited by `get_my_entitlements()` while the
server charged credits. Both lists are now aligned.

### 4. Event Packs were free, and the server had no price to check

`EventPacks.tsx` `checkout()` looped `claimEventPack(p)` over the basket with no
payment step, and `claim_event_pack` — `SECURITY DEFINER`, executable by `anon` —
stored `p_price_cents` straight from the caller and granted ownership
unconditionally. `select count(*) from event_packs` returned **0**, so there was
nothing server-side to validate against; the packs in
`src/config/eventPacks.ts` are genuinely priced ($12.99–$59.99).

The catalog is now seeded (648 rows) by `scripts/gen-event-packs-sql.cjs`
(`npm run gen:packs`, generated from the client list so it cannot drift), and the
function reads identity *and* price from it, ignoring the wire arguments while
keeping the signature so deployed clients do not break. A priced pack requires a
verified `user_purchases` row — the only writer of which is `process-purchase`:

```
claim_event_pack('ep_1')  →  Purchase required for this event pack
```

**Product consequence, deliberate:** Event Packs are now unbuyable until Play
Billing is wired to that screen. The screen says so plainly ("Pack purchases
aren't live yet — nothing has been charged") rather than reporting a declined
card. Selling them needs the Play service-account secrets, which are still unset.

### 5. 24 SECURITY DEFINER functions were reachable without signing in

Every one carried the default PUBLIC grant (`=X/postgres`) that `create function`
applies and nothing had revoked. Most are guarded by `auth.uid()`, but
`is_group_member` / `is_community_member` / `is_team_member` take an arbitrary
user id and answer about *other* people, and `has_role(_user_id, _role)` is a
straight admin-membership oracle for any uuid. Two admin policies were scoped to
`public` — that is what forced `has_role` open — so they were narrowed to
`authenticated` (their public read policies are untouched) and the grant removed.

Anon-executable definer functions: **21 → 1**. The survivor is `top_referrers`,
which the public `/referral-leaderboard` route genuinely needs. The seven trigger
helpers lost their grants entirely, which changes nothing: trigger invocation does
not consult EXECUTE.

Two self-service RPCs were closed at the same time. `award_points(p_points, …)`
let the caller name its own score (500 per call, 2500 per 24h) into
`points_events`, which is exactly what the leaderboard ranks on;
`award_activity_points()` is the same shape. Neither has a live caller —
`award_activity_points` appears nowhere at all, and the `awardPoints` wrapper in
`src/lib/scoring.ts` is exported but never invoked — so both now require the
service role. Granting them back is one line, and it should be done as part of
moving scoring server-side, because the amount has to be decided there for the
number to mean anything.

### 6. Performance and integrity cleanups

- **147 RLS policies** were re-evaluating `auth.uid()` per row;
  `20260927190000` rewrote them to `(select auth.uid())`, which Postgres hoists
  into an InitPlan. Written as a catalogue walk, and idempotent by construction
  (it unwraps before it re-wraps, so re-running cannot nest selects). Enforcement
  was re-proved afterwards: as user B, `own=1 other=0 total_visible=1` on
  `profiles`. Advisors: `auth_rls_initplan` **147 → 0**.
- **22 foreign keys had no covering index.** All added; the
  `unindexed_foreign_keys` advisor is now clear. (This raises the
  `unused_index` count, because brand-new indexes on a table nobody has written
to have obviously never been used. That lint is noise at this traffic level and
  should not be "fixed" by dropping them.)
- **`tg_health_connections_touch`** was the only function without a pinned
  `search_path`; it now sets `public`.
- **`hasEntitlement()` in `_shared/guard.ts`** treated `unlimited_credits = true`
  as proof of payment and ignored `expires_at`. Since `cancel_my_subscription()`
  leaves that flag set and nothing rewrites an `active` row when it lapses, a
  cancelled or expired plan kept unlocking paid features. It now checks status
  **and** `expires_at`, matching `has_unlimited_credits()`.
- **Android backup was shipping the session off-device.** The WebView persists
  the Supabase refresh token in app-private storage, and the manifest default
  (`allowBackup="true"`, no extraction rules) uploads that to Google Drive. Now
  `allowBackup="false"` plus `data_extraction_rules.xml` (Android 12+, which is
  what covers device-to-device transfer) and `full_backup_content.xml` (API ≤30).
  Verified in the built APK with `aapt2 dump xmltree`.

### 7. Configuration and documentation that had drifted

- `verify_jwt = false` for `og-image` and `link-preview` existed **only in a code
  comment**, so a plain `supabase functions deploy` would have 401'd every shared
  link. Both are now declared in `config.toml`.
- `capacitor.config.ts` still claimed the app was "a pure web app", that nothing
  imported Capacitor and that `@capacitor/cli` was not a dependency. All three
  were false; the header now describes the shell that actually ships.
- `index.html` carried two stale `TODO`s (one asking to set a title that was
  already set) and shipped "An app for winners" as its description in every
  og/twitter tag. Replaced with a factual description.
- `nativeOAuth.ts` pointed at a "capacitor.config deepLink section" that does not
  exist; the comment now names where the scheme must actually be declared.

### Still open after this round (needs you, not code)
- **`OPENAI_API_KEY`** — every AI function returns
  `AI service is not configured` (500). Unchanged by this round.
- **Play Billing secrets** (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`,
  `GOOGLE_ANDROID_PACKAGE_NAME`, `PAYMENT_MODE=store`) — without them
  `verifyPlayPurchase` cannot confirm anything, so Event Packs stay unbuyable.
- **Release keystore** — the `.aab` is debug-signed and not Play-uploadable,
  and `release` still builds with `minifyEnabled false`.
- **No `@capacitor/*` plugin package is installed.** `node_modules/@capacitor`
  holds only `android`, `cli` and `core`, and `android/app/capacitor.build.gradle`
  has an empty `dependencies {}` block — so no official plugin's native code is in
  the APK. `loadPlugin()` swallows the failure and falls back to web behaviour,
  which means: the hardware back button never reaches `NativeBackButton`;
  **`awaitOAuthDeepLink` waits out its full 5-minute timeout and rejects** because
  neither `@capacitor/app` nor `@capacitor/browser` exists, so native social
  sign-in cannot complete; and the `SplashScreen` / `StatusBar` / `Keyboard`
  blocks in `capacitor.config.ts` configure plugins that are not there. Also note
  `loadPlugin("in-app-purchases")` builds the specifier
  `@capacitor/in-app-purchases`, which is not a published package. Fixing this
  means adding the plugin dependencies, `npx cap sync android`, and rebuilding the
  APK — a dependency decision, so it is called out rather than made silently.
- **Auth URLs still point at localhost.** `site_url = "http://localhost:8080"` and
  the redirect allow-list is dev-only, so password-reset mail links to a machine
  no user has. `vaylosports.com` does not resolve yet, so the real domain could
  not be filled in; the native origins (`com.vaylosports.app://auth-callback`,
  `https://localhost`, `capacitor://localhost`) have been added so at least the
  app's own OAuth callback is permitted.
- **Email confirmation is off** (`[auth.email] enable_confirmations = false`,
  documented in `config.toml`) — anyone can register an address they do not own.
  Turning it on needs SMTP first, or sign-up breaks on the built-in mail rate
  limit.
- **Leaked-password protection is disabled** in Auth settings.
- **`brands`, `brand_placements`, `brand_metrics`** have RLS enabled and zero
  policies. That is deny-all by design — sponsored content is served through the
  `sponsored_placements()` definer RPC — not a leak.
- **34 → 24 `multiple_permissive_policies`** remain (the reward tables' duplicates
  were resolved by the policy-role narrowing). Merging the rest changes
  authorisation semantics for no measurable gain at this traffic level, so they
  are left alone deliberately.

---

## Scheduled launch emails — 2026-10-04

Added `20261004170000_waitlist_campaigns.sql` and the `waitlist-campaigns`
edge function. The waiting list now sends itself a dated sequence: countdowns on
2 December 2026, 25 December 2026 and 31 December 2026, and the launch email on
1 January 2027 (all 08:00 UTC — an hour before the 09:00 daily job, so each is
already due when the job runs rather than landing on the same timestamp).

### One manual step is required, and it is not in the migration

The `pg_cron` job reaches the function through `pg_net` and authenticates with a
shared secret, not a JWT. That secret has to exist in two places — the function's
environment and Supabase Vault — and a migration cannot hold it without
committing it. Run once:

```
sh scripts/set-waitlist-cron-secret.sh
```

It generates a random value, sets `WAITLIST_CRON_SECRET` as a function secret,
and stores the same value in Vault as `waitlist_cron_secret` (which
`public.waitlist_trigger_campaigns()` reads at fire time). It is idempotent, so
re-running it rotates the secret. Until it is run, the daily job logs a warning
and sends nothing.

### Applied state

- Migration pushed to `vvwhausdjzdmsyxekrcl` (extensions `pg_cron` + `pg_net`,
  two campaign tables, five RPCs, the trigger, and the daily job
  `waitlist-campaigns-daily` at `0 9 * * *`, confirmed in `cron.job`).
- `waitlist-campaigns` deployed with `verify_jwt = false` (per `config.toml`),
  gated on the `x-cron-secret` header.
- `waitlist-signup` redeployed so the confirmation email carries the launch date
  (it previously said there was no release date).

### Verified live

- No secret / wrong secret → **403**; GET → **405**.
- Real trigger through `net.http_post` → **200** (`net._http_response`), which
  proves the Vault secret matches the function's; nothing was due, correctly.
- Recipient RPC, claim/mark/release RPCs driven directly: a second claim returns
  `false`; a `sent` row is never reclaimable.
- End-to-end send with the first countdown temporarily dated to now: real message
  accepted by Gmail, ledger row written `sent`, campaign marked `done`,
  `last_emailed_at` set. The date was then reverted and the test state cleared.

### Product note before 1 January 2027

- **The launch email links the Play listing only if `PLAY_STORE_URL` is set.**
  Set it (a `https://play.google.com/...` URL) once the listing is published, or
  the launch message points at the site instead and says the link is not
  published yet.
- **Nothing here checks that the app is actually live.** The launch email asserts
  it is. If the date slips, move `LAUNCH_AT` (and the countdown dates) in the
  function's `campaigns()` before the day; a countdown that is more than a few
  days late is skipped automatically, but the launch email is never skipped.
- The site copy, the waiting-list terms and the confirmation email were updated
  in the same change so none of them still claims there is no release date.

---

## Marketing site hosting — Vercel is live, Netlify is blocked (2026-10-04)

- **Live:** https://vaylo-site-6c1b6bc7.vercel.app — Vercel project
  `vaylo-site-6c1b6bc7`, scope `virello1`, serving `website/`.
- **Netlify is blocked account-wide** (credit usage exceeded), so
  `npm run site:deploy` fails with `JSONHTTPError: Forbidden`. The Netlify copy at
  https://vaylo-sports.netlify.app is therefore **stale and still contradicts the
  launch date** — add credits or retire that site. It is a live, wrong page until
  then.
- `website/vercel.json` is now **emitted by `scripts/gen-website.cjs`** from
  `site/vercel.json`. Do not place it by hand: the generator does
  `rmSync(website)` first, so anything hand-placed is destroyed on the next build
  and the deploy that follows serves the `/play/` deep links as 404s, with no build
  error. `src/lib/website.test.ts` now asserts it is generated and correct.

### Deploy the site (Vercel)

```
node scripts/gen-website.cjs                                            # website/
MSYS_NO_PATHCONV=1 WEB_OUT_DIR=website/play VITE_BASE=/play/ \
  node scripts/build-web.cjs                                            # website/play/
cd website && npx vercel link --yes --project vaylo-site-6c1b6bc7 \
  --scope virello1 && npx vercel deploy --prod --yes
```

`MSYS_NO_PATHCONV=1` is required under Git Bash: otherwise `VITE_BASE=/play/` is
mangled into a Windows path (`C:/Program Files/Git/play/`) and the build refuses.
`vercel link` writes `website/.vercel/` and `website/.env.local`; `website.test.ts`
treats those as deploy artifacts rather than site output, so they do not read as a
stale build.

### Verified after the 2026-10-04 deploy

`/`, `/waitlist/`, `/legal/privacy/`, `/legal/waitlist-terms/`, `/app/`, `/play/`,
`/play/training` → **200**; `/play/assets/*.js` → **200**; unknown path → **404**;
headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`. The waiting-list page names
1 January 2027 and has zero occurrences of the old "no date" copy. A duplicate
signup from the live origin returned "You are on the list." with **no new row and
no second email**.

## Health Connect + wearables enabled — 2026-10-04 (APK 17 / 1.2.13)

### What changed in the repo

- `src/config/featureFlags.ts` — `wearableSync` now defaults to **true**, so
  `/health-sync` is reachable from the sidebar, the Recover hub and the
  personalisation catalog instead of redirecting to `/recover`. `VITE_ENABLE_wearableSync`
  still overrides it at build time.
- `android/app/src/main/AndroidManifest.xml` — the six Health Connect **read**
  permissions are declared for the first time (they had been commented out with
  a "TO RE-ENABLE" block). Read-only: no WRITE permission is requested, and
  `scripts/build-apk.sh` fails the build if one ever appears.
- `android/app/build.gradle` — versionCode 17 / versionName 1.2.13.
- `src/lib/androidNative.test.ts` — one matcher fix. The manifest ordering test
  did `indexOf("<application")`, which matched an XML *comment* that says
  "Declared before `<application>`" rather than the element, so
  `queriesAt < applicationAt` was comparing against the wrong offset. This was
  already failing before this release was enabled; it now matches the element
  (`"<application\n"`).

Nothing else moved. `HealthPermissions.VERSION` (Kotlin) and
`HEALTH_PERMISSIONS_VERSION` (TypeScript) stay at **1** — the permission catalog
did not change, only whether it is declared.

### Verified

`npm run typecheck` 0 · `npx vitest run` **868 passed** · `npx eslint .` 0 errors,
64 pre-existing `exhaustive-deps` warnings · `sh scripts/build-apk.sh` green:

```
[apk] ok   6 health read permission(s), 0 write
[apk] ok   no HcSeedActivity in release
[apk] ok   package: name='com.vaylosports.app' versionCode='17' versionName='1.2.13'
[apk] ok   version 1.2.13 (17) matches build.gradle
```

Artifacts `apk/vaylo-sports-1.2.13-17-release.{apk,aab}`; `apk/SHA256SUMS.txt`
now 21 entries, all verify.

### Backend confirmed live

`wearable-oauth` edge function ACTIVE. Tables `health_connections`,
`health_sync_state`, `health_workouts`, `health_samples` all present. Native
Health Connect sync needs none of the vendor secrets below — it is the plugin,
not the edge function.

### Known gap: the cloud providers are a stub, and no secret can fix that

Do not promise a reviewer direct Garmin/Fitbit/Strava import. `wearable-oauth`
records a `health_connections` row on callback but **never exchanges the code for
a token and never persists one**, and `/sync` only touches `last_sync_at` and
returns `{workouts: 0, samples: 0}`. Its `stateStore` is also an in-memory
`Map`, so a callback that arrives after the isolate recycles has no `userId` and
is silently dropped. Setting `<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` changes
the UI from "coming soon" to a redirect that goes nowhere useful.

Until that is built, Health Connect is the only working import path on Android.
The app says so per-provider rather than pretending.

### Manual steps, in order

1. Play Console → App content → **Health Connect declaration**: the declaration
   questionnaire must match the six permissions in the manifest. An app that
   declares Health Connect permissions without completing this is rejected.
2. Play Console → Policy → **Privacy policy**: the URL must be reachable and
   must name Health Connect / wearable data. `legal/wearable-health-privacy.html`
   already exists.
3. App content → **Data safety**: heart rate, sleep, steps, distance, calories
   and exercise sessions are health and fitness data collected by the app.
4. Upload `apk/vaylo-sports-1.2.13-17-release.aab` to **internal testing**
   first, then closed testing.
5. A new personal Play account needs 12 testers opted in for 14 continuous days
   before production access.
6. On the device: install Health Connect if absent (Android 13 and below),
   then Connect → grant each permission → Sync.
7. Vendor OAuth (optional, and pointless until the stub is finished): sign each
   developer agreement, then `supabase secrets set GARMIN_CLIENT_ID=…`, plus
   `WEARABLE_OAUTH_CALLBACK_URL` and `WEARABLE_OAUTH_APP_URL`.

### Never device-tested

The APK has still never been launched on a device or emulator. Health Connect
end-to-end sync is verified structurally only: the permissions are in the built
manifest and the JS/native wiring is asserted by tests.

---

## Notifications, onboarding reachability and the legal pass — 2026-10-04 (APK 18 / 1.2.14)

One batch of eight product requests. What was verified, and what still needs a
human, is below. Nothing in this section has been run on a real device.

### 1. Sign-in methods missing from the startup screen

The methods were never removed — `Auth.tsx` renders them from what GoTrue
reports (`/auth/v1/settings`: google, discord, facebook and passkeys all
`true`). The failure mode was the fetch: one failed or hung request answered
"password only" for the rest of the session (the result was pinned in a
module-level cache), so a cold start on a bad connection hid every button.
`src/hooks/use-auth-providers.ts` now has a 6 s timeout, does NOT cache a
failure, retries with backoff (1.5/3/5/8/13 s) and retries immediately on
`online`. Verified in a dev harness that boots the app as the Android shell
with `?failsettings=3` fault injection: three injected failures, then the
buttons. Pinned by tests in `src/hooks/use-auth-providers.test.ts`.

### 2. Continue button hard to tap on a phone

`Onboarding.tsx`'s action bar was a static row 20 px from the viewport bottom.
On Android 15+ (targetSdk 36) the WebView is edge-to-edge, so that strip is
inside the gesture/3-button navigation area and taps there are swallowed by the
system. The bar is now `sticky bottom-0` with
`pb-[max(1.25rem,var(--vaylo-inset-bottom))]` — the same inset variable the tab
bar and every bottom sheet already use. Measured at 390x844 with a simulated
48 px inset: button bottom edge 48 px above the viewport, the bar pinned to the
viewport bottom at every scroll position.

### 3. Workouts deleted, and wearable sessions made visible

Executed on production (the destructive option chosen explicitly):

```sql
delete from public.health_samples;
delete from public.health_workouts;
delete from public.workouts;
```

Row counts afterwards: 0 / 0 / 0. No FK blocked it (only
`health_samples.workout_id -> health_workouts`, `ON DELETE SET NULL`).

Synced sessions used to appear only on the Health Sync screen: health_workouts
is a separate table from the app's own `workouts`, and nothing mirrored it. The
Workouts screen now reads both and lists wearable imports in their own section
("Synced from your devices") with a link to Health Sync.

### 4. Logo on every legal document

Already applied before this batch and regenerated here: the gradient `.mark`
placeholder in all 27 `legal/*.html` pages is the real logo, inlined as a data
URI (the pages are served three ways — `srcDoc` iframe, the marketing site and
the edge function — and only a data URI has no base URL to resolve against).

### 5. Under-18s and refunds

Payments stay off (`PAYMENT_MODE=free`, and the free path needs
`closed_testing: true`), so nobody can buy anything today. The written
commitment now exists in three places: `refunds.html` section 4 opens with an
unconditional refund for any purchase made by or for someone under 18 ("if you
call it up"), `purchases.html` section 8 is rewritten around it, and
`terms.html` section 1 points at it. `child-safety.html` was updated so it no
longer claims minors simply cannot buy.

**Still open:** `Market.tsx` gates the buying surfaces to 18+ with the copy
"Purchases are 18+ only". Docs and code disagree until that gate is relaxed
(a decision for the owner, since it is a Children's Code control). It is inert
while checkout is off.

### 6. Notifications

New in this build: `@capacitor/local-notifications`, wired through
`src/lib/localNotifications.ts`. The app's existing triggers (streak at risk,
today's session unlogged, challenge ending in three days) now post to the
device's notification shade as well as the in-app inbox, so they survive the
app being closed. No Firebase project, no credential, no server. Quiet hours
(`notification_prefs`) are honoured before anything is posted. A tap on a
notification routes through `safeNotificationLink()`, like the in-app inbox.

**What this is not:** server-sent push. A trigger only runs while the app is
open, so nothing arrives on a phone that has not run the app. That still needs
the Firebase project described in
`android/app/src/main/res/values/vaylo_fcm.xml` (four empty strings today).

### 7. Height and weight asked at signup, and disclosed

`Onboarding.tsx` has a new optional step ("Height and weight") after the date of
birth, bounds-checked (90-250 cm, 25-300 kg), written to
`profiles.height_cm` / `profiles.weight_kg`. Blank is allowed and blank does not
wipe an existing value. The privacy policy (now **Version 1.2 · Effective 4
October 2026**) says in "What we collect" that these are asked on their own step,
are optional, and are used only for load sizing and trends — never public, never
sold, never used for advertising.

**Known gap, not fixed here:** `child-safety.html` claims nutrition and
weight-advice features are switched off for under-18s. Nothing in the app
actually gates on age for those features (`ageBand()` is only used for
purchases, communities and advertising). The documents overstate what the code
does.

### 8. Unsubscribe on every email

Verified rather than rebuilt: all three senders (`waitlist-signup`,
`waitlist-broadcast`, `waitlist-campaigns`) carry the link, and `_shared/email.ts`
already sends `List-Unsubscribe` plus `List-Unsubscribe-Post: One-Click`. Proof
run end to end: a test row was inserted, the deployed endpoint was POSTed to
with the one-click body, and it answered 200 and set `unsubscribed_at`; the test
row was then deleted. The recipient queries on both broadcast and the campaign
claim functions filter `unsubscribed_at is null`.

Transactional account emails (confirmation, password reset) are sent by Supabase
Auth, not by this code, and cannot carry an unsubscribe link — they are not
marketing mail.

### Deployed in this batch

- `legal` edge function redeployed; `/functions/v1/legal/privacy` serves
  "Version 1.2 · Effective 4 October 2026" and `/purchases` serves the rewritten
  section 8.
- Website redeployed to `vaylo-site-6c1b6bc7` (scope `virello1`): `/legal/privacy/`
  and `/legal/purchases/` show the new text, `/play/` builds and serves
  `assets/index-Djxp1w9D.js`.
- `playMount.test.ts` was fixed while doing this: it identified the entry chunk
  as "the largest .js", which stopped being true once the inlined legal pages
  made `LegalDocument-*.js` (718 kB) larger than the entry (473 kB). It now
  reads the module script out of `website/play/index.html`.

### Checks

`npm run typecheck` 0 · `npx vitest run` 870 passed / 57 files · `npx eslint .`
0 errors · `npm run ui:audit` clean (one expected 404 route) · APK built and
verified (see below).

### Manual steps

1. Try the new APK on a device and confirm the notification shade copy appears
   for a workout reminder; this path is untested on hardware.
2. Decide the under-18 purchase gate (see section 5 above) before checkout is
   ever switched on.
3. Create the Firebase project to enable server-sent push, then fill the four
   values in `vaylo_fcm.xml` and store the service account in the edge
   function's secrets.
4. Play Console: the Health Connect declaration from the previous section is
   still outstanding.

---

## 2026-10-08 — Friend messaging, unfriending and block coherence

One migration: `20261008120000_friends_messaging_and_unfriend.sql` — the
`direct_messages` table with its RLS, the `guard_direct_message()` and
`notify_direct_message()` triggers, `mark_messages_read()`, `unfriend()`, the
block-coherence trigger on `user_blocks`, an "already friends" guard on
`friend_requests`, and the two tables added to the `supabase_realtime`
publication. Feature documentation: [docs/FRIENDS.md](../docs/FRIENDS.md).

### Applied with `db query --file`, NOT `db push`

```bash
supabase db query --linked --file supabase/migrations/20261008120000_friends_messaging_and_unfriend.sql
```

`supabase db push --linked` was deliberately not used, and should not be used
until the history is repaired. `supabase migration list --linked` shows the
remote history has drifted from this tree: the remote table carries timestamps
that exist only remotely (for example `20261005172750`, `20261006153551`) while
marking most of the local files as unapplied (`20261005090000`,
`20261005210000`, `20261006140000`, …) even though their objects are demonstrably
live — `security:check`'s probes for `has_unlimited_credits` (20260930064813) and
the RLS narrowings in 20261006140000 all pass against the live database. A push
would therefore have tried to re-run dozens of already-applied files, several of
which are not idempotent (bare `add constraint`, seed inserts). Repairing the
history is its own task.

**The SQL was validated before it was applied.** The same file was run with a
deliberate `select 1/0` appended: the Management API executes a batch in one
transaction (verified first with a probe table that did not survive the error),
so every statement ran against the live schema and nothing was committed.

Re-running the file is safe: every statement is `if not exists`,
`create or replace`, `drop policy/trigger if exists`, or wrapped in a
`duplicate_object` guard. It has been applied twice (the second time to add the
privilege revoke and the `blocked_with()` policy).

### Verified live

- `npm run security:check` — **PASS, 31 checks** (7 new: anon refused on
  `direct_messages`, own messages readable, a non-friend's message refused, a
  spoofed sender refused, `UPDATE` refused at privilege level, `unfriend()` and
  `mark_messages_read()` callable and inert for a stranger).
- A throwaway transaction against the live database with real JWT claims, run as
  two real accounts: **21/21 assertions**, from accepting a friend request through
  to a block hiding the conversation from both athletes, with every row it created
  deleted before the commit. This is what found the two bugs worth recording —
  see docs/FRIENDS.md, "Two traps this file has already fallen into".

### Manual steps

1. Delete the two probe accounts (`authposture.*@example.com`) — they are the
   fixtures the transaction probe uses, and they were already listed for deletion
   in docs/RELEASE-AUDIT.md.
2. Nobody reads `content_reports` yet: the moderation queue is still the largest
   operational gap, and this migration adds a second stream of user content
   (messages) that can be reported.
3. Server-sent push for a message still needs the Firebase project
   (`npm run push:ready`: NOT READY); today a message only writes a bell entry.

### APK 20 / 1.2.16 built — the friends release

The mobile artifact was rebuilt so the shipped app actually contains the surface
described above. `versionCode 20 / versionName 1.2.16` in
`android/app/build.gradle`, built with `sh scripts/build-apk.sh` (release):

```
[apk] ok   APK signed with the Vaylo Sports upload key
[apk] ok   6 health read permission(s), 0 write
[apk] ok   no HcSeedActivity in release
[apk] ok   package: name='com.vaylosports.app' versionCode='20' versionName='1.2.16'
[apk] ok   targetSdkVersion:'36'
[apk] ok   0 JWTs in the shipped web bundle
[apk] ok   no source maps in the shipped web bundle
[apk] ok   AAB signed with the Vaylo Sports upload key
[apk] ok   AAB signature verifies
[apk] ok   version 1.2.16 (20) matches build.gradle
```

Artifacts `apk/vaylo-sports-1.2.16-20-release.{apk,aab}`, both appended to
`apk/SHA256SUMS.txt` and re-checked with `sha256sum -c`:

- APK `58fcd504ce297e06150880d36208e6eaff203704c0be81114e66913c42182141`
- AAB `76e8f57e7ff9dd5e8fb2e7aba31b00432a3ba91d85d05cbfc93e851e7fa318eb`

WebView-only, as the build.gradle entry says: `cap sync` found the same **8**
plugins as 1.2.14/1.2.15 (app, browser, haptics, keyboard, local-notifications,
share, splash-screen, status-bar), no manifest or permission changed, and the
friends code is in the shipped bundle — `assets/Friends-*.js` and
`assets/FriendChat-*.js` in `android/app/src/main/assets/public`.

To put 1.2.16 in front of testers, upload
`apk/vaylo-sports-1.2.16-20-release.aab` to the Play **internal testing** track.
The earlier manual steps (moderation queue, push, the two probe accounts) still
stand and are not build blockers.

### 2026-10-08 — legal documents corrected: the in-app deletion path was wrong

Four published documents told an athlete to reach deletion at *Profile → Settings
→ Delete Account*. There is no Delete Account inside Settings. The real route is
the **Delete account permanently** button at the bottom of the Profile screen,
under *Sign Out*; the same screen is also reachable from *Profile → Legal &
Safety → Delete your account*. Anyone following the document as written would
have opened Settings and found nothing.

Corrected, with the version line bumped on each:

| Document | Was | Now |
|---|---|---|
| `legal/privacy.html` (§11) | 1.3 | **1.4** |
| `legal/account-deletion.html` (the whole in-app step list, now four steps: the button, the re-authentication, `DELETE MY ACCOUNT` + the acknowledgement, then the confirmation) | 1.0 | **1.1** |
| `legal/data-rights.html` | 1.1 | **1.2** |
| `legal/contact.html` | 1.0 | **1.1** |

The wording deliberately does not name the Apple sign-in provider: neither does
any other legal document, and `src/lib/appleHidden.test.ts` fails the build if one
does. It says "sign in with the provider you normally use" instead, which is true
of both.

**Still owed: redeploy the legal function, or the published mirror keeps the old
path.**

```bash
node scripts/gen-legal-pages.cjs          # done — 27 pages, pages.generated.ts rewritten
supabase functions deploy legal --no-verify-jwt --project-ref vvwhausdjzdmsyxekrcl
```

The website already carries the corrected text (it embeds `legal/*.html` and was
regenerated), so the app, the Netlify site and the Supabase function will agree
again once that deploy runs.
