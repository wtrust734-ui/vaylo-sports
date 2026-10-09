# Coach Marketplace

Built, tested, and **switched off**. This document is the runbook for turning it on
and the record of what is not finished.

The request was: build the whole thing, ship it hidden on the website and in the
app, and activate it later with one instruction once the company is a limited
company and Stripe is connected to a business bank account.

**The activation instruction is "Activate Coach Marketplace".** §6 is the list of
switches that means; nothing else in this document needs to be re-derived.

> Status at the time of writing: everything in §1–§5 exists and is verified. The
> database is live with zero rows in it — the marketplace has never been switched
> on, and no coach has signed up.

---

## 1. The money model

A coach sets **the price they want to be paid**. The buyer is charged that price
plus the platform's commission. The commission is **added on top**, never taken
out of the coach's price.

| | |
|---|---|
| Coach asks for a 1-week plan | £5.00 (`marketplace_listings.price_cents = 500`) |
| Vaylo's commission, 20% of the coach's price | £1.00 |
| **Buyer is charged** | **£6.00** |
| **Coach is paid** | **£5.00** |

Why on top rather than deducted: a coach who asks for £5 and is paid £4 has been
paid a number they never chose and cannot predict. The order of operations is the
product promise, so it is implemented once, in one place.

**Where each number lives**

| Number | Authority | Why there |
|---|---|---|
| The commission rate | `marketplace_config.coach_commission_bps` = `2000`, read by `public.marketplace_quote(net_cents)` | Tunable without a deploy, exactly like `economy_config.coins_per_credit`, and the 10–20% band is a `CHECK` constraint (`marketplace_check_commission`) rather than a comment |
| The signup fee | `marketplace_config.coach_signup_fee_cents` = `2000` ($20) | Same table, same reason |
| The app's copy of the rate | `src/config/coachMarketplace.ts`, mirrored verbatim to `supabase/functions/_shared/coachMarketplace.ts` by `npm run gen:coach` | A test fails if the mirror is stale, so the price a coach sees and the price the server charges cannot drift |
| The price actually charged | `public.marketplace_quote()`, called from inside `public.buy_coach_plan()` | The client's arithmetic is never trusted. `coach_orders` also carries a `CHECK (net_cents + fee_cents = gross_cents)`, so a row whose split does not add up is unrepresentable |

Change the rate in **one** place: `src/config/coachMarketplace.ts`, then
`npm run gen:coach`, then a migration (or an `UPDATE`) for the database row. The
tests in `src/lib/coachMarketplace.test.ts` fail if the three disagree, and refuse
a rate outside 10–20%.

## 2. Who pays through what

Two rails, and the split is a rule rather than a preference.

**Stripe — the website only.**

* The **$20 coach fee**, and nothing else. `coach-signup` creates a Stripe
  Checkout Session; `stripe-webhook` is the only thing that turns a person into a
  coach.
* It is never started from inside the Android app. A membership bought in the app
  would be a digital purchase Google's rules say must go through Play Billing, so
  `src/pages/CoachSignup.tsx` detects the native shell and tells the coach to do it
  on the website instead of opening a payment sheet.
* The redirect URL to Stripe comes from the **server** (`COACH_SIGNUP_ORIGIN`), not
  from the request, so this endpoint cannot be turned into an open redirect that
  collects a paying coach.

**Google Play Billing — inside the app.**

* A coach's **plan**. Play cannot charge a price your server picks at request time:
  a one-time product is created in the Play Console with its price, and every coach
  has a different price. So a plan is not a Play product.
* The way through is a **wallet**: the buyer tops up *coaching credits* in fixed
  amounts through Play (an ordinary consumable purchase), then spends the balance
  on a listing at the listing's own price. One credit is one penny.
* Coaching credits are **not** Vaylo credits. They cannot buy an AI feature, and the
  credit economy is untouched — which is what the Coaching screen already promises
  ("credits are never used here").

## 3. What exists

**Database** (`supabase/migrations/20261007060428_coach_marketplace.sql`, plus
`20261007060502_coach_marketplace_grants.sql` and
`20261007060855_listing_insert_and_order_retention_fixes.sql`. The version prefixes
are the versions recorded in `supabase_migrations.schema_migrations`, so the
repository and the database agree on what has already been applied.)

| Object | What it is |
|---|---|
| `marketplace_config` | The commission and the signup fee, publicly readable, banded by constraint |
| `creator_profiles.is_coach`, `.coach_since` | What makes somebody a coach. Set only by the Stripe webhook — a trigger refuses a client setting either |
| `coach_applications` | The $20 fee: created before the checkout session, completed by the webhook, idempotent on the session id |
| `marketplace_listings.is_coach_plan`, `.weeks`, `.currency` | A plan is a listing with a duration; the insert trigger requires a price ≥ £1 and a duration for coaching plans |
| `coach_orders` | `net + fee = gross`, enforced; unique on `(rail, provider_reference)` for replay safety |
| `coach_earnings` | The payout ledger. One row per order, status `accrued` until a payout rail exists |
| `coach_deliveries` | Where the plan actually reaches the buyer. Insert allowed only by the order's coach, for a paid order |
| `coach_credit_packs`, `coach_credit_wallet`, `coach_credit_entries` | The Play Billing wallet, idempotent on the Play reference |
| `public.marketplace_quote(net_cents)` | The split. The only implementation |
| `public.buy_coach_plan(buyer, listing, reference)` | Atomic purchase: locks the wallet, re-quotes, writes the order, the earning and the sales count together, and returns the original order on a replay |
| `public.coach_roster` | The roster view the app's Coaches tab reads. Public profile columns and a plan count; `payout_email` is not in it |

Grants are explicit (`20261007060502_coach_marketplace_grants.sql`): Supabase's
default privileges grant `anon`/`authenticated` everything on a new table, so this
withdraws the blanket grant and re-issues only the reads the product needs, with a
`DO` block that **fails the migration** if the posture is not what it should be. The
write functions (`buy_coach_plan`, `grant_coach_credits`,
`apply_coach_signup_payment`) are revoked from every client role.

**Edge functions**

| Function | verify_jwt | What it does |
|---|---|---|
| `coach-signup` | on | Starts the Stripe Checkout for the coach fee. Refuses with `stripe_not_configured` when no key is set |
| `stripe-webhook` | **off** | The only writer of `is_coach`. Authenticated by an HMAC-SHA256 signature over the raw body with a five-minute freshness window (`_shared/stripeSignature.ts`, unit-tested against digests computed outside this repo) |
| `coach-checkout` | on | `wallet` / `topup` (verified Play purchase) / `buy` (spend the wallet on a plan) |

**None of the three is deployed.** `npx supabase functions list` shows the
pre-existing functions and `sponsor-enquiry`, and nothing else — the code typechecks
(`npm run typecheck:functions`) but has never been pushed. That is deliberate: a
deployed, unconfigured `stripe-webhook` is a public endpoint whose only job is to
refuse, so there is no reason to stand one up before there is something to accept.
Deploying them is step 2 of §6, and until then nothing in this document has moved a
penny.

**App**

* `src/components/coach/CoachDirectory.tsx` — the roster: everyone who has signed
  up, with what they teach and how many plans they have.
* `src/components/coach/CoachPlanCard.tsx` — one plan: the buyer's price, what the
  coach receives, and the only purchase flow in the app.
* `src/pages/CoachStudio.tsx` — the coach's own side: set a price, publish, see what
  is owed, deliver what was bought.
* `src/pages/CoachSignup.tsx` — the coach fee, on the web only.
* The Market's **Coaches** tab (`CoachingSection.tsx`), and the tab itself is
  removed from the nav while the flag is off.

**Website**

* `/coaches/` — generated, `noindex`, **in no sitemap, and linked from nothing**.
  Its CTA links to `/contact/` while the marketplace is closed. The signup and
  payment surface used to live at `/play/coach-signup` on the website, but the
  live-app preview was deleted from the main website (2026-10-07); activation
  will need a hosted signup page again — see §6 step 7.
* `site/pages/coaches.mjs` exports `COACH_MARKETPLACE_OPEN = false`, and the page
  leads with "Coach accounts are not open yet" while it is false.

## 4. Not finished: Google Play products

**Required before activation.** The three credit packs must exist in the Play
Console as **one-time products** (consumables), with prices matching
`COACH_CREDIT_PACKS` in `src/config/coachMarketplace.ts` and the rows in
`coach_credit_packs`:

| Product id | Price | Credits |
|---|---|---|
| `coach_credits_5` | £5.00 | 500 |
| `coach_credits_10` | £10.00 | 1000 |
| `coach_credits_25` | £25.00 | 2500 |

The server refuses a product id it does not recognise, and refuses a verified Play
purchase whose product does not match the pack the client asked for, so a £5
purchase cannot be replayed as a £25 top-up. `PAYMENT_MODE=store` and the Google
service-account secrets are the same ones `process-purchase` already needs (see
`CAPACITOR.md` §3).

## 5. Not finished: payouts, and the tax question

There is **no payout rail**. `coach_earnings` records what each coach is owed and
nothing moves. The coach studio says so in as many words, and the website says so
before somebody pays the $20.

Before a single coach is paid:

1. **Choose the rail.** Stripe Connect (Express) is the natural choice because
   Stripe is already the website's processor, but it makes Vaylo responsible for
   the coach's onboarding, identity verification and the *tax reporting* that
   Stripe requires of a platform. Manual bank transfers are simpler and put the
   KYC question on us instead. This is a real decision and it is not made.
2. **Coach terms.** There is no legal document for coaches yet. What is needed: the
   fee is non-refundable once the account is opened (or the refund rule, if it
   should be refundable), the commission and how it is applied, that the coach is
   responsible for their own tax, that we are not a party to the coaching
   relationship, and what happens to accrued earnings if the account is closed.
   `legal/purchases.html` and `legal/terms.html` already cover buyers; a coach is a
   seller and needs their own section. Follow `docs/FEATURE-LEGAL-PROCESS.md`.
3. **Tax position.** A coach earning money may create a reporting obligation for
   them and, depending on the rail, an information-reporting obligation for Vaylo.
   Nobody has answered this yet.
4. **An account with unpaid earnings should be paid before it is deleted.**
   `coach_earnings` is in the account-deletion list, deliberately — the same choice
   `user_purchases` makes — so an account closure discards the ledger. Note it in
   the deletion flow before coaches are live.

## 6. ACTIVATION — the switch list

For "Activate Coach Marketplace". In this order.

1. **Company + Stripe — the precondition, and not done yet.** The company is not
   yet a limited company and there is no Stripe account. This is the user's work,
   not the code's, and **nothing below this line does anything until it is done**:
   the fee cannot be taken without an account, and the money cannot reach a bank
   account that does not exist.
2. **Deploy the functions, then wire Stripe to them.** Nothing in §3's edge-function
   table is live yet, and the order here matters — the webhook endpoint in Stripe has
   to point at a URL that exists.

   ```bash
   # 1. Secrets first, so the first invocation is already configured.
   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   # after step 3 below
   # COACH_SIGNUP_ORIGIN is optional; set it only if the site is not on the default origin.

   # 2. Deploy. `verify_jwt = false` for stripe-webhook is already in
   #    supabase/config.toml, which is what makes that exemption survive the deploy.
   npx supabase functions deploy coach-signup --use-api
   npx supabase functions deploy coach-checkout --use-api
   npx supabase functions deploy stripe-webhook --use-api

   # 3. Then, and only then, create the endpoint in Stripe pointing at
   #    https://<project>.supabase.co/functions/v1/stripe-webhook subscribed to
   #    checkout.session.completed, checkout.session.expired and charge.refunded,
   #    and set STRIPE_WEBHOOK_SECRET to the whsec_ it shows you.
   ```

   Until `STRIPE_SECRET_KEY` is set, `coach-signup` refuses with
   `stripe_not_configured` rather than failing in a way that looks like a bug — so a
   deploy is safe to do ahead of the secrets, and a coach clicking the button in that
   window is told the truth.
3. **Play products.** Add the three packs from §4.
4. **Play billing.** `STORE_BILLING_ENABLED = true` in `src/lib/billing.ts` and
   `PAYMENT_MODE=store` — this is the same switch the credit economy needs, so if
   it is already on, do nothing.
5. **Database: the marketplace is on.** The commission row already exists; there is
   no separate "enabled" row to set. If the fee should be different, `UPDATE
   public.marketplace_config SET value = … WHERE key = 'coach_signup_fee_cents'`.
6. **App: reveal it.** In `src/config/featureFlags.ts` change
   `coachMarketplace: envOverride("coachMarketplace", false)` to `true`. That single
   boolean reveals the Coaches tab, `/marketplace`, `/market/become-creator`,
   `/coach-studio` and `/coach-signup` — the routes already exist on both sides of
   it.
7. **Website: open it.**
   * `site/pages/coaches.mjs`: `COACH_MARKETPLACE_OPEN = false` → `true`. This
     removes the "not open yet" notice, and the page must not go out without it.
   * Decide whether the page should now be indexed: delete `noindex: true` and add
     `coaches.mjs` to `NAV` or `FOOTER` in `site/data/site.mjs` if coaches should be
     able to find it. Leaving it unlinked keeps it hidden from search while the app
     links to it, which is a reasonable place to start.
   * `npm run site:build` (required — `website/` is committed and a test fails if it
     is stale).
8. **Tests that assert the hidden state, deliberately.** These now fail, and each
   failure is a decision to make rather than a test to delete:
   * `src/config/featureFlags.test.ts` — "keeps the coach marketplace off" and the
     blanket "every flag defaults to off" loop.
   * `src/lib/coachMarketplace.test.ts` — "ships with the marketplace flag off",
     "only reaches the app through the flag", and the `COACH_MARKETPLACE_OPEN`
     assertion.
   * `src/lib/economyIntegrity.test.ts` — asserts `BecomeCreator.tsx` still says
     "payouts are not yet enabled". **Keep it passing** unless payouts are actually
     connected (§5): it exists to stop the app promising money it cannot move.
   * ~~`site/data/app-preview.mjs`~~ — removed with the app-preview subsystem
     (the /app/ pages were deleted from the main website on 2026-10-07), so
     there is no preview list to move `/coach-studio` or `/coach-signup` into.
9. **Smoke test with real money, small.** Pay the $20 fee as a real coach on the
   website, confirm the webhook email arrives, publish a £1 plan, buy it in the app,
   and check `coach_orders` has `net=100, fee=20, gross=120` and a matching
   `coach_earnings` row. Refund the $20 in Stripe and confirm the operator email
   says a human has to decide.

**Rolling back** is the same list in reverse: the flag back to `false` hides every
app surface, and `COACH_MARKETPLACE_OPEN = false` closes the website page. Nothing
about an existing order or earning is affected by either — the tables stay, the
ledger stays, and a coach's plans stay published but unreachable, which is the state
that lets a problem be fixed without losing anything.

## 7. Deliberately not built

* **Web checkout for a plan.** On the web build a plan shows "coaching credits are
  bought in the Android app". Selling the same plan on the web and in the app at
  once would need the plan to be priced in two places, and the app purchase has to
  go through Play anyway.
* **Ratings and reviews.** `marketplace_listings.rating` and `sales_count` exist and
  `sales_count` is incremented by a real purchase, but nothing collects a rating.
  The card shows a rating only when one is above zero.
* **Search across plans.** The roster has a search box; the plans grid does not.
* **Automatic payouts, and any tax handling** (§5).
