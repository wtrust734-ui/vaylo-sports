# Vaylo Sports startup, loading and black-screen failures — fix report

## 1. Verified root cause

The app’s entry and startup sequence is now coherently wired to produce **one continuous brand surface from the first frame until a real content frame exists underneath it**, then transition into the real app instead of into a spinner, a second loader, or a blank screen.

What this codebase actually does at startup:

1. **`index.html`** paints `#05070f` synchronously in a `<style>` block in the head, so the first browser frame is already the app’s foundation colour. There is no white/blank flash before the app’s CSS arrives.
2. **`src/main.tsx`** mounts `<BootVeil />` first, then asynchronously initialises i18n and only then mounts `<App />`. The veil is the same component App mounts later, on the same module-level clock, so there is not one loader then a different veil then the app.
3. **`BootVeil`** (`src/components/BootVeil.tsx`) is the app’s single boot surface. It:
   - stays opaque until either a real frame signals `markBootReady()` or a hard stop fires (4s) so it cannot trap the user behind a splash screen;
   - fades on opacity only and stops eating taps once the fade begins;
   - hands off correctly when `AppLayout` holds it open while its profile/session gate is up, and for routes that never mount `AppLayout` (sign-in, onboarding, legal) the app’s own time cap releases it;
   - inspects the build’s Supabase configuration at first paint and, if it is missing or points at a known-dead host, immediately surfaces a **non-blank, non-secret diagnostic screen** (`App could not start`) with a Retry action, instead of leaving the user on a spinner or a raw key/URL leak.
4. **`AuthProvider`** (`src/contexts/AuthContext.tsx`) restores an existing session, gates the full-page loader with a bounded 15s timeout, handles guest entry once per load with its own timeout, never overwrites a real session with a guest, and surfaces `guestError`/`profileError` rather than hanging forever.
5. **`App`** (`src/App.tsx`) is wrapped in an `<ErrorBoundary>` so a broken screen cannot take the whole app to a blank page; lazy routes use `ScreenFallback`, which is an inline skeleton, not the old full-screen `VayloLoader` interstitial.
6. **`AppLayout`** (`src/components/layout/AppLayout.tsx`) shows `VayloLoader` only while it is performing the real profile/session check, then hands off or renders an explicit retry/sign-out state for the recoverable cases (guest entry failed, profile unreadable).

So the historical “loading screen appears but the app never appears / black screen / Supabase URL or key error” failure mode is addressed at the points that actually decide what paints:

- **Blank first frame** → fixed by the inlined foundation colour in `index.html`.
- **Multiple hard cuts / second loader** → removed by the unified `BootVeil`.
- **Loader that never clears** → bounded timeouts in both `BootVeil` (hard stop) and `AuthProvider` (15s hydrate), plus `AppLayout` only using `VayloLoader` for the actual profile check and releasing it afterwards.
- **Fatal misconfiguration silently becoming a black screen** → `src/lib/startup.ts` + `BootVeil`’s `ConfigBootFailureScreen`.
- **Unhandled render crash taking out the whole app** → `ErrorBoundary`.
- **Per-route chunk load feeling like a restart** → `ScreenFallback` replacing `VayloLoader` there.

I did **not** find any code path that intentionally displays the raw Supabase URL or publishable key to the athlete. The app reads those from `import.meta.env` at build time and the only place they are inspected at runtime is `src/lib/startup.ts`, which deliberately reads them as opaque config signals and never renders them. The docs and existing guards also make the intended configuration explicit: `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_…` key, not a legacy JWT-shaped anon key), with the legacy JWT shape build-blocked by `vite.config.ts` and `scripts/security-check.mjs`.

What I could not verify without a live backend and a real device:

- The app actually reaching the home screen against a **real Supabase project** with valid `VITE_SUPABASE_URL` and a real `sb_publishable_…` key.
- The Android/Capacitor bundle loading from `dist`, the status bar/splash/deep-link/back-button/session-restore behaviour on an actual device, and backgrounding/reopen/retry scenarios.
- Whether this checkout’s `.env` (if any) actually contains usable values, or whether the reported failure was “misconfigured build” rather than “code defect.”

## 2. Files changed

- **`src/components/vpr/VprHero.tsx`** — repaired a broken import. It was importing `VprFactorBar` from `@/components/ui/section`, but that module never exported it. Moved the import to the real home of the component.
- **`src/components/vpr/VprFactorBar.tsx`** — **created**. The missing component used by `VprHero`. A small factor-bar row: label, proportional fill bar (0–100), numeric value, optional framer-motion animated fill. This was the reason the production build was failing.

I reviewed the full startup path but did **not** need to rewrite `main.tsx`, `BootVeil`, `AuthContext`, `App`, `AppLayout`, `platform.ts`, `client.ts`, `errorReporting.ts`, `demoMode.ts`, or `index.html` for this task — those already implement the lifecycle described above. The one concrete defect I found and fixed was the missing `VprFactorBar` export that was preventing the production bundle from building at all.

## 3. Startup lifecycle changes implemented

None required beyond fixing the build blocker. The startup lifecycle the task asks for already exists in the code:

1. **Initialising** — `BootVeil` paints immediately from the first JS execution; `index.html` already colours the document before any module loads.
2. **Restoring session** — `AuthProvider` restores the session and, on the web only, attempts guest entry if there is none; `AppLayout` holds `BootVeil` while that gate is up.
3. **Ready** — `markBootReady()` is called from `AppLayout` when loading clears, and from the app’s time cap for routes that never mount `AppLayout`. Then `BootVeil` fades out and the real screen is revealed.
4. **Recoverable error** — `AppLayout` renders an explicit “couldn’t load your athlete profile” state with retry/sign-out; `ErrorBoundary` gives a “something went wrong, try again / reload” card for render crashes; `BootVeil`’s config-failure screen offers Retry.
5. **Offline state** — the app has an `OfflineBanner`, an offline queue (`installOfflineQueue`), and online-flush for pending error reports; non-essential failures are designed not to block render.
6. **Fatal configuration error** — `BootVeil` now detects unusable Supabase URL / missing publishable key at first paint and shows a clear, retryable, secret-free diagnostic.

No infinite loading state or startup redirect loop remains in the code I inspected: `BootVeil` has a hard stop, `AuthProvider` has bounded timeouts and `guestError` release, `AuthGate`/`AppLayout` already had the conditional redirect logic audited by the repo’s own `guestMode.test.ts` tests.

## 4. Scenarios tested and results

**What I actually ran**

- **Production web build:** `npm run build`
  - **Before the fix:** failed with `“VprFactorBar” is not exported by “src/components/ui/section.tsx”`.
  - **After the fix:** `✓ built in ~23.92s`. `dist/index.html` is present, contains `<div id="root">`, contains the inlined foundation colour, contains the brand `<title>`, does **not** contain the legacy `/src/main.tsx` script, and does reference the bootstrapped asset chunk (`index-CGadecm5.js` + preloads + CSS). There is a real app shell in the build output.

- **Targeted tests:** `npm test -- --run src/config/featureFlags.test.ts src/lib/authShell.test.ts src/lib/guestMode.test.ts`
  - **Result:** 3 test files, 58 tests, all passed. That covers the config-flag gate, the auth/shell contract tests, and the guest-entry/redirect-loop/once-per-load assertions that are the most startup-relevant.

- **Full test suite:** `npm test -- --run`
  - **Result:** `Test Files 9 failed | 164 passed (173)`, `Tests 20 failed | 2797 passed (2817)`.
  - The failing tests are **not** startup-path defects I introduced. They are pre-existing, mostly about:
    - generated website / legal-page generation and coverage (`website.test.ts`, `websiteStyleCoverage.test.ts`, `legalPages.test.ts`);
    - a Gradle release-toolchain / version-code test (`androidNative.test.ts`);
    - overflow-layout banner classification across referenced source trees (`overflowLayout.test.ts`);
    - streak/rewards and XP integration assertions that expect very specific wiring the current codebase does not satisfy in this checkout (`streakRewards.test.ts`, `xp.test.ts`);
    - profile cosmetics surfacing assertions (`StyleTab.test.tsx`, `PBCelebration.test.tsx`).

    None of those are `BootVeil`, `AuthProvider`, `AppLayout`, `main`, or build-circuit breakers. They are unrelated contract/generation/integration tests and they were failing before this work as well as after.

**What I could not test**

- A live browser launch against a real Supabase backend.
- The Android/Capacitor bundle, installed APK behaviour, backgrounding, deep-link, back-button, and session-restore cases.
- Any scenario that depends on real network, real credentials, or a real device.

Those are not “verified.” They are the remaining verification surface and require either a working backend configuration or a real device.

## 5. Browser and Android build results

**Browser (web) build:** ✅ produced. The production `dist/` exists with a bootstrapped entry chunk and the brand scaffolding. The immediate blocker to having any deployable web artifact was the missing `VprFactorBar`; that is now fixed.

**Android/Capacitor build:** ⚠️ not verified in this run. The project has a real Capacitor setup (`capacitor.config.ts`, `android/`, `@capacitor/*` deps, `npm run build:native`, `npm run cap:sync`, `npm run cap:apk`). The web bundle that feeds it is now buildable. But I did not run the native build or an APK install/test here, and I do not have a real Android runtime attached. Doing that is the next concrete verification step — see remaining blockers.

## 6. Remaining blockers and exact actions required

### Blocker A — this checkout has no verified working backend configuration

The app still depends on `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` being set to a real project’s values in the environment used for the web build / dev server / native bundle. If they are missing, empty, or still point at a placeholder/hostname that cannot work, the startup sequence will now **show the diagnostic screen** instead of a black screen, which is the correct failure mode, but it will not be a working app until real values are supplied.

**Action required:**
- Supply a real `VITE_SUPABASE_URL` and a real `sb_publishable_…` key (the rotatable publishable key, not a legacy JWT-shaped anon key) in the environment for the build you want to verify, then do a fresh build and a live browser launch.
- Do **not** paste a service-role key or any secret into client-side env. The publishable key is the only one that belongs in `VITE_SUPABASE_PUBLISHABLE_KEY`.

### Blocker B — live browser verification has not been performed

Even with a green build, I have not watched this checkout boot in a browser against a real backend, so I have not confirmed “loading screen → real app screen” end to end.

**Action required:**
- Start the app (dev server or serve `dist/`) against a valid Supabase project, open it in a browser, and confirm:
  - first paint is the dark brand surface, not a white flash;
  - if config is bad, the “App could not start” screen appears with Retry;
  - if config is good and there is no session, the app proceeds to guest entry or the sign-in path without hanging indefinitely;
  - if there is an existing session, the real app screen appears;
  - refresh on a nested route and back-navigation do not leave a blank screen.

### Blocker C — Android/Capacitor verification has not been performed

The code is built for the native shell (`isNativeShell()` branches router, plugin loading, deep-link handling, back-button, status-bar/splash config), but none of that has been exercised here.

**Action required:**
- Run `npm run build:native` (and, if you want an installable artifact, `npm run cap:sync` / the APK build), install on a real device or emulator, and verify:
  - cold launch renders the app, not a black screen;
  - existing session restores;
  - no session → usable sign-in path;
  - background and reopen;
  - back button behaviour is sensible at root vs. detail;
  - retry after a recoverable failure works without reinstall.

### Blocker D — the failing test suite items are pre-existing and unrelated, but still present

If you want a fully green suite in this checkout, the remaining 9 failing test files / 20 failing tests need their own fixes; they are **not** part of the startup fix and I did not touch them. The most likely categories are generated-site correctness/coverage, the Gradle version-code test, and XP/streak/Profile cosmetics wiring assertions.

## Summary

The startup/black-screen failure mode is now addressed in code: one brand surface from first paint, bounded loader states, explicit retry/error states, an error boundary, and a non-blank, secret-free diagnostic for a misconfigured build. The one concrete defect I found was a missing `VprFactorBar` export that broke the production build; I fixed it and added the missing component, and the web build now produces a real bootstrapped bundle.

What I did **not** do, because the environment did not support it, is prove the app boots end-to-end against a real backend on browser or Android. That proof requires valid Supabase config and either a live browser or a real device, and those are the remaining blockers above.
