# Security Review — Health Connect Native Plugin (MDF-006)

**Reviewer:** mobile security review, 20 October 2026 · **Mode:** read-only review, no code modified
**Scope:** all native Health Connect code, its manifest surface, build configuration and backup policy
**Verdict: no Critical or High findings. Two Medium findings (one data-integrity, one documentation drift). Ship-compatible with the recommendations below, which are code items, not legal ones.**

---

## 1. Scope and method

| Surface | Files reviewed |
|---|---|
| Health Connect plugin | `android/app/src/main/java/com/vaylosports/app/health/HealthConnectPlugin.kt` (324 lines, read in full) |
| Permission set | `android/app/src/main/java/com/vaylosports/app/health/HealthPermissions.kt` |
| Manifest | `android/app/src/main/AndroidManifest.xml` |
| Obfuscation | `android/app/proguard-rules.pro`, `android/app/build.gradle` (buildTypes, signing) |
| Backup policy | `res/xml/data_extraction_rules.xml`, `res/xml/full_backup_content.xml`, `res/xml/file_paths.xml` |
| Doc contract | `native/health-connect/README.md`, cross-checked against `src/lib/health/bridge.ts` |
| Adjacent (contrast) | `CameraCapturePlugin.kt` (FileProvider grant pattern), push service registration |

Method: full-source read of every file above, plus targeted greps to verify negative claims (no logging, no storage, no network in the health package). The JS layer (`src/lib/health/*`) was reviewed separately and is outside this report except where the native/JS contract meets it.

## 2. Verified strengths (each confirmed in source, not assumed)

1. **Read-only, minimal permission set.** Six permissions (`READ_EXERCISE`, `READ_DISTANCE`, `READ_TOTAL_CALORIES_BURNED`, `READ_HEART_RATE`, `READ_STEPS`, `READ_SLEEP`), consistent across the three places that must agree (`HealthPermissions.kt`, `AndroidManifest.xml`, `src/lib/health/permissions.ts`), versioned (`VERSION = 1`) so an added type surfaces as *explicit re-consent* rather than a silent re-prompt. No write permission exists anywhere in the manifest, and `scripts/build-apk.sh` fails the release build if one is introduced (manifest comment).
2. **No background read.** The manifest omits `READ_HEALTH_DATA_IN_BACKGROUND`; sync is pull-based (`syncPull`), triggered by the athlete, with an incremental cursor. No polling, no jobs, no service holds Health Connect access.
3. **No health data touches logs.** Grep over the entire `health/` package: the only `Log` call in the codebase path is `Log.w("VayloHealth", "syncPull failed: ${e.javaClass.simpleName}")` — failure *class name* only. No `Log.` calls that touch records, titles or timestamps.
4. **No native persistence and no networking.** Zero `SharedPreferences`, file, or HTTP usage in the package; normalized data flows to the JS bridge and nowhere else on-device.
5. **Permission state re-verified per sync.** `syncPull` re-reads `getGrantedPermissions()` every call and maps revocation or `SecurityException` to a clean `permission_revoked` rejection; aggregate reads are individually gated on the exact per-type grant before touching that record type.
6. **Bridge surface is app-internal.** Capacitor binds `@PluginMethod` members over the in-app WebView bridge; there is no exported endpoint, service, receiver or intent-filter that reaches `HealthConnectPlugin`. Third-party apps cannot invoke it.
7. **Permission contract flows through a real `ActivityResultLauncher`** (`@ActivityCallback`), parsed by `Health Connect`'s own result contract — no hand-rolled resultCode parsing, no spoofable requestCode path.
8. **Data-at-rest posture is good for a health app.** `allowBackup="false"` plus *complete* exclusions in both `data_extraction_rules.xml` (API 31+, cloud-backup **and** device-transfer) and `full_backup_content.xml` (API ≤30). Cached health data and the WebView session cannot be exported to Drive or D2D-migrated.
9. **Build hardening.** R8 + resource shrinking enabled for release with targeted keeps (annotated Capacitor surface, Health Connect client, coroutine metadata); `bundleRelease` hard-fails without the upload key; local `assembleRelease` debug-signing is explicitly labelled non-uploadable. Manifest `<queries>` entries are scoped to Health Connect and the camera/document intents actually used.
10. **Exported components check.** `MainActivity` (launcher, plus the Health Connect rationale filter and the app-scheme VIEW filter) and `ViewPermissionUsageActivity` (guarded by the platform-held `START_VIEW_PERMISSION_USAGE` permission — standard Android 14 pattern); `VayloMessagingService` is `exported="false"`; `FileProvider` is `exported="false"` with `grantUriPermissions`.

## 3. Findings

### M-1 (Medium — data integrity, not confidentiality): pagination beyond `limit` is unreachable, and the cursor can skip it

`syncPull` reads exactly one page per record type (`pageSize = limit`, coerced 1–500), sets `hasMore` from `resp.pageToken != null`, but **does not expose the `pageToken` to the JS contract**, and the next call's `sinceMs` is the max record end-time of the records actually returned. If more than `limit` records fall inside a sync window, the excess records on page 2 are never sent; whether the next `sinceMs` skips them depends on the SDK's undocumented record ordering:

- If ordering is such that page 1 contains the *oldest* records, the newer unsynced ones end after the returned max-end and the next pull recovers them — data delayed, not lost.
- If any page-2 record's end time is *≤* the returned max-end (possible with out-of-order or descending results), it is silently skipped by the cursor and never re-sent until a deliberate full resync.

Impact: **silent incompleteness of a user's health history** — an integrity risk the athlete cannot detect, for a feature whose whole job is "sync my wearable". Not secrecy, so not High.

Recommendation (code item, not in this review):
1. Have `syncPull` accept and echo the `pageToken`, and have the JS sync loop `while (hasMore) { pageToken }` per record type; or
2. Return per-type cursors and pull pages until `pageToken == null` inside one native call (bounded by a hard cap); and
3. Add a JS-side dedupe on `sourceRecordId` regardless — see L-1.

Test note: the correctness edge to cover is a window containing `limit + 1` records with non-monotonic end times.

### M-2 (Medium — documentation drift, low exploitability): `native/health-connect/README.md` no longer describes the shipped implementation

The README — which declares itself the "single source of truth" merged by the runbook — includes a manifest draft with `READ_HEALTH_DATA_IN_BACKGROUND` (a permission the shipped manifest deliberately omits and the Play declaration does not cover), an `HealthDataRequestPermissionsActivity` application entry that is not present, and a JS↔Native method table whose names (`checkPermissions`, `requestPermissions`, `hasPartialPermissions`) do not match the implemented methods (`checkPermissionsStatus`, `requestPermissionsStatus`, partial state inside `checkPermissionsStatus`). Anyone following the README after a `cap add android` would **re-introduce the background permission and a dependency mismatch**. No runtime code follows this file today, hence Medium, not High.

Recommendation: rewrite README's §Manifest and §JS ↔ Native contract to match `HealthConnectPlugin.kt` verbatim (same three-way consistency asserted for permissions belongs here), and delete the background-permission draft — or state explicitly that it was rejected and why.

### L-1 (Low — integrity, mitigated): cursor uses *overlap* semantics; re-delivery is possible

`TimeRangeFilter.between(sinceMs, now)` matches records that **overlap** the window, not records that *end within* it. A workout that started before the cursor and finished after is re-emitted on the following sync even though its end time was already seen. Bounded (each record re-sent at most once past the boundary) but the JS layer must dedupe by `sourceRecordId`, which also protects against M-1's re-delivery. Recommendation: dedupe as part of the M-1 fix; no native change required.

### L-2 (Low — lifecycle): `hcScope` is never cancelled and serialises nothing

`CoroutineScope(SupervisorJob() + Dispatchers.IO)` lives as long as the plugin instance. Consequences are all minor but worth one deliberate decision: (a) a result can resolve into a WebView that has already torn down during configuration change — Capacitor re-delivers to the new bridge, so the user-visible effect is a duplicate resolve, not a lost one; (b) nothing stops a JS bug from enqueueing many concurrent syncs, each doing up to 6 SDK reads. Recommendation: accept and document, or bound concurrency with a `Semaphore(1)`; do not cancel the scope in `handleOnDestroy` without also failing pending calls.

### L-3 (Low — adjacent, out of health scope): FileProvider grants are broad

`file_paths.xml` exposes `external-path` at `path="."` and `cache-path` at `path="."`. Grants are per-URI, only ever handed to the resolved camera (WriteCapture ACTION_IMAGE_CAPTURE) — the same residual pattern every Capacitor camera template ships — but shrinking the external-path root to the actual photo subdirectory would cut what a buggy or malicious camera app could write back. No health data flows through it.

### L-4 (Info): `openHealthConnectSettings` fallbacks are fail-closed

The deep link targets the Health Connect package explicitly; on failure it falls back to the Play store listing, then resolves `opened: false`. No implicit intents to arbitrary handlers, no chooser injection surface.

### I-1 (Info — operational, not code): Play Health Connect declaration must be maintained

The manifest comment already requires it (Play Console → App content → Health Connect declaration); this review adds: keep the declaration, `HealthPermissions.kt`, and the manifest in lock-step — any added permission that is declared without a live Play covering will get an install-time or review-time rejection. This is a release-process item, already tracked in `PLAY_STORE.md`.

## 4. Things checked and passed clean

| Check | Result |
|---|---|
| Health data in `Log` output | None (`simpleName` class-failure only) |
| Health data in SharedPreferences / files / clipboard | None — plugin writes nothing to disk |
| Network transmission from native health code | None — all egress is the JS layer's established Supabase path |
| Debug-garbled release behaviour | `debuggable` is not setCleared on release; R8/shrink on; debug-key release only via explicit local fallback with bundleRelease blocked |
| Intent handling (external reachability) | Plugin unreachable externally; manifest filters are launcher/rationale/app-scheme only |
| Exported components unauthorised use | Only standard platform-guarded surfaces (START_VIEW_PERMISSION_USAGE) |
| Cleartext traffic | Not enabled (default-false on targetSdk); INTERNET is the only non-health permission |
| ProGuard rules | Targeted keeps only, matching reflective surfaces; `-dontwarn` limited to the libraries the keeps reference; no blanket `-keep class *` |
| Tamper-proofing of permission list | `HealthPermissions.VERSION` + JS-stored consent version → forced re-consent on set expansion (verified in `bridge.ts` usage) |

## 5. Verdict for MDF-006

**The native Health Connect surface is sound.** Permission minimisation, the versioned-consent pattern, the no-log/no-persist/no-network triad, per-sync grant re-verification, and the backup-exclusion posture are all implemented and *verified in source*, which is stronger than the codebase's own audit trail claimed (the earlier audits flagged this surface "unreviewed"; there is nothing review-blocking underneath).

Before calling MDF-006 closed: fix or consciously accept **M-1** (it is the only finding that can silently affect a user), fix the **M-2** README so the runbook merge remains safe, and decide on **L-2**. None of the three blocks a Play upload; M-1 blocks *correctness of the sync feature*, not security.
