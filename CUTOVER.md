# Lovable Cloud → Supabase cutover runbook

Everything below was verified against your actual project and repository, not
assumed. Where something is unverified or unknown, it says so.

Project: **`vvwhausdjzdmsyxekrcl`** (eu-central-1, Postgres 17.6.1.166)
Repository: this folder. CLI: `supabase` 2.117.0, already linked to that project.

---

## 1. Where things actually stand

| Thing | State |
|---|---|
| Frontend → backend wiring | **Done.** `.env` points at `vvwhausdjzdmsyxekrcl`; zero Lovable references remain anywhere in `src`, `supabase/functions` or `index.html` |
| Supabase schema | **33 migrations applied** (the 29 Lovable-era ones + 4 newer: `learning_discovery`, `learning_feedback`, `fix_coin_rate_1_25`, `weekly_coach_review_cost`) |
| Hardening migrations | **All applied** (2026-09-21, then `20260922090000_entitlement_and_referral_fixes.sql` on 2026-09-22) via `supabase db push --linked`, no errors. Live-verified: `coins_per_credit()` returns 7.5, and `viewer_is_adult()` / `sponsored_placements()` are unreachable by an unauthenticated caller |
| Audit round 2026-09-22 | Four user-facing defects found and fixed (broken cross-user names, two phantom-column queries, a forgeable/free entitlement, referral rewards that were never paid). Full detail and the live proof: `supabase/DEPLOY_NOTES.md` §"Audit round, 2026-09-22" |
| Geo + sharing + deletion 2026-09-22 | `20260922091000_geo_scopes_and_activity_sharing.sql` (public country, `shared_activities`, `activity_hypes`) and `20260922092000_user_region_public_read.sql` (reverts a column-level grant that broke `upsert`). Country/continental leaderboards, opt-in activity sharing instead of reading friends' private training, and account deletion rebuilt to cover 79 tables and **verify** the wipe. 25/25 live checks + 7 planted rows in the previously-missed tables. Detail: `supabase/DEPLOY_NOTES.md` §"Geo, sharing and deletion — 2026-09-22 (later)" |
| Tables | 87 in `public`, every one with RLS enabled |
| Audit round 2026-09-27 | Full-project audit. Four classes of defect fixed, all applied and live-verified: the subscription write path was **dead** (`subscriptions_plan_type_check` rejected the Phase 2 plan keys, so no purchase and no trial could ever be written); Event Packs were free to claim with a client-supplied price against an empty catalog; the trial never expired and was not once-per-account; and 24 `SECURITY DEFINER` functions were reachable without signing in. Also closed: session tokens leaving the device via Android backup, lapsed plans keeping paid-feature access, 22 unindexed foreign keys, and 147 per-row `auth.uid()` RLS predicates. Full detail and the live proof: `supabase/DEPLOY_NOTES.md` §"Audit round, 2026-09-27" |
| User data in Supabase | **None.** Every user table is 0 rows (3 `subscriptions` rows exist, all `free`, all created by the sign-up trigger) |
| Seeded content | `reward_definitions` 64, `country_pricing_map` 36, `subscription_plans` 6, `pricing_tiers` 4, `special_offers` 3, `economy_config` 7, `reward_config` 1 — all inserted by migrations |
| Storage | **Not used by the app at all** (0 references to the Storage client in `src`) and the project has 0 buckets. Nothing to configure, nothing to migrate |
| Edge functions | 14 exist in the repo and are deployed: `ai-analyze`, `ai-service`, `coach-chat`, `delete-account`, `generate-plan`, `learning-recommend`, `link-preview`, `manage-subscription`, `og-image`, `open-chest`, `process-purchase`, `video-form-analysis`, `wearable-oauth`, `weekly-review`. `og-image` and `link-preview` are the two public ones (`verify_jwt = false`, now declared in `config.toml` rather than only in a code comment) |
| `config.toml` | `project_id = "vvwhausdjzdmsyxekrcl"` — matches `.env`, so CLI commands cannot hit the wrong project. It now also declares the auth URLs (§4), pushed with `supabase config push` |
| Auth URL config | **Applied.** `site_url` moved off the dead `localhost:3000` to `localhost:8080`, redirect allow-list set for the dev ports. 11 unrelated hosted settings left untouched (verified with `supabase config diff`) |
| Edge secrets | `PAYMENT_MODE=test` set. **No AI keys yet:** `OPENAI_API_KEY` and `GOOGLE_API` are unset, so the AI features error (and refund their credits) until you add one |
| Live end-to-end check | **Done, then cleaned up.** Sign-up bootstrapped a profile with 20 starter credits, cross-user reads and writes were refused, and the 18+ sponsorship gate was proven blocked for a non-adult and served for an adult. All test rows deleted — every user table re-counted at 0 |
| Frontend hosting | **Not done.** Supabase does not host the frontend; `dist/` has not been published anywhere, so the app is not yet reachable by anyone but you |

`supabase db push` now has **nothing left to apply** — `supabase migration list`
shows the local and remote sets in sync. The section below is kept as the record
of what ran and how to repeat it on another project.

---

## 2. The Lovable Cloud backup file

`C:\Users\gemme\Documents\vaylosports1_260921 (1).backup`

What it is: a `pg_dump` **custom-format** archive of the *entire* Lovable Cloud
database — Postgres 17.6, dumped by an 18.6 client, **zstd-compressed** (which is
why it looks like binary noise in a text editor). It contains schema *and* row
data: 131 tables across `public` (85), `auth` (27), `realtime`, `storage`,
`vault` and `extensions`, roughly 1,000 rows in total.

Its contents, decoded:

| Content | Volume |
|---|---|
| Accounts | **9** — all 9 have bcrypt password hashes and confirmed emails (gmail + sky.com); identities include `email`, `google`, `apple` |
| Profiles | 9 |
| Training plans | ~208 |
| Achievements | ~49 |
| Water logs / metrics / VPR snapshots | 37 / 20 / 20 |
| Credit transactions / purchases | 18 / 9 |
| Subscriptions | 6 — **all free**, none paid |
| Credit & coin balances | credits 0–257, coins 0–100 |
| Storage objects | Only the database-export backups themselves — **no user uploads** |

### Do not restore this file

1. **It is not a `public`-schema backup.** It carries Supabase-managed schemas
   (`auth`, `storage`, `realtime`, `extensions`). Restoring it into a managed
   project would fight the platform over GoTrue, Realtime, Storage and Postgres
   internals, and its `supabase_migrations.schema_migrations` (52 rows) would
   contradict the migration history the project already has.
2. **`vault.secrets` is in there**, encrypted with the *old* project's root key.
   Copied to another project those rows can never be decrypted — they are dead
   weight at best.
3. **The old schema is behind the new one.** All 85 of its `public` tables exist
   in your Supabase project, plus `learning_feedback` which it predates. There is
   nothing structural to gain.
4. **Config content is already in sync** — the old DB's `reward_definitions`
   (64), `country_pricing_map` (36), `subscription_plans` (6), `pricing_tiers`
   (4) and `special_offers` (3) match the new project. Importing config would be
   actively harmful: the old values predate the 1 credit = 7.5 coins change and
   the credit/coin hardening.

**Recommended: keep it as an archive, import nothing.** All 9 accounts are on the
free plan, so no entitlement or balance needs preserving, and importing
`auth.users` by hand is not supported by Supabase — GoTrue owns that schema, and
cross-project user/identity/session loads are how you end up with accounts that
cannot sign in.

**If you later decide those histories matter**, the clean route is *not* the
auth tables: have each athlete sign up again (or invite them), then re-attach
their `public` rows by mapping old UUID → new UUID. That keeps plans, logs and
achievements without touching GoTrue internals. Say the word and that import can
be generated from this file.

Keep the file private: it holds real email addresses and password hashes.
`.gitignore` now excludes `*.backup`, `*.dump`, `*.sql.gz`.

---

## 3. The 8 hardening migrations — ✅ applied 2026-09-21

> **Status: done.** A `--dry-run` was reviewed first and listed exactly these 8
> and nothing else, then `supabase db push` applied them with no errors.
> Re-check any time with `supabase migration list` (both sides should match) and
> `select public.coins_per_credit();` (should return 7.5).
>
> **You do not need to run anything in this section again.** It is kept as the
> record of what changed and how to reproduce it on a fresh project.

### What each one does, and why it matters

| # | File | What it fixes |
|---|---|---|
| 1 | `20260921090000_security_and_integrity_fixes.sql` | Closes three abuse paths reachable from any browser with the public anon key: the credit/points RPCs were callable in ways that minted currency, `points_events` had a self-insert policy, and adds `find_user_by_friend_code` that the current client calls |
| 2 | `20260921090100_local_day_streaks.sql` | Streaks were counted in UTC while the app counts in the athlete's local day, so anyone east of UTC saw the client and server disagree; `touch_streak(p_date)` now takes the local day, clamped ±1 day so it can't be fast-forwarded |
| 3 | `20260921090200_avatar_catalog_server_prices.sql` | Creates `avatar_catalog` (246 items, generated by `scripts/gen-avatar-catalog-sql.cjs`) so cosmetic prices live server-side instead of in the bundle |
| 4 | `20260921090300_coin_economy_hardening.sql` | Guards `profiles.coins` (the credits guard predated the coins column, so coins were mintable from the console), makes `add_coins` service-role only, adds `grant_coins`, buys cosmetics at server prices, removes client writes to `avatar_items` |
| 5 | `20260921090400_coin_rate_7_5.sql` | **1 credit = 7.5 coins** (was 1.25), stored in `economy_config.coins_per_credit` so it's tunable from the admin surface |
| 6 | `20260921090500_profile_cosmetics.sql` | Puts profile cosmetics on sale for Coins (`reward_definitions.coin_cost`), adds `purchase_cosmetic` / `equip_cosmetic` / `unequip_cosmetic`, and stops clients writing ownership/equipped state directly |
| 7 | `20260921090600_iap_readiness.sql` | `user_purchases.provider_reference` + `platform` with a unique index, so a retried app-store transaction can never grant twice |
| 8 | `20260921090700_sponsored_age_gate.sql` | Brand/sponsorship tables plus the server-enforced 18+ gate (`viewer_is_adult()`, `sponsored_placements()`, `record_brand_event()`), and hides sponsored challenges from under-18s |

**Order matters.** 3 must run before 4 (4's purchase function reads
`avatar_catalog`). 1 must run before anything that calls
`find_user_by_friend_code`. Applying in filename order satisfies both.

### Route A — Supabase CLI (recommended)

```bash
cd "C:\Users\gemme\Documents\Codex\2026-09-19\github-plugin-github-openai-curated-remote\work\vaylosports1-main"

supabase login          # opens a browser; if it won't, use the token form below
supabase migration list # sanity check: local vs remote, 8 should be local-only
supabase db push        # prints the list, then asks to confirm
```

If the browser doesn't open (it hasn't before on this machine):

1. Supabase dashboard → **Account → Access Tokens** → *Generate new token* (`sbp_…`).
2. Either `supabase login --token sbp_…`, or set it as the environment variable
   `SUPABASE_ACCESS_TOKEN` and re-run.

Docker is **not** required for `db push` — it talks straight to the linked
project. (Docker is only needed for `supabase start` and `db diff`.)

What success looks like: it lists the 8 migrations and ends with
`Finished supabase db push.` If it says *"Remote database is up to date"*, the
push already happened and you can re-check with `supabase migration list`.

### Route B — Supabase Studio SQL editor

Open the project → **SQL Editor**, then paste and run each file **in filename
order**, one at a time:

`20260921090000` → `…090100` → `…090200` → `…090300` → `…090400` → `…090500` → `…090600` → `…090700`

Notes for this route:

- Each file is idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`,
  `DROP POLICY IF EXISTS`), so a re-run is safe if one fails halfway.
- The SQL editor runs as `postgres`, which bypasses RLS — that is what you want
  for DDL, and it is why these must not be run through the client library.
- Migration 2 defines `touch_streak` twice on purpose (a new signature plus a
  zero-arg wrapper for older deployed bundles). Both must run.

### Verify it worked

```bash
supabase migration list     # the 8 should now appear as applied on both sides
```

Then, in order: `economy_config` should contain a `coins_per_credit` row with
`7.5`; `select public.coins_per_credit()` should return 7.5;
`select public.viewer_is_adult()` should return `false` for a brand-new account
(no date of birth = not an adult, which is the intended safe default).

---

## 4. Auth configuration — URLs applied, credentials still yours

> **Status: the URL settings are done; the OAuth credentials are not.**
> `site_url` was `http://localhost:3000` — a port nothing in this project runs on
> — and the redirect allow-list was empty, so every confirmation and reset email
> pointed at a dead address. Both now come from `supabase/config.toml` and were
> applied with `supabase config push`: `site_url` is `http://localhost:8080`
> (this repo's dev port, `vite.config.ts`) with `localhost:5173` and the
> `127.0.0.1` equivalents allowed. That push declared nothing else, so 11
> unrelated hosted settings (email confirmations, TOTP, storage analytics) were
> left exactly as they were — confirmed with `supabase config diff` before and
> after.
>
> **Still yours:** the production URL (§6), the Google/Apple credentials, and
> SMTP. Because this project has no OAuth credentials, those two buttons now
> hide themselves rather than failing — see `src/hooks/use-auth-providers.ts`.

Nothing in the code needs changing for email/password — the rest are dashboard
settings, and two of them are the difference between working sign-in and
confusing failures.

1. **Authentication → URL Configuration.** Set **Site URL** to the domain you
   will actually deploy on, and add it to **Redirect URLs**. If this stays at
   `localhost`, every password-reset and magic link points at a dead address —
   the one auth bug that looks like a broken account rather than a setting.
   It currently reads `http://localhost:8080`: change it in `supabase/config.toml`
   and re-run `supabase config push` once the site has a real domain.
   The app builds reset/OAuth redirects from `VITE_PUBLIC_APP_URL` when set,
   otherwise the current origin (see `src/lib/share.ts`).
2. **Providers.** The app supports Google, Apple and email/password
   (`signInWithOAuth` in `src/pages/Auth.tsx`). Email works immediately. Google
   and Apple need client IDs/secrets entered in **Authentication → Providers** —
   those credentials are *not* in any database dump (they live in GoTrue config),
   so they must be re-created, with the callback URL
   `https://vvwhausdjzdmsyxekrcl.supabase.co/auth/v1/callback` registered with
   each provider. Until then the corresponding button does not render, because
   the app asks GoTrue which providers it has
   (`src/hooks/use-auth-providers.ts`) instead of offering a button that errors.
3. **Email confirmation — currently OFF, on purpose.** Pushed from
   `supabase/config.toml` (`[auth.email] enable_confirmations = false`) on
   2026-09-21, because Supabase's built-in mail service allows only a handful of
   messages per hour per project. With confirmations on, the *second* sign-up in
   an hour fails with `429 over_email_send_rate_limit` — and GoTrue fails before
   inserting the user, so it presents as a broken sign-up page rather than a mail
   problem. With it off, sign-up completes immediately with a session and no mail
   is sent. Verified live afterwards: `200` + session + auto-confirmed +
   `handle_new_user()` bootstrapping a profile with 20 starter credits.

   **Before launch, do both:** configure SMTP (item 4), then delete the
   `[auth.email]` block (or set it to `true`) and re-run `supabase config push`.
   Leaving it off in production lets anyone register an address they do not own —
   and site configs sent to that address go nowhere.
4. **Email delivery.** Still unconfigured, and it is needed even with confirmations
   off: password resets go through the same rate-limited mailer, so
   "Forgot password?" hits the same `429` until real SMTP is in place
   (Dashboard → Project Settings → Auth → SMTP; Resend/Postmark/SendGrid all have
   free tiers). Supabase's built-in service is explicitly not for production.
5. **Expected consequence of section 2:** the 9 Lovable-era accounts do not
   exist here, so those athletes would register fresh. Nobody loses paid access,
   because none of them had any.

---

## 5. Secrets and function deploys — ✅ applied, except the AI keys

> **Status: done.** `PAYMENT_MODE=test` is set on the project (verified with
> `supabase secrets list`), and the four functions whose code changed were
> redeployed with `supabase functions deploy … --use-api` — `--use-api` bundles
> server-side, which is why this worked without Docker. All 11 functions are
> live; those four are at **VERSION 2**. The only secrets still missing are the
> AI ones, and nothing below needs re-running.

Functions get `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` automatically. The rest you must set:

```bash
supabase secrets set PAYMENT_MODE=test
supabase secrets set OPENAI_API_KEY=sk-...     # when you have one
supabase secrets set GOOGLE_API=...            # when you have one
```

Which function needs what, verified by reading each entry point:

| Function | Needs | Without it |
|---|---|---|
| `ai-service`, `ai-analyze`, `coach-chat`, `generate-plan`, `weekly-review`, `learning-recommend` | `OPENAI_API_KEY` | The AI features return an error. Coach chat, weekly review, plan generation, form analysis and mental/nutrition/tactics advice all stop |
| `video-form-analysis` | `GOOGLE_API` | Video analysis returns "not configured" |
| `process-purchase` | `PAYMENT_MODE` (defaults to `test`) | N/A |
| `delete-account`, `open-chest`, `manage-subscription` | service role only | N/A |

All AI calls go through one module, `supabase/functions/_shared/openai.ts`,
which speaks the OpenAI **Responses API** (`gpt-5.5`, `gpt-5.4-mini`) and the
Chat Completions API (`gpt-4.1`, `gpt-4.1-mini`) — models are named only in
`_shared/aiModels.ts`. Swapping to Gemini is therefore a rewrite of that one
shared file (Gemini has no Responses API, so the request/response mapping and
tool-call handling need translating), not a config change. Nothing else needs to
move.

Deploy the functions whose code changed in the hardening pass:

```bash
supabase functions deploy coach-chat weekly-review learning-recommend process-purchase
```

- `coach-chat`, `weekly-review` — refund the 3 credits when an AI call fails
- `learning-recommend` — now requires a verified user
- `process-purchase` — validates the basket, records server-side prices, allows
  one redemption per offer, grants coins through `grant_coins` (and verifies
  Google Play purchase tokens via `_shared/playBilling.ts` when
  `PAYMENT_MODE=store`)

Deploy the rest too if this is the first deploy to the new project:

```bash
supabase functions deploy ai-service ai-analyze generate-plan video-form-analysis delete-account open-chest manage-subscription
```

---

## 6. Frontend

Nothing to change — `.env` already targets the new project. The build reads:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public anon key (safe in the bundle; RLS is the security boundary) |
| `VITE_PUBLIC_APP_URL` | Optional. Shared links, referral links and auth redirects. Required for the Capacitor build, unnecessary on the web (falls back to the current origin) |

```bash
npm run build      # output in dist/
```

Hosting: build command `npm run build`, publish directory `dist`, and the three
environment variables above set in the host's dashboard. `.env.example` lists
everything the app and the functions read, including which values are secrets
that belong in `supabase secrets set` instead of the bundle.

**The host must serve `index.html` for unknown paths — this is new work, because
Lovable's hosting used to do it for you.** The app is client-routed, so
`/learning/run-001` and `/settings/delete-account` exist only in the browser; on a
plain static host a refresh or a shared deep link returns the host's own 404.
`public/_redirects` already contains the rule and ships into `dist/` (Netlify and
Cloudflare Pages read it; existing files still win, so assets are unaffected).
The Vercel, Firebase and GitHub Pages equivalents are written out in that file's
header.

Once the site is live, put its origin into Supabase → **Authentication → URL
Configuration** (Site URL *and* Redirect URLs), or auth emails keep pointing at
localhost (§4).

Build status as of this run: `npm run build` is green (~17s), emitting a chunked
`dist/` with `index.html` plus hashed assets.

---

## 7. Verification — what was proved automatically, and what to spot-check

> **Already proved against the live project**, using two confirmed test accounts
> and one temporary sponsored placement, all deleted afterwards (every user table
> re-counted at 0):
>
> | Claim | Evidence |
> |---|---|
> | Sign-up creates the profile | `handle_new_user()` produced a profile with **20 credits** (`starting_credits()`), 100 coins, and a `Starter credits` row in `credit_transactions` |
> | Sign-in works | the password grant returned a real session token |
> | RLS isolates athletes | as user A, `profiles` returned **only A's row**; A's update aimed at B's row changed **nothing**; B's `credit_transactions` came back empty; `brands` returned `permission denied` |
> | The 18+ gate holds both ways | for a non-adult: `viewer_is_adult()` **false**, `sponsored_placements('challenge')` **[]**, `record_brand_event` **false**; after setting a 1990 date of birth: **true**, the seeded sponsor returned *with its "Sponsored" label*, and the impression registered |
> | The economy rate is live | `coins_per_credit()` returned **7.5** to a signed-in athlete |
> | Minting paths are closed | `add_credits` / `credits_grant` are absent from the anon-executable function list; `viewer_is_adult` and `sponsored_placements` are too |
> | Checkout grants, records and refuses correctly | `pack_25` → `credits_added: 25`; `coins_300` → `coins_added: 330`; `coins_first` → `coins_added: 700`; replaying `coins_first` → **409**; unknown product → 400. Balances and ledger matched exactly |
> | Every other function boots and degrades cleanly | with no AI key: `coach-chat`, `generate-plan`, `weekly-review`, `learning-recommend`, `ai-service`, `ai-analyze` and `video-form-analysis` each return a *clear* "not configured" error instead of crashing or charging |
> | Account deletion works | `delete-account` succeeded for each test athlete and left **no** orphan rows (every user table re-counted at 0) |
>
> **This testing found two live bugs, both fixed and re-deployed**
> (`process-purchase` was at VERSION 3 when this was written): a generated
> identifier typo that made the edge worker die on boot, so *every* checkout
> returned `WORKER_ERROR`, and a `.catch()` on a PostgREST builder that reported
> already-granted purchases as failures. Details in
> `supabase/DEPLOY_NOTES.md` → "Bugs found and fixed". Both were invisible to
> `tsc` because no tsconfig covers `supabase/functions/**`; a new unit test now
> imports the generated mirror so the first one fails `npm test`, and the
> functions have their own type-checking project (`npm run typecheck:functions`,
> or `npm run typecheck` for all of them). Re-introducing the original defect was
> confirmed to fail both checks. See `supabase/DEPLOY_NOTES.md`.
>
> What follows still needs eyes on a running app — layout, animation and toast
> behaviour cannot be verified from the API.

1. **Sign up** at `/auth` with a fresh address → land on `/onboarding`.
   (What just happened: `handle_new_user()` created a profile with
   `starting_credits()` credits.)
2. **Onboarding**: sport → level → goal → days → **date of birth** (new step) →
   preview. Set a date of birth older than 18 years: the preview should say
   *18+*, and you should be treated as an adult. Leave it blank on a second
   account: no sponsored content, and age-based training adjustments are off.
3. **Dashboard** `/` — no console errors; streaks and credits render.
4. **Goals** `/goals` — create and complete a goal.
5. **Learning** `/learning` → open a lesson at `/learning/:id` — filters, search,
   progress save and share all work without an AI key.
6. **Challenges** `/challenges` — join one, log progress, complete it. Confirm
   the sponsored slot renders **nothing** (no brand rows exist yet) and that the
   disclaimer is present.
7. **Avatar** `/avatar` — buy a cosmetic with Coins. Expect the server to price
   it from `avatar_catalog`; if you're short, the top-up sheet should open
   rather than a dead-end toast.
8. **Market** `/market` — add a credit pack to the basket and check out. This
   exercises `process-purchase`.
9. **Profile** `/profile` — edit your date of birth, equip a cosmetic, confirm
   it renders on the header.
10. **Coach** `/coach` and **Weekly review** — these need `OPENAI_API_KEY`; until
    it's set they should fail *gracefully* with an error and refund the credits
    rather than hanging.
11. **Delete account** — exists in-app (`delete-account`), and both stores
    require it.

Two things to test deliberately, because they are the security fixes:

- As a signed-in user, call `add_coins` / `add_credits` directly from the console
  (`supabase.rpc('add_coins', { p_amount: 999999, p_reason: 'test' })`) and
  confirm it is **refused**.
- Try to update your own coins with
  `supabase.from('profiles').update({ coins: 999999 }).eq('user_id', …)` and
  confirm the guard trigger rejects or ignores it.

---

## 8. What still won't work after all of the above

These are known gaps, not oversights — each is tracked in the docs named:

- **AI features** until an `OPENAI_API_KEY` (or a Gemini rewrite of
  `_shared/openai.ts`) is in place.
- **Payments: Google Play Billing is the chosen provider.** The server-side
  verifier is implemented (`_shared/playBilling.ts` + `verifyStorePurchase()`),
  but `PAYMENT_MODE=test` still keeps checkout granting without verification
  until Play Console products + the service-account secrets are in place and
  `supabase secrets set PAYMENT_MODE=store` is run. Full runbook:
  `CAPACITOR.md` §3. Don't sell anything real until that cutover is done.
- **Sponsored surfaces are empty** by design — no brand rows exist. See
  `SPONSORSHIP.md` for the SQL to add one.
- **Brand-funded challenge rewards are deliberately off.** `reward_credits` is
  never granted, because `update_challenge_progress(p_delta)` still trusts a
  client-supplied number, so completion is self-certified. Paying a sponsor's
  money against that would be paying out on a spoofable metric.
- **Not built** (documented in `DEPLOY_NOTES.md` / `MONEY.md`): season pass,
  leagues, guilds, wishlist and limited drops, gifting, tournaments, coach
  bookings, referral rework. Creator store is paused.
- **The frontend has no host yet.** Supabase is the backend and does not serve
  the app; `dist/` has not been published. Until it is, nobody else can use it —
  and the host must be given the SPA fallback from §6 or deep links 404.
- **Auth emails still point at `localhost:8080`** until the deployed origin
  replaces it in Authentication → URL Configuration.
- **Google and Apple sign-in are hidden** — the project has no OAuth credentials
  for them. Email/password is the complete, working path.
- **Native app** is prepared, not built — `CAPACITOR.md` is the runbook.

---

## 9. Safety / rollback

- Every migration here is additive or a tightened policy. None drops a table,
  deletes rows, resets the database or touches existing data. The only policy
  *replacement* is on `challenges` (sponsored rows hidden from under-18s); the
  old policy name is dropped and replaced, and ordinary challenges are
  unaffected.
- There are no user rows in the project to lose — the only populated tables are
  seed config. If something goes wrong, the worst case is re-running the
  migrations, not losing data.
- The Lovable backup stays on disk as the archive of the old project. Keep it
  out of Git and out of any public location.
- The verification above created two confirmed test athletes and one test brand
  and then removed them; `auth.users`, `profiles`, `subscriptions`,
  `credit_transactions`, `brands`, `brand_placements` and `brand_metrics` were all
  re-counted at **0**. Account deletion in the app clears ~80 tables by name
  before removing the identity (`supabase/functions/delete-account`), so the
  deletion path does not rely on foreign-key cascades — note that `subscriptions`
  has no FK to `auth.users`, so a manual SQL delete of a user (as opposed to the
  app's) would leave its row behind.
