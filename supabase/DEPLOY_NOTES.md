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
