# VAYLO Sports on Android (Capacitor)

The app **ships as an Android build now**. `android/` is a tracked, generated
Capacitor project, `npm run build:native` emits the bundle it loads, and CI
(`.github/workflows/android-debug.yml`) typechecks, lints, tests and assembles a
debug APK on every push to `main`. This document is the runbook for working with
that shell, plus what is wired and what is still open.

---

## 1. What is in place

| Area | Where | State |
|---|---|---|
| Android project | `android/` (tracked; Gradle wrapper included) | Working — CI builds `app-debug.apk` |
| App shell identity | `capacitor.config.ts` (`appId` `com.vaylosports.app`, `appName` `VAYLO Sports`, `webDir` `dist`) | Done — typechecked by `tsconfig.node.json` |
| Native bundle | `npm run build:native` → Vite `--mode native`, base `./` | Done |
| Relative asset base | `vite.config.ts` → `VITE_BASE` | Done |
| Platform detection | `src/lib/platform.ts` (`isNative`, `isNativeShell`, `getPlatform`, `openExternal`) | Done — degrades to web behaviour outside the shell |
| Plugin registry | `src/lib/platform.ts` (`loadPlugin`) | Done — see "Loading a plugin" below |
| Installed plugins | `@capacitor/{app,browser,haptics,keyboard,share,splash-screen,status-bar}` | 7, all registered natively by `npx cap sync android` |
| Custom native plugin | `android/.../health/HealthConnectPlugin.kt` as `VayloHealthConnect` | Done — proxied from JS |
| Health Connect sync | `src/lib/health/*` | Done on Android; needs no secrets |
| Safe areas | `index.html` (`viewport-fit=cover`), `safe-b`/`safe-t` tokens, `BottomSheet` | Done |
| Haptics | `src/lib/haptics.ts` | Done — native plugin → `navigator.vibrate` |
| Sharing + public links | `src/lib/share.ts` (`shareContent`, `publicAppUrl`, `authRedirectUrl`) | Done — never shares a `capacitor://` link |
| Deep links / OAuth return | manifest `VIEW`/`BROWSABLE` filter + `src/lib/nativeOAuth.ts` | Done — see §4 |
| Router | `src/App.tsx` → `HashRouter` when native, `BrowserRouter` on web | Done |
| Device back button | `src/lib/platform.ts`, `src/lib/backButton.ts`, `use-back-handler`, `NativeBackButton` | Done — overlays first, then history, then background |
| Billing seam | `src/lib/billing.ts` (`purchaseItems`) | Web path live; store path awaits a Play Billing plugin (§3) |
| Receipt verification | `supabase/functions/_shared/playBilling.ts` → `process-purchase` | Implemented; needs Play secrets |
| Purchase idempotency | `user_purchases.provider_reference` + unique index | Done |
| Account deletion (store requirement) | `supabase/functions/delete-account` | Done |
| Session durability | WebView storage, `persistSession: true` | Done — and excluded from backup/D2D transfer |

Deliberately **not** done: no push notifications, no iOS project (the `ios`
block in `capacitor.config.ts` is intent, not a build), no release signing.

### Loading a plugin

Every native call goes through `loadPlugin(name)` in `src/lib/platform.ts`, which
returns the plugin or `null` so callers fall back to web behaviour. Two things
about it are easy to get wrong and are therefore pinned by
`src/lib/platformPlugins.test.ts`:

1. **The imports must be static.** They live in an explicit registry keyed by
   short name (`"app"`, `"haptics"`, `"VayloHealthConnect"`, …). Building the
   specifier at runtime cannot be resolved by any bundler, so the import rejects
   inside the WebView and every plugin silently becomes `null`.
2. **A custom plugin needs a JS proxy.** `MainActivity.registerPlugin` only
   tells the bridge the Kotlin class exists; for a published plugin the npm
   package supplies the proxy, and for `VayloHealthConnect` we call
   `registerPlugin()` ourselves.

Adding a plugin therefore means: install it, add its static import to the
registry, and run `npm run cap:sync`. `npx cap sync android` regenerates
`android/capacitor.settings.gradle` and `android/app/capacitor.build.gradle`,
both of which are tracked and must be committed with the change.

---

## 2. Building the APK

```bash
npm run cap:apk        # build:native → cap sync → gradlew assembleDebug
```

Or step by step:

```bash
npm run build:native      # relative-base bundle in dist/
npx cap sync android      # copies dist/ into android/app/src/main/assets/public
cd android && ./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`.

Notes that have cost time before:

- **`JAVA_HOME`** must point at a JDK 21 install (Android Studio's bundled JBR
  works): `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"`.
- **`android/app/src/main/assets` is gitignored** (by `android/.gitignore`, along
  with `local.properties` and `*.apk`/`*.aab`), so the copied bundle is not
  committed — the APK is regenerated from `dist/` each time. Root `.gitignore`
  covers `dist`, `.env*`, `node_modules`, the Gradle build directories and
  keystores, but **not** the generated project files that `cap sync` rewrites.
- **`gradlew` must stay executable** in git (mode `100755`). The local
  `core.filemode=false` cannot record the bit, so a fresh checkout can land it
  as `100644` and Linux CI then fails instantly with no useful message.
- **Bump `versionCode` and `versionName`** in `android/app/build.gradle` before
  any build you intend to distribute; Play rejects a reused `versionCode`.
- **The `.aab` produced by the debug config is debug-signed** and is not
  Play-uploadable. A release keystore has not been created.

### Working on a device or emulator

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.vaylosports.app/.MainActivity
adb logcat | grep -iE "Capacitor|FATAL|AndroidRuntime"
```

Capacitor logs every JS→native call under the `Capacitor/Plugin` tag, which is
the quickest way to confirm a plugin actually reached the bridge. A deep link can
be simulated without a browser:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "com.vaylosports.app://auth-callback?code=test" com.vaylosports.app
```

---

## 3. Store billing — Google Play Billing (the part store review will test)

Google requires digital goods — credits, coins, unlocks — to be sold through Play
Billing in the Android app. The server-side verifier is implemented
(`supabase/functions/_shared/playBilling.ts`, wired into `process-purchase`); what
remains is Play Console setup, a Capacitor billing plugin, and secrets.

1. **Create the in-app products** in Play Console → Monetize → Products, using
   the exact product ids from `supabase/functions/_shared/moneyCatalog.ts`
   (`pack_25`…`pack_500`, `coins_120`…`coins_5000`, `coins_first`,
   `infinite_lifetime`, `infinite_monthly`, `infinite_yearly`). One-time products
   only — there are no Play subscriptions in this model.

2. **Link a service account** for the Play Developer API:
   - Google Cloud Console → create a service account, download the JSON key.
   - Play Console → Users and permissions → invite the service account's email
     with **View app information** + **View financial data** + **Manage orders
     and refunds**, and link it under API access.
   - The app id is `com.vaylosports.app` (matches `appId` in
     `capacitor.config.ts`; changing it invalidates every OAuth redirect).

3. **Set the server secrets** (Supabase, not the app bundle):
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
   supabase secrets set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   supabase secrets set GOOGLE_ANDROID_PACKAGE_NAME=com.vaylosports.app
   ```
   The private key keeps its literal `\n` sequences.

4. **Install a Capacitor Play Billing plugin** — e.g.
   `@capacitor-community/in-app-purchases` or RevenueCat — add it to the
   `loadPlugin` registry under `in-app-purchases`, and make its purchase call
   resolve to the shape `storeProvider` in `src/lib/billing.ts` already consumes:
   `transactionId` = the Play **purchase token**, `receipt` = a JSON string
   `{ "packageName": "com.vaylosports.app", "productId": "pack_120" }`.

5. **Set `STORE_BILLING_ENABLED = true`** in `src/lib/billing.ts`.

6. **Switch the server on and redeploy the function:**
   ```bash
   supabase secrets set PAYMENT_MODE=store
   supabase functions deploy process-purchase
   ```
   In store mode nothing is granted until Google answers `purchaseState=0` for
   the token, the productId exists in the money catalog, and it matches what was
   in the basket. Pending and refunded purchases are refused with a clear
   message. With the three `GOOGLE_*` secrets missing, `process-purchase` answers
   503 rather than granting on trust — by design.

7. **Restore purchases is wired.** `AccountSubscriptionCard` shows a "Restore
   purchases" button once store billing is active (hidden on web) and calls
   `restorePurchases()` in `src/lib/billing.ts`. Play replays the purchase
   tokens; the **server** re-verifies each one, so restoring is not a trust
   shortcut.

8. **Replay safety** is handled: the Play purchase token is stored on
   `user_purchases.provider_reference` with a unique index, so a retried delivery
   returns `409 duplicate` instead of granting twice.

9. **Test with Play license testers** before release. Their purchases flow
   through the same verification, so a license-tester purchase that grants
   credits end-to-end is proof the production path works. Billing must be
   configured in Play Console (merchant account) before test purchases work.

**Event Packs are bought with credits.** `claim_event_pack` reads identity and
both prices from the `event_packs` table (seeded from `src/config/eventPacks.ts`
via `npm run gen:packs`); nothing the client sends is trusted. A priced pack is
settled either by a verified `user_purchases` row — which only `process-purchase`
can write — or by deducting its `credit_price` from the athlete's balance. A
shortfall comes back as data, not an exception, so the screen opens the top-up
sheet for the exact gap and retries the pack the athlete wanted.

The cash price is retained for the Play Billing launch; a pack is cash-only only
while its `credit_price` is 0. Two deliberate properties worth not undoing:
unlimited subscriptions do **not** cover packs (that entitlement is for metered
AI features, so the charge bypasses `credits_spend()`), and the credits rate is a
single constant in `src/config/eventPacks.ts`. Both are pinned by
`src/lib/eventPackCredits.test.ts`.

---

## 4. Authentication and deep links

- Email/password sessions persist in the WebView's storage, so sign-in survives
  app restarts. That storage is app-private and is excluded from both cloud
  backup and device-to-device transfer (`android:allowBackup="false"`,
  `dataExtractionRules`, `fullBackupContent`) — a Supabase refresh token is a
  bearer credential and must not leave the device.
- **Native OAuth returns into the app.** `src/lib/nativeOAuth.ts` opens the
  provider in the in-app browser and completes when Capacitor fires
  `appUrlOpen` with `com.vaylosports.app://auth-callback#code=…`. Three things
  have to line up, and all three are now in place:
  1. `strings.xml` defines `custom_url_scheme` = `com.vaylosports.app`, and
     `AndroidManifest.xml` has a `VIEW`/`BROWSABLE` intent-filter for it. Without
     the filter Android has no route to hand the URL to the app and the callback
     can never arrive.
  2. GoTrue must allow the redirect: `com.vaylosports.app://auth-callback`,
     `https://localhost` and `capacitor://localhost` are in
     `additional_redirect_urls` in `supabase/config.toml` (pushed with
     `supabase config push`). Any other redirect is rejected.
  3. The `@capacitor/app` plugin has to resolve — the `appUrlOpen` listener lives
     on it (see "Loading a plugin").
- **Password reset and shared links point at the live site**, not the WebView
  origin: `authRedirectUrl()` prefers `VITE_PUBLIC_APP_URL`, which the native
  build reads from `.env.native`. **This is still unset, so those links currently
  point at `localhost`** — set it before launch.
- Supabase's anon key is public by design; no secrets belong in the client.

---

## 5. Store review checklist

- [x] Account deletion exists in-app (`delete-account`) — required by Google
- [ ] Restore purchases verified on device (see §3.7)
- [ ] Play Billing: products created, service account linked, `PAYMENT_MODE=store`
      proven with a license-tester purchase (see §3)
- [ ] Privacy policy + data-safety disclosures (health and training data)
- [ ] Health Connect declaration reviewed — the app reads/writes activity data
- [ ] Subscription terms and renewal wording if unlimited plans are sold
- [ ] No external payment links for digital goods
- [ ] Test on a real device: notch layout, keyboard covering inputs, back button,
      deep-link sign-in, purchase → grant → balance refresh, offline behaviour
- [ ] Release keystore created and the `.aab` signed with it

---

## 6. Scripts

```json
{
  "build:native": "vite build --mode native",
  "cap:sync": "npm run build:native && npx cap sync android",
  "cap:android": "npm run cap:sync && npx cap open android",
  "cap:apk": "npm run cap:sync && cd android && ./gradlew assembleDebug"
}
```

---

## 7. Mobile shell layout notes

The shell assumes device insets, which are `0` in a browser (so the web layout is
unaffected):

- `AppLayout` pads page content with `pt-safe-t`; the fixed menu and
  streak/credits clusters in `AppSidebar` offset by
  `calc(env(safe-area-inset-top) + 1rem)`; `OfflineBanner` adds `pt-safe-t`.
- The bottom edge belongs to one bar at a time: `BottomNav` on phones
  (`lg:hidden`), the floating `QuickCommandBar` above `lg` (`hidden lg:block`).
- Full-height bottom bars (e.g. the Coach message input) use the `tab` spacing
  token so they sit above the tab bar and drop back to the screen edge at `lg`.
- `BottomSheet` and the tab bar both respect `env(safe-area-inset-bottom)`.
- Below 1024px `src/index.css` disables `backdrop-filter` and
  `background-attachment: fixed`, which are the two properties that make the
  glass layout crawl on a phone GPU.

---

## 8. Known gaps to accept before shipping native

- **No push notifications.** Session reminders are in-app only.
- **No iOS project.** `npx cap add ios` plus a Mac is a separate piece of work.
- **Direct vendor wearable OAuth is unconfigured.** `wearable-oauth` answers
  `not_configured` for every vendor until its secrets are set, and the UI says
  "Coming soon — connect via Health Connect in the meantime". Health Connect is
  the path that works today and needs no secrets.
- **Nine `localStorage` caches** (offline drafts, health-sync flags) work in a
  WebView but can be evicted under storage pressure; `@capacitor/preferences` is
  the durable fix.
- **Route transitions** are per-page rather than native-feeling; the shared
  motion tokens in `src/lib/motion.ts` make that a later polish pass.
- **`VITE_PUBLIC_APP_URL` is unset**, so shared links and auth emails still point
  at `localhost`.
