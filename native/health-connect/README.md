# Vaylo × Health Connect — native Android plugin

Minimal custom Capacitor plugin (deliberately no third-party dependency). This
directory is the **single source of truth** for the native layer; it is merged
into the generated `android/` project when CAPACITOR.md's runbook is executed
(`npm i -D @capacitor/cli @capacitor/core @capacitor/android && npx cap add android`).

## Files

| File | Merged into |
|---|---|
| `src/main/java/com/vaylosports/app/health/HealthConnectPlugin.kt` | `android/app/src/main/java/com/vaylosports/app/health/` |
| `src/main/java/com/vaylosports/app/health/HealthPermissions.kt` | `android/app/src/main/java/com/vaylosports/app/health/` |
| `AndroidManifest Health Connect intent-filters` | `android/app/src/main/AndroidManifest.xml` (see §Manifest) |
| `gradle dependency` | `android/app/build.gradle` (see §Dependency) |

The plugin is **isolated**: the entire Health Connect surface lives in the
`com.vaylosports.app.health` package. Removing Health Connect later = delete the
package + manifest intent filters + the one JS bridge file. Nothing else in the
app references Health Connect directly.

## Dependency

`android/app/build.gradle`:

```gradle
dependencies {
    // ...existing entries...
    implementation("androidx.health.connect:connect-client:1.1.0-alpha07")
}
```

## Manifest

`android/app/src/main/AndroidManifest.xml` — inside `<manifest>` (before `<application>`):

```xml
<uses-permission android:name="android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND" />
```

and inside `<application>`:

```xml
<!-- Health Connect permissions rationale (Play requirement) -->
<activity
    android:name="androidx.health.connect.client.permission.HealthDataRequestPermissionsActivity"
    dialogTheme="@style/Theme.Vaylo"
    ... />
```

Simpler and sufficient for Phase 1: declare the legacy permissions in the
manifest and request them at runtime via `PermissionController.createRequestPermissionResultContract()`
(what `HealthPermissions.kt` + the plugin do). Declare the privacy policy URL in
the Play Console, and add the Health Connect declaration in Play Console
(Play Console → App content → Health Connect declaration) before release.

## JS ↔ Native contract

The web layer (`src/lib/health/bridge.ts`) loads the plugin by the name
`VayloHealthConnect` and calls:

| Method | Args | Returns |
|---|---|---|
| `isAvailable()` | — | `{ available: boolean }` |
| `checkPermissions()` | — | `{ granted: string[], denied: string, missing: string[] }` |
| `requestPermissions()` | — | `{ granted: string[], denied: string[] }` | 
| `openHealthConnectSettings()` | — | `{ opened: boolean }` (also used for install intent) | 
| `syncPull()` | `{ sinceMs?: number | null, limit?: number }` | `{ workouts: …, samples: …, latestCursorMs: number | null, hasMore: boolean } | 
| `hasPartialPermissions()` | — | `{ partial: boolean }` |

`syncPull` returns **normalized data only** (units: meters/seconds/kcal/bpm/count;
ISO-8601-UTC in JSON). The native layer does the Health Connect SDK mapping;
the JS layer never sees Health Connect types.
