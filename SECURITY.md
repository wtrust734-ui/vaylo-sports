# Security

What an attacker can reach, what has been closed, and what is still open.

Last assessed: **12 October 2026** (previously 1 October 2026), against the
live project by driving its own public API with the key that ships inside the
app and by running the Supabase security advisor directly against the database.
Every finding below was reproduced, not inferred from reading the schema.

---

## Video form analysis could not run at all — 12 October 2026

Reported as "form analysis doesn't work", and it was worse than that: the feature
had never completed a single analysis. Three independent faults, each found by
driving the deployed function with a real clip rather than by reading it.

- **Every request was refused as a duplicate of itself.**
  `claim_video_analysis_request` inserted its claim row and then read that row
  back to look for an existing claim, so it saw the lease it had just created
  (`lease_expires_at = now() + 20 minutes`) as another caller's and answered
  `claimed: false`. `video-form-analysis` turned that into 409 "This video
  analysis is already in progress" for every athlete, on every clip, on the first
  attempt. The old six-megabyte request-body path hid it, because those requests
  failed earlier, on size. The function now decides liveness in ONE statement: an
  insert means the claim is ours, and an update only takes over a `processing` row
  whose lease has genuinely expired — the crash-recovery the schema always claimed
  to provide. Rows left behind by earlier crashes (two on the review account
  alone, from 3 October) are recovered by that same statement instead of blocking
  the account permanently.
- **The Files API was addressed wrongly, so processed clips 404'd.** The retrieve
  and delete calls were built as a file name appended to a base that already ended
  in `/files`, and a file resource's `name` is itself `files/<id>` — so the request
  went to `/v1beta/files/files/<id>`, which does not exist. Any clip the provider
  had not finished ingesting failed the whole analysis; the fault was invisible on
  a fast clip and constant on a real one. Every file path is now built from the API
  root. This is also a privacy fix and not only a functional one: the delete of the
  provider-side copy failed for the same reason, so a clip was left at Google for
  the full 48-hour retention window instead of being removed when the report was
  written.
- **A delivered analysis could not be replayed, and the clip was buffered.** The
  idempotency lookup ran *after* the upload had been read and deleted, so a
  transport retry of a completed analysis was answered 400 "the uploaded clip could
  not be read" rather than with the saved report — the exact case the replay path
  exists for. The lookup now runs first. The clip is also streamed from Storage
  straight into the provider's upload rather than buffered, so the size cap is
  policy rather than a memory limit, and the caps themselves moved from 60 seconds
  / 25 MiB to 10 minutes / 512 MiB, measured from the object's own `content-length`
  (Storage's metadata, never the caller's claim). The provider cost of a long clip
  exceeds the ceiling `video_form_analysis` is priced against — that ceiling is
  deliberately left at the 60-second figure and must move together with the price;
  see the note in `src/config/credits.ts`.

---

## Metered video analysis, fail-closed share links, signed release — 1 October 2026

Third pass, from an APK audit rather than the security advisor. Three findings:
the video endpoint ran unmetered, public share links pointed somewhere the
project does not control, and the release artifact was unverifiable.

- **Video analysis is metered, and the free tier is one Flash a week.**
  `video-form-analysis` ran no charge at all: an 18 MiB body went to Gemini on
  the caller's tab and the ledger never saw it. It now charges
  `public.credit_cost('video_form_analysis')` — 12 credits — through
  `spendForUser()` before the provider call, with the ledger as the authority
  rather than a client-supplied flag. The 6 MiB cap replaces the old 18 MiB one,
  and model selection is server-side: `gemini-3.8-flash` by default,
  `gemini-3.1-pro-preview` only inside the premium allowance.
- **The free window is a union, not a count of history.** One complimentary
  Flash per rolling 7 days comes from `reserve_video_analysis_slot()` — a
  reservation row with `expires_at`, which survives history deletion — and the
  function *also* counts non-deleted `video_form_analyses` rows from the last
  7 days. Charging is required when either counter says the slot is spent, so
  deleting an analysis cannot hand back a free run. A quota RPC error fails
  **closed** with 503 rather than letting the call through uncharged.
- **Premium is capped by cost, not by generosity.** Lifetime and subscription
  plans get at most 10 Pro calls per rolling 30 days (`p_limit: 10`); past that
  Flash stays available at 12 credits. An Unlimited plan is *not* exempt here —
  the spend goes through `credits_spend_metered`, which is `service_role`-only
  and bills real cost. `premiumTier` reads `expires_at` and deliberately stops
  reading the stored `unlimited_credits` flag, the same lapsed-subscription trap
  as `guard.hasEntitlement()`.
- **Replays and parallel uploads are claimed, not hoped against.** Each request
  carries a `request_id` behind a partial UNIQUE index; `claim_video_analysis_request`
  grants one in-flight request per key and `releaseRequestClaim()` frees it on
  every failure path, so two tabs cannot double-debit and a refused request does
  not burn the key. Provider errors refund through `refundCredits()`.
- **Public share links fail closed.** `link-preview` returned 503 with no owned
  domain, but the app kept building share URLs from the preview origin, so a
  published link could be handed to a third party pointing at a `.lovable.app`
  preview. `configuredPublicBase()` now accepts a public base only when
  `VITE_PUBLIC_APP_URL` is an owned HTTPS host that is not local, not a preview
  suffix and not a Supabase host; otherwise native shares stay linkless.
  Inbound legacy Lovable deep links are still accepted — failing closed on
  outbound must not lock out the users already on the old build.
- **The release artifact is signed and verified.** `1.2.1-5` builds through
  `scripts/build-apk.sh`, which fails closed if `apksigner` or `aapt2` produce
  no output rather than passing vacuously. Verified in the artifact: signer
  `CN=Vaylo Sports`, package `com.vaylosports.app`, targetSdk 36, six
  health *read* permissions and zero write ones, no `HcSeedActivity` (the test
  stub), and no JWT or source map anywhere in the shipped JS bundle. Shipped
  bytes are recorded in `apk/SHA256SUMS.txt`; superseded artifacts are left in
  place, so the older checksums still verify.

**Deployment drift is now visible and worth naming.** An edge function deploy
ships the whole `_shared` tree into *that one function's* bundle, so the copies
running in `coach-chat`, `ai-analyze` and the rest are still the previous
`guard.ts` — while the working copy already has the metered `spendForUser()`
with `billUnlimited` and `hasEntitlement()` reading `expires_at`. `video-form-analysis`
is at version 7 with the new code; the others are not. Redeploy the remaining
AI functions before relying on shared-guard changes taking effect there.

Still open from this pass: the nested-route cold-start fix and the deep-link
allowlist cannot be exercised on a device from here, and App Links still needs
`assetlinks.json` on a domain you control.

---

## AI, health, privacy and deletion hardening — 30 September 2026

Second pass, covering the AI edge functions, video analysis, health/wearable
sync, and account deletion.

- **`ai-service` (the generic AI endpoint) now charges.** It previously let the
  client name ANY catalog feature and ran it without a charge — a free-AI hole
  next to the dedicated functions that pay. Features are now validated against
  the server catalog first; a small allowlist of light-copy features is free by
  product decision but re-checked against the economy table on every call (an
  admin pricing one later takes effect immediately); everything else is charged
  through `spendForUser()` at the exact price the economy table names for that
  feature string, before the provider call.
- **`guard.spendForUser()` accepts an idempotency key.** The ledger's partial
  UNIQUE index already enforced replay protection; the wrapper now lets callers
  pass a key, so function-level retries cannot double-charge.
- **Coach memories are server-authoritative.** `[MEMORY_SAVE: …]` lines used to
  be parsed by the browser after the stream finished — a closed tab dropped
  memories and a doctored client could fabricate any memory row it wanted. The
  coach-chat function now tees the SSE stream, reassembles the full reply, and
  persists memories server-side with clamped fields. The client only refreshes
  its memory list. Memories remain inspectable and deletable in the app.
- **A safety contract ships in every AI feature prompt.** No diagnosis
  language, emergency-symptom escalation, crisis-line routing for self-harm
  disclosures, refusal of doping and dangerous-practice requests, no nutrition
  prescriptions for minors — appended to every feature via `base()`, marked
  non-overridable by athlete data.
- **Output validation.** `generate-plan` now validates the returned plan's
  structure (7-day weeks, safe types, clamped durations) and refunds on
  malformed output; `learning-recommend` sanitizes every client-supplied
  string that reaches the prompt, verifies the tool-call name, and only
  accepts recommended lesson ids that exist in the real list.
- **Video analysis entitlement matches the money.** The premium tier check
  trusted `unlimited_credits` and `status='active'` without reading
  `expires_at` — the exact lapsed-subscription trap documented in
  `guard.hasEntitlement()`. It now reads the timestamp. The free-tier window
  excludes rows the athlete deleted, deleted rows carry `deleted_at`, and a
  `delete_expired_ai_data()` maintenance RPC enforces the documented 30-day
  retention (unsaved analyses + rate-limit counters) from a scheduled job.
  Superseded on 1 October: the free window is now a quota reservation unioned
  with the non-deleted history count, so it can no longer be reset by deleting
  an analysis. See the section above.
- **Log hygiene.** No AI function logs raw provider bodies or exception text
  to the client anymore; internal detail stays in server logs behind stable
  user-facing messages.
- **Account deletion covers the AI counters.** `ai_call_events` — the durable
  rate-limit table with a `user_id` — was missing from the deletion registry,
  so usage rows survived account deletion. Added; `account_deletion_events`
  stays out by design (salted hash only), and the three service-only telemetry
  ledgers stay FK-free deliberately. Incomplete deletions now report table
  names and counts, never row contents.
- **Wearable OAuth stores no tokens.** The callback no longer persists an
  `oauth_state` value into `health_connections.metadata`; connection rows
  carry only status and a linked timestamp. Disconnect is idempotent and
  documented as stopping future syncs without deleting imported data.
- **Health data deletion is a first-class control.** The Wearables page gains
  "Delete imported data": removes all imported `health_workouts` /
  `health_samples` rows, resets the sync cursor and local state — separate
  from disconnecting, which was the only control before.
- **Ledger CHECK corrected.** The `amount <> 0` CHECK from the security pass
  would have broken `credits_spend` for Unlimited subscribers (zero-amount
  audit rows are its documented behavior). It now allows zero only for the
  `unlimited_plan` source — verified against live data first (no zero rows
  existed yet).

---

## Hardened on 30 September 2026

`20260930064813_security_hardening_ownership_and_grants.sql` plus
`20260930064921_explicit_deny_policies_for_service_only_tables.sql` closed the
remaining structural gaps the advisor could see:

- **Ownership is now guaranteed by the database.** 53 more `user_id` columns got
  a real foreign key to `auth.users(id) ON DELETE CASCADE` (55 lacked one; the
  3 service-only telemetry ledgers are deliberately excluded so their history
  survives account hard-deletes), and `friendships.friend_id` got its own FK.
  Before this, deleting an auth user left orphan rows behind forever and nothing
  prevented a row pointing at a non-existent user. Live audit first: the only
  orphans in the whole database were 7 default `free` subscription rows for
  already-deleted accounts, which the migration deletes explicitly and by name
  before the constraint lands.
- **Balances cannot go negative and ledgers cannot hold noise.** CHECKs:
  `profiles.credits >= 0`, `profiles.coins >= 0`, ledger `amount <> 0`,
  credit `balance_after >= 0`, `event_pack_ownership.price_cents >= 0`. Each
  was verified against live data (zero violations) before being added.
- **Identity invariants.** `friendships_not_self`, `referrals_not_self`, and a
  UNIQUE index on `achievements (user_id, type, title)` so a retry can never
  mint a second identical medal. All were probed live after applying: the
  database refused each bad write with the expected SQLSTATE.
- **The advisor's actionable WARNs are resolved.**
  `guard_achievement_claims()` — a trigger function that was still
  anon-executable over REST (lint 0028) — and `has_unlimited_credits(uuid)`,
  which answered an entitlement question about *somebody else* (an oracle), are
  both revoked from clients. Trigger invocation does not consult EXECUTE, so
  neither change affects app behaviour. The remaining 36 "authenticated can
  execute SECURITY DEFINER" WARNs were re-checked one by one rather than
  blindly revoked: every such function derives the caller from `auth.uid()`,
  validates inputs, and is required for the client to spend/grant through the
  closed write paths. They are the design, not a leak — see §Open.
- **"RLS enabled, no policy" said what it meant.** The four service-only tables
  (`ai_call_events`, `brands`, `brand_placements`, `brand_metrics`) now carry
  an explicit `USING (false) WITH CHECK (false)` policy. Grants were already
  revoked, so this changes nothing at runtime; it documents intent and clears
  lint 0008.
- **25 user_id lookups got their index.** Every RLS policy evaluates
  `user_id = auth.uid()`; 25 tables had no index leading on `user_id`, so each
  authenticated scan read the whole table. `coin_transactions` got a
  `(user_id, created_at desc)` composite instead, matching the newest-first
  history reads.

All six new invariant probes were added to `npm run security:check` (now 24
checks) and pass against the live project.

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
const EMAIL = process.env.UI_EMAIL || "<the review account's address>";
const PASSWORD = process.env.UI_PASSWORD || "<a literal password>";
```

Both values are redacted here on purpose. Quoting the real address here would
add another copy of it to the tip of `main`, and the account name is in the
history already — adding to it helps nobody. The *shape* is the finding, and the
shape is preserved.

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
