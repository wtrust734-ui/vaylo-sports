# iPhone / Apple — hidden, and how to unhide it

**Status: hidden.** Nothing in the app or on the website presents Apple as a
platform. The instruction that opens this up is *"I'm bringing it to iPhone."*

Two mechanisms do the hiding, which matters because they are undone
differently:

| What | How it is hidden | How it comes back |
|---|---|---|
| The app (HealthKit card, iPhone copy, Continue with Apple, hub copy) | `iphone` flag, default **off** | Flip the flag — one boolean |
| The website and the published legal documents | The text was edited to be accurate | Restore the text with the commands in §3 |

## 1. What the flag hides (app)

`src/config/featureFlags.ts` → `iphone: envOverride("iphone", false)`.

With the flag off:

* **Wearables** (`src/pages/HealthSync.tsx`) — no Apple Health card, the intro
  no longer lists Apple among the brands, the Health Connect hint says
  "Health Connect runs on an Android device" instead of pointing at iPhone, and
  the Android-only notice no longer says an Apple Watch syncs automatically.
* **Sign in** (`src/pages/Auth.tsx`) — "Continue with Apple" does not render,
  even if the Supabase project has the Apple provider enabled.
* **Recover hub** (`src/i18n/locales/*/index.json`, 12 languages) — the
  wearables tile no longer names Apple.
* **Strava copy** (`src/lib/health/providers.ts`) — its description no longer
  lists Apple among the watches it connects.

`src/lib/appleHidden.test.ts` asserts each of these, and
`src/config/featureFlags.test.ts` asserts the flag ships off.

## 2. Flip the switch

```ts
// src/config/featureFlags.ts
iphone: envOverride("iphone", true),
```

That alone restores every Apple surface in the app. Then run the gates —
`src/lib/appleHidden.test.ts` and the `featureFlags.test.ts` case
"keeps every iPhone surface off" **will fail**, and each failure is a decision
to make rather than a test to delete: confirm the surface it names is the one
you meant to publish, and update the assertion to match the new truth.

## 3. Restore the website and legal copy (not flag-gated)

A published policy cannot sit behind a feature flag, so these were edited for
accuracy and must be edited back. Each is a literal restore.

**Locales — put the word back in 12 languages:**

```bash
node -e '
const fs=require("fs"),path=require("path");
const base="src/i18n/locales";
for (const d of fs.readdirSync(base)) {
  const f=path.join(base,d,"index.json");
  if(!fs.existsSync(f)) continue;
  const s=fs.readFileSync(f,"utf8");
  const out=s.split("Garmin & more").join("Garmin, Apple & more");
  if(out!==s) fs.writeFileSync(f,out);
}'
```

**Website** — `site/pages/privacy.mjs`:

* advertising section: restore `and we do not read Apple's IDFA` to the
  "does not read Google's Advertising ID" sentence;
* the processor table row: `<strong>Discord, Facebook</strong>` →
  `<strong>Apple, Discord, Facebook</strong>`.
* ~~`site/data/app-preview.mjs`~~ — that file no longer exists: the whole
  app-preview subsystem (the /app/ pages) was deleted from the main website on
  2026-10-07, so there is no preview note to restore.

**README.md** → `email/password plus Google OAuth` → `Google & Apple OAuth`.

**Legal** (published documents — bump the version and date on the line that
already reads `Version 1.2 · 7 October 2026`):

* `legal/advertising.html` — restore `and we do not read Apple's IDFA` in the
  "No advertising identifiers" bullet, and `Apple, Discord, Facebook` in the
  processor table.
* `legal/cookies.html` — `Signing in with Google, Facebook or Discord` →
  `Google, Apple, Facebook or Discord`.
* Then regenerate and redeploy: `node scripts/gen-legal-pages.cjs`, then
  `npx supabase functions deploy legal --use-api`.
  `src/lib/legalPages.test.ts` fails if the embedded copy and `legal/*.html`
  disagree.

**Strava copy** — `src/lib/health/providers.ts`, the `strava` entry: add
`Apple, ` back inside the watch list.

## 4. What is deliberately NOT hidden, and why

These stay as they are; they are not claims about Apple and changing them
would either break rendering or remove plumbing the Android build uses:

* `-apple-system` font stacks (every CSS block and all 27 legal pages) and
  `<link rel="apple-touch-icon">` — invisible, and Android falls back to that
  icon when it finds nothing better.
* `isIOS()` and the Capacitor `ios:` block — both inert while there is no
  `ios/` project.
* The `platform` column on `push_tokens` (`'android' | 'ios' | 'web'`) — schema,
  already shipped.
* The re-authenticate-with-Apple path in `DeleteAccount.tsx` — it exists so an
  Apple-signed-in account can still delete itself; unreachable while no such
  account can be created.
* The `healthkit` entry in `WEARABLE_PROVIDERS` and `"Apple Health"` in
  `importHistory.ts` — data for a card that does not render, looked up by an id
  no client can write.

## 5. What an iPhone launch still needs (unhiding is not launching)

Unhiding the copy is the smallest part of it:

1. `npx cap add ios` plus a Mac and Xcode — there is no `ios/` project today
   (see `CAPACITOR.md`).
2. HealthKit: entitlement, permission strings, and a Capacitor bridge — the
   card currently says "available inside the iOS build" because nothing backs it.
3. Sign in with Apple: capability in Xcode, the Apple service ID in Supabase,
   and `scripts/check-auth-config.ps1` passing for `apple`.
4. **Billing.** Apple requires In-App Purchase for digital goods and takes
   15–30%. The current model assumes Google Play Billing and a credit wallet;
   `PAYMENT_MODE=store` verification would need the App Store Server API
   alongside Play. Coach plan purchases and credit packs both sit on this.
5. Store listing, App Privacy label (must match `legal/privacy.html`),
   screenshots, and the age rating questionnaire.
6. The purchase/refund disclosures in `legal/purchases.html` and
   `legal/refunds.html` currently name Google Play; they need an iOS equivalent
   before anything is sold there.
