# Turning VAYLO Sports into a mobile app (Capacitor)

The app is **not converted yet** — this is the runbook, plus an inventory of the
preparation that is already in the codebase so the conversion is configuration
rather than surgery.

---

## 1. What is already in place

| Area | Where | State |
|---|---|---|
| Safe areas | `index.html` (`viewport-fit=cover`), `safe-b`/`safe-t` spacing tokens, `BottomSheet` | Done |
| App shell identity | `capacitor.config.ts` | Done (inert until the CLI exists) |
| Relative asset base | `vite.config.ts` → `VITE_BASE` | Done |
| Platform detection | `src/lib/platform.ts` (`isNative`, `getPlatform`, `loadPlugin`, `openExternal`) | Done, no-ops on web |
| Haptics | `src/lib/haptics.ts` | Done, falls back to `navigator.vibrate` |
| Billing seam | `src/lib/billing.ts` (`purchaseItems`) | Done — web path live, store path stubbed |
| Purchase idempotency | `provider_reference` + unique index (migration `20260921090600_iap_readiness.sql`), `process-purchase` | Done |
| Receipt verification hook | `process-purchase` → `verifyStorePurchase()` | Structure done, store verifier deliberately **not** implemented |
| Router | `src/App.tsx` → `HashRouter` when native, `BrowserRouter` on web | Done |
| Device back button | `src/lib/platform.ts` (`isNativeShell`), `src/lib/backButton.ts`, `src/hooks/use-back-handler.ts`, `NativeBackButton` in `App.tsx` | Done — closes overlays, then history back, then backgrounds the app |
| Sharing + public links | `src/lib/share.ts` (`shareContent`, `publicAppUrl`, `authRedirectUrl`) | Done — native Share plugin → Web Share → clipboard; never shares a `capacitor://` link |
| Public URL config | `VITE_PUBLIC_APP_URL` (see §2) | Needed before shipping native |
| Account deletion (store requirement) | `supabase/functions/delete-account` | Done |

Deliberately **not** done: no Capacitor packages installed, no store receipt
verification, no push notifications, no wearable sync.

---

## 2. Creating the shell

```bash
npm i @capacitor/core @capacitor/cli
npm i @capacitor/app @capacitor/status-bar @capacitor/splash-screen \
      @capacitor/keyboard @capacitor/haptics @capacitor/browser

npx cap add ios       # needs Xcode
npx cap add android   # needs Android Studio

npm run build:native  # emits relative asset paths for the bundle
npx cap sync
npx cap open ios             # or: npx cap open android
```

`capacitor.config.ts` already declares the app id (`com.vaylosports.app`), name,
`webDir: dist`, the dark status bar and keyboard behaviour.

**Environment:** `.env.example` lists every variable the app and the edge
functions read, including which ones are secrets that belong in
`supabase secrets set` rather than the bundle. `.gitignore` drops `.env` and
`.env.*` (keeping the example) so nothing secret gets committed when this project
goes into Git.

**Before shipping the native build, set the public URL** so shared links, referral
links and auth emails point at the real site instead of the WebView origin:

```bash
# .env.native — picked up automatically by `npm run build:native` (mode=native)
VITE_PUBLIC_APP_URL=https://<your-domain>
```

On the web this is unnecessary — `publicAppUrl()` falls back to
`window.location.origin`, which is what the app already used.

**Two small edits at conversion time:**

1. `capacitor.config.ts` imports `CapacitorConfig` from `@capacitor/cli`, so add
   it to the `include` array of `tsconfig.node.json` once the CLI is installed —
   until then the file is intentionally outside typechecking (it is inert, and
   nothing imports it).
2. Add the sync shortcuts to `package.json` (see §6).

### Router note
Inside the shell the app is served as a local bundle, so a refresh or deep link
on `/training` has no server to fall back to. `App.tsx` therefore swaps to
`HashRouter` when the shell is detected. Web keeps clean URLs. Detection uses
`isNativeShell()` (`src/lib/platform.ts`), which checks the injected Capacitor
bridge and falls back to URL/user-agent sniffing, so it is correct even if the
bridge is injected after the app scripts.

### Back button
`NativeBackButton` (in `App.tsx`) listens for Capacitor's `backButton` event:
open overlays win first (every `BottomSheet` claims the press through
`useBackHandler`), then in-app history, and at a root screen the app is sent to
the background rather than killed. Nothing here imports Capacitor, so the web
build is unaffected.

### Plugins and what they replace
| Plugin | Use |
|---|---|
| `@capacitor/app` | Android hardware back button, app state (pause/resume timers) |
| `@capacitor/status-bar`, `@capacitor/splash-screen` | Configured in `capacitor.config.ts` |
| `@capacitor/keyboard` | Form inputs above the keyboard |
| `@capacitor/haptics` | Already wired via `src/lib/haptics.ts` — installing it is all that is needed |
| `@capacitor/browser` | External links via `openExternal()` in `src/lib/platform.ts` |
| `@capacitor/share` | Already wired via `src/lib/share.ts` — installing it upgrades share/invite to the native sheet |
| `@capacitor/preferences` | Optional: move the 9 `localStorage` caches to native storage |

---

## 3. Store billing — Google Play Billing (the part store review will test)

Google requires digital goods — credits, coins, unlocks — to be sold through
Play Billing in the Android app. The server-side verifier is now implemented
(`supabase/functions/_shared/playBilling.ts`, wired into `process-purchase`);
what remains is Play Console setup, the Capacitor plugin, and secrets.

1. **Create the in-app products** in Google Play Console → Monetize → Products,
   using the exact product ids from `supabase/functions/_shared/moneyCatalog.ts`
   (`pack_25`…`pack_500`, `coins_120`…`coins_5000`, `coins_first`,
   `infinite_lifetime`, `infinite_monthly`, `infinite_yearly`). One-time
   products only — there are no Play subscriptions in this model.

2. **Link a service account** for the Play Developer API:
   - Google Cloud Console → create a service account, download the JSON key.
   - Play Console → Users and permissions → invite the service account's email
     with **View app information** + **View financial data** + **Manage orders
     and refunds** (or the "Android Developer" API access preset), and link it
     in API access.
   - Note the app id: `com.vaylosports.app` (matches `appId` in
     `capacitor.config.ts`).

3. **Set the server secrets** (they go to Supabase, not the app bundle):
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
   supabase secrets set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   supabase secrets set GOOGLE_ANDROID_PACKAGE_NAME=com.vaylosports.app
   ```
   The private key keeps its literal `\n` sequences.

4. **Install the Capacitor Play Billing plugin**, e.g.
   `@capacitor-community/in-app-purchases` or RevenueCat, and make its purchase
   call resolve to the shape `storeProvider` in `src/lib/billing.ts` already
   consumes: `transactionId` = the Play **purchase token**, `receipt` = a JSON
   string `{ "packageName": "com.vaylosports.app", "productId": "pack_120" }`.
   No other client change is needed.

5. **Set `STORE_BILLING_ENABLED = true`** in `src/lib/billing.ts`.

6. **Switch the server on and redeploy the function:**
   ```bash
   supabase secrets set PAYMENT_MODE=store
   supabase functions deploy process-purchase
   ```
   In store mode nothing is granted until Google answers `purchaseState=0`
   for the token, the purchase's productId exists in the money catalog, and
   the productId matches what was in the basket. Pending and refunded
   purchases are refused with a clear message. If the three `GOOGLE_*`
   secrets are missing, `process-purchase` returns 503 instead of granting on
   trust — by design.

7. **Restore purchases is wired.** `AccountSubscriptionCard` shows a
   "Restore purchases" button as soon as store billing is active (it is hidden
   on the web build) and calls `restorePurchases()` in `src/lib/billing.ts`.
   Play replays the purchase tokens — the **server** still re-verifies each
   one through `verifyStorePurchase()`, so restoring is not a trust shortcut.

8. **Replay safety** is handled: the Play purchase token is stored on
   `user_purchases.provider_reference` with a unique index, so a retried
   delivery returns `409 duplicate` instead of granting twice.

9. **Test it** with Play license testers before release: their purchases flow
   through the same verification (purchaseType is not filtered), so a
   license-tester purchase that grants credits end-to-end is proof the
   production path works. Billing must also be configured in Play Console
   (merchant account) before test purchases work at all.

Web checkout keeps working unchanged in the browser build (`PAYMENT_MODE=test`).

---

## 4. Authentication and deep links

- Email/password sessions persist in the WebView's storage, so sign-in survives
  app restarts.
- Google/Apple sign-in and password reset use `authRedirectUrl()`, which prefers
  `VITE_PUBLIC_APP_URL`. Inside the shell that means the flow completes on the
  live site rather than returning into the app.
- **To return into the app after OAuth** (conversion-time work): add a URL scheme
  to the native projects (e.g. `com.vaylosports.app://auth`), register it in
  Supabase → Authentication → URL Configuration, pass it as `redirectTo`, and
  handle Capacitor's `appUrlOpen` event to exchange the session. `authRedirectUrl()`
  is the single place to switch that over.
- Supabase's anon key is public by design; no secrets belong in the client.

---

## 5. Store review checklist

- [ ] Account deletion exists in-app (already implemented — `delete-account`) — required by Google
- [ ] Restore purchases (see §3.7)
- [ ] Play Billing: in-app products created, service account linked, `PAYMENT_MODE=store` verified with a license-tester purchase (see §3)
- [ ] Privacy policy + data-safety disclosures (health/training data)
- [ ] Subscription terms and renewal wording if unlimited plans are sold
- [ ] No external payment links for digital goods
- [ ] Test on a real device: notch layout, keyboard covering inputs, back button,
      purchase → grant → balance refresh, offline behaviour

---

## 6. Suggested `package.json` scripts

`build:native` already exists (`vite build --mode native`, which emits a relative
base — see `vite.config.ts`). Add the Capacitor shortcuts at conversion time:

```json
{
  "cap:sync": "npm run build:native && npx cap sync",
  "cap:ios": "npm run cap:sync && npx cap open ios",
  "cap:android": "npm run cap:sync && npx cap open android"
}
```

---

## 7. Mobile shell layout notes

The shell assumes the device insets, which are `0` in a browser (so the web
layout is unaffected):

- `AppLayout` pads page content with `pt-safe-t`; the fixed menu and
  streak/credits clusters in `AppSidebar` offset by
  `calc(env(safe-area-inset-top) + 1rem)`; `OfflineBanner` adds `pt-safe-t`.
- The bottom edge belongs to one bar at a time: `BottomNav` on phones
  (`lg:hidden`), the floating `QuickCommandBar` above `lg` (`hidden lg:block`).
  Rendering both stacked them on top of each other on phones.
- Full-height bottom bars (e.g. the Coach message input) use the `tab` spacing
  token so they sit above the tab bar and drop back to the screen edge at `lg`.
- `BottomSheet` and the tab bar both respect `env(safe-area-inset-bottom)`.

## 8. Known gaps to accept before shipping native

- **No wearable sync.** Google Fit is conceptual only; nothing is implemented.
- **No push notifications.** Any session reminders are in-app only.
- **Route transitions** are per-page rather than native-feeling; the shared
  motion tokens in `src/lib/motion.ts` make that a later polish pass.
- **Nine `localStorage` caches** (offline drafts, health-sync flags) work in a
  WebView but can be evicted by the OS under storage pressure — migrating them to
  `@capacitor/preferences` is the durable fix.
