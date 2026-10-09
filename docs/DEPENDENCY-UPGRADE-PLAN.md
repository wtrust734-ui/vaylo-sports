# Dependency upgrade plan (deferred by decision, 2026-10-06)

Status: **DEFERRED — tracked, not started.** Written during the audit remediation of
2026-10-06. The owner chose "document as a deferred plan" over upgrading now, so the
working toolchain (Node 24.18.1, npm 11.16.0) is left exactly as it is. Nothing in this
document has been applied.

## Why it is deferred

`npm audit` reports **19 findings (2 critical, 7 high, 10 moderate)** across 648 audited
packages. Every one of them is either inside the **build/test toolchain** or a
**transitive** dependency of it — none is shipped in the Android or web bundle. The only
production-runtime finding (React Router) is a moderate advisory on a code path this app
does not use today (see "Exploitability" below).

Fixing them means **three breaking major upgrades** (Vite, Tailwind, Vitest) plus one
library major (React Router 7). Doing that in the same change as 30+ audit fixes would
make both the upgrade and the fixes hard to attribute if a gate went red. So: ship the
fixes, record the upgrade plan, do the upgrade as its own reviewed change.

## Current findings

Measured with `npm audit --json` on 2026-10-06.

| Severity | Package | Range affected | Reached through | Advisory |
| --- | --- | --- | --- | --- |
| critical | tinypool | `<=2.1.0` | vitest → tinypool | [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) |
| critical | tinypool | `<2.1.2` | vitest → tinypool | [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) |
| critical | vitest | `0.0.95 - 4.1.10` | direct devDependency | (rolls up the two tinypool + mocker advisories) |
| high | braces | `<=3.0.3` | tailwindcss → chokidar → braces | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| high | chokidar | `2.0.0 - 3.6.0` | tailwindcss → chokidar | (via braces) |
| high | micromatch | `>=0.2.0` | tailwindcss → fast-glob → micromatch | (via braces) |
| high | fast-glob | `*` | tailwindcss → fast-glob | (via micromatch) |
| high | tailwindcss | `0.5.0 - 3.4.19` | direct devDependency | (rolls up chokidar/fast-glob/micromatch/nested/selector-parser) |
| high | source-map-js | `>=1.0.0 <1.2.2` | transitive (Vite/PostCSS tooling) | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| high | vite | `<=6.4.2` | direct devDependency | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) (`server.fs.deny` bypass on Windows alt paths) |
| moderate | @vitest/mocker | `2.1.0 - 4.1.10` | vitest → @vitest/mocker | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| moderate | esbuild | `<=0.24.2` | vite → esbuild | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| moderate | vite | `<=6.4.2` | direct devDependency | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) |
| moderate | postcss-selector-parser | `<7.1.6` | tailwindcss / @tailwindcss/typography / postcss-nested | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| moderate | postcss-nested | `2.0.3 - 6.2.0` | tailwindcss → postcss-nested | (via postcss-selector-parser) |
| moderate | @tailwindcss/typography | `>=0.5.5` | direct devDependency | (via postcss-selector-parser) |
| moderate | uuid | `<11.1.1` | @capacitor/cli → xcode → uuid | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| moderate | xcode | `>=0.9.2` | @capacitor/cli → xcode | (via uuid) |
| moderate | @capacitor/cli | `8.5.0 - 9.0.0-alpha.7` | direct devDependency | (via xcode) |
| moderate | react-router | `6.0.0 - 7.17.0` | react-router-dom → react-router | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) |
| moderate | react-router-dom | `6.0.0-alpha.0 - 7.17.0` | **direct dependency (runtime)** | (via react-router) |

## Exploitability today (why this is not an emergency)

- **React Router (the only runtime finding).** Advisories are (a) an open redirect via a
  backslash in `<Link>`/`useNavigate`, and (b) arbitrary constructor injection in
  `deserializeErrors()` during **SSR** hydration. This app is a client-only SPA with **no
  SSR and no data-router** — no `createBrowserRouter`, no loaders, no `RouterProvider`,
  no `useLoaderData`. The router surface actually used is `BrowserRouter`, `HashRouter`,
  `Routes`, `Route`, `Navigate`, `Link`, `Outlet`, `useNavigate`, `useParams`,
  `useLocation`, `useNavigationType`. Every `to=`/`navigate()` target in `src/` is a
  literal or a value derived from app state; a search for user-controlled `next`/`returnTo`
  /`redirect` parameters found none. So (a) has no attacker-controlled input to reach it
  and (b) needs SSR that does not exist.
- **Tinypool / @vitest/mocker / esbuild.** All test- or dev-server-only. They are only
  reachable by someone who can already run commands in the repo.
- **braces / chokidar / micromatch / fast-glob.** Tailwind's file watcher. Dev-only, and a
  stack-exhaustion DoS needs an attacker who can already plant deeply nested glob input.
- **source-map-js.** DoS in source-map parsing; dev tooling only.
- **uuid via xcode.** `xcode` is pulled in by `@capacitor/cli`; the vulnerable `uuid`
  v3/v5/v6 path is not called by this project's `cap:sync` flow.
- **`vite server.fs.deny` bypass** matters for a dev server exposed to an untrusted
  network. The Vite dev server here is loopback-only and used interactively.

Net: **no finding is remotely reachable in production.** The security value of upgrading
is hygiene and preventing a future copy-paste of the vulnerable pattern, not closing a
live hole.

## Recommended order

Do these **one at a time**, each as its own change, running the full gate set after each
(see "Verification" below). Do not stack two majors in one branch.

### Step 0 — the one genuinely safe fix (do this first, or fold into a routine patch bump)

`npm audit fix --dry-run` proposes exactly **one** in-range change:

```
source-map-js  1.2.1 => 1.2.2   (a patch inside the declared ^1.0.0 range)
```

Apply with `npm audit fix` (no `--force`). Risk: near zero. It clears 1 of the 19 (high).

### Step 1 — Vitest 3 → 5 (clears 3 findings: 2 critical + 1 moderate)

- **Effort:** ~half a day. **Risk:** low–medium.
- **Why:** this is where the two *critical* findings live. Highest severity-to-effort
  ratio, so it goes first.
- **What changes:** `vitest` `^3.2.4` → `^5`. Vitest 5 requires a newer `jsdom`; bump
  `jsdom` off `^20` (Vitest 5 expects 26+). Expect config churn (`vitest.config.ts`
  environment/reporter options), possible `@testing-library/*` bumps, and a handful of
  test-API deprecations.
- **Blast radius:** test-only. 78+ spec files, ~1490 assertions — good safety net.
- **Watch for:** the suite currently reads build artifacts (`src/lib/playMount.test.ts`
  uses `skipIf(!built)`) and does **source-contract reads**, so keep the "build the site
  before running the site tests" ordering intact.

### Step 2 — React Router 6.30.1 → 7.18.4 (clears 2 findings, the only runtime ones)

- **Effort:** ~1 day. **Risk:** low. **This is the one worth doing even though the
  advisory is unreachable**, because it removes the last runtime advisory and the app uses
  only the stable parts of the router API.
- **Why low risk:** no data router, no loaders/actions, no `json()`/`redirect()`. v7's
  library mode keeps `react-router-dom` as a re-export of `react-router`, so the 50+
  import sites need no change. `HashRouter` (used for the Capacitor/Android build) still
  exists in v7.
- **What to check:** `src/App.tsx` (Router setup), `src/lib/scrollRestoration.ts`
  (`useNavigationType`), `src/components/layout/AppLayout.tsx` (`Outlet`). Confirm v7's
  default `future` flags don't change navigation semantics; run the app on both
  `BrowserRouter` (web) and `HashRouter` (native mode) paths.
- **Mobile:** re-run `npm run build:native` and the Android flow, since routing differs
  between the two routers.

### Step 3 — Vite 5.4.19 → 8 (clears 4 findings: 1 high, 3 moderate)

- **Effort:** ~1 day. **Risk:** medium.
- **Why:** fixes the `server.fs.deny` bypass (high), the two moderate Vite advisories, and
  the moderate `esbuild` advisory. Vite 8 also moves off the vulnerable `esbuild`
  generation, and the `source-map-js` pin becomes moot.
- **What changes:** `vite` `^5.4.19` → `^8`; `@vitejs/plugin-react-swc` must be on a
  version that declares Vite 8 peer support (`^4`+). Node 24.18.1 already satisfies Vite
  8's engine floor. `vite.config.ts` may need `build.rollupOptions`/`esbuild` option
  touch-ups; the SWC plugin config is the likely friction point.
- **Blast radius:** every script that shells out to Vite — `build`, `build:native`,
  `build:web`, and `ui:check` (which runs `npm run build` then `scripts/ui-audit.mjs`).
  If the build output changes byte-for-byte, `src/lib/buildWeb.test.ts` and the
  `website*` tests may need their expectations refreshed **only if the change is
  correct** — never loosen an assertion to make it pass.
- **Ordering:** do Step 1 (Vitest 5) first if you want Vitest's Vite peer to line up with
  Vite 8.

### Step 4 — Tailwind 3.4.17 → 4 (+ `@tailwindcss/typography`) (clears 8 findings)

- **Effort:** ~2–3 days. **Risk:** high. **Do this last, alone, and only with time to
  review the rendered UI.**
- **Why last:** Tailwind 4 is a rewrite, not an upgrade. It is also the largest cluster
  (8 of the 19: braces, chokidar, micromatch, fast-glob, tailwindcss, postcss-nested,
  postcss-selector-parser, @tailwindcss/typography).
- **What changes:**
  - `src/index.css` moves from `@tailwind base/components/utilities` to
    `@import "tailwindcss"` (or the `@config` compatibility shim pointing at the existing
    `tailwind.config.ts`).
  - `@apply`/`@layer` usage in `src/index.css` (lines ~3–5, 106, 132, 351–357) must be
    re-checked; Tailwind 4 changes `@apply` scoping and requires `@reference` in some
    contexts.
  - Default theme colors change (`border`/`ring` default to `currentColor`), which is
    exactly the kind of change that silently shifts a dark UI.
  - `postcss.config.js` becomes `@tailwindcss/postcss`.
  - `@tailwindcss/typography` must move to a Tailwind-4-compatible release.
- **Verification that matters:** this one **cannot** be signed off by tests alone. Run
  `npm run ui:check` (screenshot diff) and **look at the screenshots**, then walk the app:
  dashboard, market, leaderboard, legal reader, and the marketing site (the site
  is generated from the same CSS, so it moves too).

### Step 5 — @capacitor/cli (clears 2 findings) — wait, then pin

- **Situation:** the only "fix" npm offers is a **downgrade**, `@capacitor/cli` 8.5.2 →
  8.4.3, because the vulnerable range is `8.5.0 - 9.0.0-alpha.7` (they picked up a
  vulnerable `xcode`→`uuid`). Downgrading the CLI to escape a transitively-vulnerable
  `uuid` is not worth it.
- **Recommended:** leave it, watch for a `@capacitor/cli` 8.5.x patch that bumps `xcode`,
  or add a targeted `overrides` for `uuid` (see Option B). Re-check after any Capacitor
  bump in `cap:sync`.

## Option B — targeted `overrides` instead of majors

For the **transitive** findings, npm `overrides` can clear several without any major:

```jsonc
// package.json — NOT applied; evaluate one override at a time
"overrides": {
  "braces": "^3.0.4",              // clears braces/chokidar/micromatch/fast-glob tail
  "source-map-js": "^1.2.2",       // same as Step 0
  "postcss-selector-parser": "^7.1.6",
  "uuid": "^11.1.1"
}
```

- Clears roughly 8–10 of the 19 with low effort.
- **Risk:** overriding a version **outside** a package's declared range can break the
  parent (Tailwind's watcher, PostCSS plugin ordering). Verify with a real build
  (`npm run build`, `npm run site:build`) and a `ui:check`, not just `npm audit` going
  quiet. `uuid` 11 is a major jump for `xcode`; that one is the riskiest of the four.
- This is a legitimate middle path if the majors are never scheduled: it removes the
  critical path for anyone auditing the toolchain without touching runtime code.

## Explicitly rejected

- **`npm audit fix --force`.** Would jump Vite/Tailwind/Vitest to the majors above as one
  unreviewed commit. Rejected: it makes a red gate unattributable.
- **Ignoring/allow-listing the advisories.** No global ignore list is added, and no
  `npm audit --omit=dev` sleight of hand is used in the plan. `security:check` stays honest.

## Verification (run after **each** step)

```bash
npm run typecheck          # app + functions, must be 0
npm run lint               # baseline: 0 errors / 62 warnings
npm test                   # ~78 files, ~1490 passed
npm run build              # vite build
npm run security:check     # PASS(24)
npm run site:build         # 68 screens / 110 files
npm run ui:check           # screenshot diff — LOOK at the diffs, do not just read the exit code
npm run site:build         # again: ui:check rewrites screenshots, so the generated site must be regenerated
npx vitest run src/lib/website.test.ts src/lib/websiteStyleCoverage.test.ts
npm audit --json           # confirm the findings you targeted are gone
```

Keep the ordering: **`ui:check` rewrites screenshots, so `site:build` must run after it**,
and the `website*` tests only pass against a freshly generated site. (There is no
`website/play/` any more — the live-app preview was deleted from the main website
on 2026-10-07, and `src/lib/playMount.test.ts` now asserts its absence instead.)

## How to re-measure

```bash
npm audit --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).metadata.vulnerabilities)))"
```

Baseline to beat, 2026-10-06: `{ info: 0, low: 0, moderate: 10, high: 7, critical: 2, total: 19 }`.

## Owner decision log

- **2026-10-06:** owner chose "document as a deferred plan" over upgrading during the
  audit remediation. Reason recorded: keep the tested toolchain intact while the audit
  fixes land, and make the upgrade its own reviewed change.
