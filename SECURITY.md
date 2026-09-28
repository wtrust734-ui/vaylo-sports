# Security

What an attacker can reach, what has been closed, and what is still open.

Last assessed: 28 September 2026, against the live project by driving its own
public API with the key that ships inside the app. Every finding below was
reproduced, not inferred from reading the schema.

---

## Closed

### 1. `profiles.infinite_credits` was writable by the athlete — CRITICAL

`process-purchase` reads `profiles.infinite_credits` with the service role and
treats the balance as `MAX_SAFE_INTEGER` when it is set. The guard trigger
covered `credits` and `coins` but not this pair of columns, and the RLS policy
lets an athlete update their own profile row, so a single authenticated
`PATCH` made every credit-priced product free.

Reproduced: a 54-credit unlock granted to an account holding 50 credits.

**Fixed** in `supabase/migrations/20260928183000_close_client_writable_privileges.sql`.
Both columns are now under `guard_profile_credits`, and the one legitimate
writer is `grant_infinite_credits()`, which is `service_role`-only and sets the
guard flag itself. `process-purchase` calls that RPC instead of writing the
column — a service-role client bypasses RLS but not triggers, so a direct write
would have failed the purchase *after* the credits were granted.

### 2. Paid products were granted with no payment — CRITICAL

`PAYMENT_MODE` defaults to `test`, in which `verifyStorePurchase` returns
`verified: true` without checking anything. Any signed-in athlete could POST
`process-purchase` with a paid product id and receive it. Reproduced: 650
credits granted, twice in a row, from an account holding 50.

No money can be collected today, so refusing is not lost revenue.

**Fixed** in the edge function: a product priced above zero is refused with
`503 payments_not_available` unless `PAYMENT_MODE=store`, where the Play
purchase token is verified against Google's API. Feature unlocks and Event
Packs are unaffected — they are paid for with credits the athlete earned, and
the credit balance is the authority. The three purchase surfaces (Market, credit
top-up sheet, coin top-up sheet) now say so in plain language instead of
"Purchase failed".

### 3. The credit ledger was writable by the athlete — HIGH

`credit_transactions` had an INSERT policy for the `public` role. Reproduced: a
row of `+1,000,000` accepted with HTTP 201. The ledger is the history an athlete
is shown, and `credits_claim_reward` computes its 24-hour self-serve cap by
summing it — so a forged row can also lock a user out of legitimate rewards.

**Fixed**: the client INSERT policy is dropped. Every legitimate write already
goes through `credits_spend` / `credits_grant` / the edge functions.

### 4. A challenge could be completed in one request — HIGH

`update_challenge_progress(p_challenge, p_delta)` added a client-supplied
number with no bound. Reproduced: a challenge with a target of 100 completed in
one call with `p_delta = 999999`, paying 500 points and an achievement.

**Fixed**: the delta must be a positive whole number, is clamped to
`min(target_value, 1000)`, and the challenge must be inside its date window.
The response reports `clamped: true` so the screen can explain itself. A manual
"log progress" feature still has to believe the athlete — see *Open* below.

### 5. Admin enumeration and an anonymous leaderboard — LOW

`has_role(_user_id, _role)` was callable by any signed-in athlete for any user
id, so anyone could map who administers the app. `top_referrers()` was
executable by `anon` and returns user ids with display names; there is no
referral data yet, so nothing leaks today, but it will as soon as there is.

**Fixed**: `has_role` answers about the caller, or for an admin — otherwise it
returns false. `top_referrers` is no longer executable by `anon`.

---

## Open

### Auth accepts any password and issues a session immediately — HIGH

Signing up with the password `123456` succeeded and returned a session, and
twelve consecutive wrong passwords produced no `429`. Every throwaway account
can then claim the 30-day unlimited trial (`grant_unlimited_trial` is clamped
to 30 days server-side, one per account) and spend it on AI calls, which are
paid for with `OPENAI_API_KEY`. Mass sign-up is a direct route to your OpenAI
bill.

These are Dashboard settings, not schema, so they are not in the migration.
**Authentication → Sign In / Providers → Email:**

- [ ] Enable email confirmation (`Confirm email`) — this is the one that stops mass trial abuse
- [ ] Minimum password length 8 or more
- [ ] Enable leaked-password protection (Have I Been Pwned)
- [ ] Set the rate limits: `token_refresh` and `password` to something an hour of typing cannot reach

Enabling confirmation changes the Play reviewer flow: the reviewer account
needs a real inbox to click the link once. That is the account in
`.freebuff/ui-audit.local.json` in your working checkout.

### Streaks and achievements are written by the client — MEDIUM (integrity, not breach)

`streaks` has an `ALL` policy for the owner and `achievements` an INSERT policy,
both by design — the app writes them client-side. An athlete can therefore set a
9,999-day streak or award themselves an achievement with an invented
`share_count`. Nothing is gained but credibility, and a leaderboard built on
either is not a leaderboard. Reproduced: `streaks` accepted `current_streak:
9999`. If the leaderboard matters, move those writes behind an RPC that derives
the value.

### AI rate limiting is per-instance — MEDIUM

`_shared/guard.ts` throttles with an in-memory `Map`, which resets on a cold
start and is not shared between the instances Supabase runs. It is a speed bump,
not a limit. Credits are still the real bound.

### The native OAuth callback has no PKCE — LOW

`src/lib/nativeOAuth.ts` completes sign-in from `com.vaylosports.app://auth-callback#code=…`.
The flow is bound by Supabase's `flow_state_id`, and custom schemes cannot be
claimed by verification, so another app on the device could register the same
scheme. Move to HTTPS App Links and PKCE before the Play listing is public.

### `minifyEnabled false` for release — LOW

No R8 obfuscation. For a Capacitor app the JavaScript *is* the application and is
readable in the APK regardless, so this buys little; it is worth enabling for
the Java-only shell code.

---

## What is already right, and worth keeping

These were probed and refused. Any future change that touches them should be
treated as a regression:

- `credits_grant` and `add_coins` are executable by `service_role` only, not by
  `authenticated` — the primitives that mint money are not on the API surface.
- Every `SECURITY DEFINER` routine that takes a price argument ignores it and
  reads the catalog: `purchase_avatar_item_coins`, `claim_event_pack`,
  `credits_spend`. An earlier version of the avatar purchase took a client cost.
- `redeem_referral` blocks self-referral and is one-per-account, with an
  idempotency key on the grant.
- `user_purchases` has no INSERT policy: entitlements cannot be forged.
- Direct writes to `credits` and `coins` are rejected by trigger, with the
  `app.allow_credit_change` flag used only inside the routines that mean it.
- Play purchases are verified against the Google Play Developer API with a
  service-account token, and a unique index on `provider_reference` makes a
  replayed purchase a no-op.
- Every edge function authenticates with `authenticate(req)` and derives the user
  from the token. No function reads a user id from the request body.
- `link-preview` is crawler-facing and unauthenticated by design, and escapes
  everything it reflects; it fetches no URL the caller supplies.
- The Android manifest sets `allowBackup="false"`, exports only the launcher
  activity, keeps the FileProvider unexported, and targets SDK 36, so cleartext
  traffic is refused by default.
- No service-role key, `.env` or keystore has ever been committed; the only JWT
  in the bundle is the publishable one, which is designed to be public.

---

## Re-running the checks

```bash
npm run security:check   # 10 assertions, all of them negative
```

It signs in as the review account and asserts that each closed path is still
closed, including that a money-priced product is refused and the balance is
unchanged afterwards. A migration is a one-time event; this is the standing
assertion, because the failure mode is silent — nothing throws, the app just
quietly gives things away.
