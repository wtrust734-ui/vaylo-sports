# Health Sync is a hub page, not a standalone route

`/health-sync` hung from the old single-page router and was never re-wired after
the hub transition. It is now reachable in two healthy ways and nowhere else:

- Bottom nav → **Wearables** (hub `/recover`) → Health Connect / wearable tiles
- Sidebar → **Wearables** row (hub `/recover`)

Hub render path: `src/components/layout/HubPage.tsx#L41` via
`src/lib/personalization/nav.ts` `NAVS.healthSync` (label key `dashboard.healthSync`).
The route binding is `src/App.tsx#L143` (`/:hubId` → `HubPage`). The only standalone
route binding for `/health-sync` (`src/App.tsx#L107`) is commented out and is not
reactivated.

## Effective roadmap item

The live flag from the plan-review context is the page title/copy, not a feature
launch. As of this write it is

```
Connecting a wearable — in active development
```

with

```
Wearable connection hub. Choose how to bring your training into Vaylo.
```

Both are in `src/pages/HealthSync.tsx` (title link + `editableCopy` helpers). The
route breadcrumb marker around `src/pages/HealthSync.tsx#L306-L330` is kept as a
title so a hero card can be swapped in later without an error boundary change.

## What is wired and what is not

Wired, usable where the underlying platform supports it:

- Health Connect tile: permission check → request → import runs + recent sessions
- Cloud wearable tiles (Strava, Garmin, Fitbit, Oura, WHOOP, Polar, Suunto, COROS):
  consent status / handshake progress shown, connect/revoke buttons routed through
  `oauthStart` / `oauthDisconnect`
- Import-run history list (`loadImportRuns`) and history-import launches
  (`requestHistoryImport`) on the metro section
- OAuth redirect parsing (`parseWearableRedirect`) on page load

Not wired because the providers are inactive per the legal posture:

- No provider activation, no per-provider feature gating, no PKCE/minteal flow
  wired to a live endpoint
- The strings `Strava`, `Garmin`, `Fitbit`, `Oura`, `WHOOP`, `Polar`, `Suunto`,
  `COROS` remain as legend/labels, not as live consent flows

## Android-native stubs

`native/health-connect/README.md` already describes the Health Connect plugin
surface. The app-side shape is `src/lib/health/bridge.ts` → `loadHealthBridge()`.
The native plugin file `android/app/src/main/java/com/vaylosports/app/health/HealthConnectPlugin.kt`
is the agreed contract hook; the bridge layer is thin and platform-aware.

## Related artifacts

- Backend consent + redirect handling: `supabase/functions/wearable-oauth/index.ts`
  and `supabase/functions/wearable-oauth/providers.ts`
- Connection-state helpers: `src/lib/health/connections.ts`
  (`fetchWearableConnections`, `isProviderConnected`, `connectedProviders`)
- Provider definitions: `src/lib/health/providers.ts` (`WEARABLE_ORDER`,
  `CLOUD_PROVIDERS`, `NATIVE_PROVIDERS`)
- Legal posture that keeps this off by default: `legal/health-safety.html`
  and `legal/privacy.html` wearable rows
- DEPLOY_NOTES wearable/pre-launch section: `supabase/DEPLOY_NOTES.md`
