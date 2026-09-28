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

### 6. The AI rate limit was per-instance — MEDIUM

`_shared/guard.ts` throttled with an in-memory `Map`: 20 calls a minute, per
function instance. Supabase runs each function on several instances and recycles
them, so the counter an attacker is up against is whichever instance answered,
and it resets when that instance is replaced. Every one of those calls is billed
to `OPENAI_API_KEY`, so a per-isolate `Map` should not be the thing standing
between a script and your invoice.

**Fixed**: `ai_call_allowed(feature, max, window)` counts in Postgres, where
every instance sees the same rows, and all seven AI endpoints call it —
`ai-analyze`, `generate-plan`, `learning-recommend`, `coach-chat`,
`video-form-analysis`, `ai-service`, `weekly-review`. It fails **open**: an
outage in the limiter should not take the coach offline, and credits remain the
real bound. Verified against the deployed function: 30 requests in a row, 20
answered, 10 refused with 429.

`ai-service` kept its own private copy of the throttle, which is exactly why a
change to the shared one would have missed it. That duplicate is deleted; the
endpoint now counts per feature, so a heavy feature cannot spend a light one's
budget.

Note the limiter counts *attempts*, not successes: a call that fails afterwards
— a 500 from a missing API key, say — has still been counted, which is the right
behaviour for an abuse guard.

### 7. The client could assert its own streak and achievement history — MEDIUM

`streaks` had an `ALL` policy for the owner. Reproduced before the fix:
`current_streak: 9999` accepted with HTTP 201.

Nothing needed that write. The app already goes through `touch_streak(p_date)`,
a `SECURITY DEFINER` routine that clamps the athlete's local day to ±1 day of the
server's own and handles the grace-day and freeze rules. The client only ever
needs to read its row, so the write policies are gone and the only remaining
access is `SELECT`.

A trigger that recomputed the streak was written first and removed: it would have
fought `touch_streak`'s own grace-day handling — the branch that decides whether
a missed day is forgiven, and which deliberately does *not* increment the counter.
Deriving a value in a second place, from less information, is how that rule
quietly breaks.

`achievements` genuinely is client-written — `checkAndAwardMilestones` inserts a
medal at a points threshold — so the INSERT stays. What changed is what a row may
claim: `earned_at` is stamped by the server's clock and `share_count` starts at
zero. Verified by inserting a medal claiming the year 2000 and 100,000 shares:
it came back as 2026 and 0, and the delete policy removed the test row.

### 8. The app shipped a key that can never be rotated — LOW

`VITE_SUPABASE_PUBLISHABLE_KEY` held the legacy `anon` JWT. Both key types are
designed to be public and both end up in the APK, so neither is a secret — but
the legacy JWT has an `iat` fixed when the project was created and can never be
rotated, so every build ever shipped carries the same key forever. The project
also has a modern `sb_publishable_…` key that can be replaced from the Dashboard
in seconds.

**Fixed**: the client uses the publishable key now, verified end to end (public
read, sign-in and a session against the API all behave identically), and the
bundle no longer contains a `eyJ…` JWT at all.

The legacy key is still injected into the edge runtime as `SUPABASE_ANON_KEY`, so
do not disable it in the Dashboard until nothing depends on it.

### 9. The native OAuth callback was the implicit flow — LOW

`src/lib/nativeOAuth.ts` parses `code` and `flow_state_id` and calls
`exchangeCodeForSession` — PKCE-shaped code — but the client never asked for PKCE.
The authorize URL was generated without a `code_challenge` at all, so what came
back in the redirect was not a code the exchange could safely use, on a custom
scheme (`com.vaylosports.app://`) that Android does not verify: any other app on
the device can register the same scheme.

**Fixed**: the client sets `flowType: "pkce"`. Verified by inspecting the
authorize URL — `code_challenge` present, method `s256` — and by confirming that
password sign-in and a session against the API are unaffected. The exchange side
needed no change; only the request side was asking for the wrong thing.

---

## Open

### Auth accepts any password and issues a session immediately — HIGH

The only finding left that matters, and the only one no migration can touch.

Signing up with the password `123456` succeeded and returned a session, and
twelve consecutive wrong passwords produced no `429`. Every throwaway account
can then claim the 30-day unlimited trial (`grant_unlimited_trial` is clamped to
30 days server-side, one per account) and spend it on AI calls, which are billed
to `OPENAI_API_KEY`. Mass sign-up is a direct route to your OpenAI bill.

These are Dashboard settings, not schema, so they cannot be applied from the
repository. **Authentication → Sign In / Providers → Email:**

- [ ] Enable email confirmation (`Confirm email`) — this is the one that stops mass trial abuse
- [ ] Minimum password length 8 or more
- [ ] Enable leaked-password protection (Have I Been Pwned)
- [ ] Set the rate limits: `token_refresh` and `password` to something an hour of typing cannot reach

Then run `npm run auth:posture` to find out whether it took effect. It probes the
live endpoint the way an attacker would and reports each property. It exits 0
whatever it finds, because it is a report rather than a gate: `security:check` is
the gate, and it deliberately asserts nothing about auth, since a check nobody
can fix from the repository is one people learn to ignore. The two probes that
create an account print the addresses they used so you can delete them.

Enabling confirmation changes the Play reviewer flow: the reviewer account needs
a real inbox to click the link once. That is the account in
`.freebuff/ui-audit.local.json` in your working checkout.

### A custom URL scheme is still unverified — LOW

PKCE means an intercepted callback buys the interceptor nothing, which is the
part that mattered. What is left is that Android cannot tell your app from
another one claiming `com.vaylosports.app://`. Moving to HTTPS App Links needs
`assetlinks.json` served from a domain you control at a stable host, so it is a
deployment question rather than a code one.

### Streaks and achievements are written by the client — CLOSED, see 7 above

### `minifyEnabled false` for release — LOW, and left deliberately

No R8 obfuscation on the release build. For a Capacitor app the JavaScript *is*
the application and is readable in the APK either way, so obfuscation buys
almost nothing here — and R8 strips or renames exactly the reflection a
Capacitor plugin relies on, which fails at runtime in ways a build cannot
predict. Not worth the risk to a Play reviewer build for a cosmetic gain.

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
npm run security:check   # 13 assertions, all of them negative
npm run auth:posture     # reports the four Dashboard settings that no migration can set
```

It signs in as the review account and asserts that each closed path is still
closed, including that a money-priced product is refused and the balance is
unchanged afterwards. A migration is a one-time event; this is the standing
assertion, because the failure mode is silent — nothing throws, the app just
quietly gives things away.
