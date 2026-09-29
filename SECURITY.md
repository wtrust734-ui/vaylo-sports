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

### 10. The challenge clamp was decorative — HIGH, closed

A clamp inside an RPC protects only the RPC. `challenge_participants` also carried
an `"update self"` RLS policy, so an athlete could `PATCH` their own row to any
progress and walk straight past `update_challenge_progress()`. Verified:
`progress 0 -> 99999` against a target of 5, HTTP 200.

The policy had no legitimate caller — joining is INSERT, leaving is DELETE, and
every progress change goes through the RPC — so it is dropped rather than
narrowed. `security:check` asserts the direct write returns zero rows.

### 11. A challenge creator could price their own reward, and forge "official" — HIGH, closed

An athlete could INSERT a challenge with `is_official = true`, an arbitrary
`sponsor_name`, and `reward_points` of their choosing. Two problems at once: a
fake "Vaylo official" challenge, or one wearing a brand that never agreed to
appear, is phishing inside the app's own UI; and completion writes
`points_events` using the challenge's own `reward_points`, so the creator priced
their own payout. Chained with finding 10, that was a points-minting loop.

A BEFORE INSERT OR UPDATE trigger now normalises the privileged columns for any
client write — `is_official` false, `sponsor_*` null, `participant_count` 0, and
rewards capped at 20 credits / 250 points. `auth.uid()` is null for service-role
callers, so the official challenges and the seeder are untouched. Normalising
rather than raising is deliberate: none of these columns are part of any client
contract, and an error would break a future client that harmlessly sends one.

### 12. An empty basket returned `{"success": true}` — MEDIUM, closed

No money moved, but the client shows a success toast for a request that bought
nothing, which trains athletes to ignore the one signal that tells them a
purchase failed. `process-purchase` now answers 400 for an empty or id-less
basket.

### 13. An achievement could be granted but never removed — LOW, closed

`achievements` had INSERT and SELECT policies and no DELETE, so a row was
permanent. This surfaced as a bug in my own tooling: `security:check` filtered
on `title=eq.security-check probe`, and with an unencoded space PostgREST read
that as `title = 'security-check'` and matched nothing, so every run left a probe
row behind. Ten had accumulated on the review account. The encoding is fixed in
the script and the policy is added; a run now leaves zero.

*Known limitation, not fixed:* an athlete can insert an achievement with a title
of their choosing, because there is no achievement catalog to validate against.
That is self-gaming rather than reputation forgery — public profiles
deliberately do not show another athlete's achievements — so the worst outcome is
a badge on your own profile. Closing it properly means a catalog table and a
check constraint, which is a product change.

### 14. The Play reviewer account's password is in git history — CRITICAL, open

Found by grepping the remote's own history for the review account's password,
after the rest of this pass had come up clean.

`scripts/ui-audit.mjs` was committed with the credentials inline:

```js
const EMAIL = process.env.UI_EMAIL || "ui.review.20260928@example.com";
const PASSWORD = process.env.UI_PASSWORD || "…";
```

They were moved to a git-ignored local file afterwards, which fixed the working
tree and left history untouched. The password is recoverable from **five commits
on `origin/main`**, so it is exposed to anyone who can clone, permanently,
whatever the current file says.

This is worse than an ordinary leaked key. It is the account Google's testers
type a username and password into during review, so it is the credential most
likely to be *used* rather than merely found, and it is written down in a place
a Play reviewer or an automated scanner will read.

**Rotate it. Rotation is the only complete fix** — a force-push removes the
commits from the tip of the branch but not from any clone that already exists,
and not from GitHub's cached views of dangling objects. In order:

1. Change the password in Supabase → Authentication → Users for
   `ui.review.20260928@example.com`, and delete any other review-account
   credentials that were ever pasted into a Play Console form.
2. Update Play Console → App access → Testing instructions with the new
   password, if the account is still needed for closed testing.
3. Only then consider `git filter-repo --invert-paths` or BFG. That is a
   destructive rewrite of shared history and needs a decision, not a reflex.

**What has been done here** is to stop it recurring, which is the part that is
actually fixable without destroying the history:

- `scripts/secret-scan.mjs`, run by `npm run secret:scan` and as the first step
  of both CI workflows, fails the build when a tracked file contains a
  credential. It scans what git is *tracking*, not the working tree, because the
  working tree legitimately holds real secrets in `.env`.
- `.freebuff/` is now in `.gitignore`. Before this, the review credentials were
  kept out of the repository only by the sync script excluding the directory
  when copying — a property of the copy tool, not of git. A plain `git add` in
  the editing checkout would have committed a working Play reviewer login.
- `src/lib/secretScan.test.ts` pins the calibration. See below for why that
  turned out to be the important part.

### On writing a secret scanner and believing it

The first version of `secret-scan.mjs` ran against this repository and reported
PASS, on a repository that still contained the password in five commits.

Its rules matched `password: "…"`. The leak was written
`process.env.UI_PASSWORD || "…"` — the credential is the *fallback*, not the
assignment — so no rule fired. A third bug in the same file: the private-key
rule needed the key material on the line after the header, but the scanner ran
every rule one line at a time, so it could never match a PEM block.

None of these would have been found by reading the code. They were found by
extracting the offending file from the offending commit and running the scanner
against it, which is the only test that means anything here: **a scanner is
only proven by the thing it was built to catch.** So the fixtures in
`secretScan.test.ts` are pinned to the real shape of this leak, and the scanner
scans itself — an earlier version allowlisted its own file, which is how a real
password came to sit in a comment inside it.

The test fixtures use a fake password of the same shape. Quoting the real one
in a test would have moved a credential that is currently only in history into
the tip of `main`, which is strictly worse than the problem being fixed.

## Re-running the checks

```bash
npm run security:check   # 18 assertions, all of them negative
npm run secret:scan      # credential shapes in tracked files; needs no credentials
npm run auth:posture     # reports the four Dashboard settings that no migration can set
npm run ai:health        # which of the 7 AI features answer, and whether they took credits
```

### On testing a whole schema

`.freebuff/rls-sweep.mjs` attempts a write to all 97 tables as both `anon` and a
signed-in athlete. Two earlier versions of it were worthless, and both failed the
same way — by looking clean for the wrong reason:

1. A fixed probe body of `{ user_id, title, name, email }` was rejected with
   `PGRST204` on every table, because most tables have no `email` column. The
   request never reached the database. "No table accepted a write" was true and
   meaningless.
2. Rewriting every string to a sentinel fixed that but produced `22007`/`22P02` on
   28 tables — a uuid into `reward_config.id`, which is an integer. Those
   included `credit_transactions`, `profiles` and `subscriptions`.

The working version clones a **real** row, changes only the primary key and the
owner columns, and leaves every other value byte-identical. A value read from a
real row is already legal for its own column, so the only variable left is the
policy. It then reads the SQLSTATE, because a rejected insert means one of two
opposite things:

- `42501` — RLS refused. The answer we want.
- `23503` / `23514` / `23505` — RLS **allowed** the write and only a foreign key,
  a CHECK, or a unique index stopped it. Reported as a LEAD, because the policy
  would have let it through and an integrity rule is the only thing in the way.

Anything the script cannot classify is printed as UNKNOWN rather than counted as
safe. A sweep that cannot explain its own failures is not evidence.

It signs in as the review account and asserts that each closed path is still
closed, including that a money-priced product is refused and the balance is
unchanged afterwards. A migration is a one-time event; this is the standing
assertion, because the failure mode is silent — nothing throws, the app just
quietly gives things away.

### On asserting with supabase-js

An `update()` that matches zero rows under RLS **resolves without an error**. An
assertion written as "did this call fail?" therefore passes for the wrong reason
and tells you nothing. Write `.select()` on the write and count the returned
rows — that is the evidence. The official-challenge check in `security-check.mjs`
is written that way for exactly this reason, after a first version of it passed
while proving nothing.

### Official challenges are immutable

`public.challenges.creator_id` was `NOT NULL`, which is why the table had never
been seeded: there is no system user to own a row. Rather than fabricate a
profile that would appear in member lists and own content no human wrote,
`creator_id` is now nullable and NULL means "published by Vaylo". The existing
policies are all `auth.uid() = creator_id`, and NULL never matches, so an
official challenge is immutable and undeletable by every athlete — the right
default for content the whole app points at. `security:check` asserts it.
