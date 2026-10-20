# BUNDLE ANALYSIS & PERFORMANCE REPORT — 2026-10-20 (Prompt 11)

*Method: production `vite build`, plus a one-off `--sourcemap --outDir dist-smap`
run whose source map attributed each byte of the entry chunk to its source
module (`sourcesContent` lengths grouped by package). The temporary build
directory was deleted after measurement; only source changes are committed.*

---

## 1. Baseline (before this pass)

| Chunk | Raw | gzip | Role |
|---|---|---|---|
| `index-K48hTjqm.js` | 601.35 kB | 184.87 kB | entry chunk — paid on every cold start |
| `LegalDocument-vtG5TerW.js` | 772.65 kB | 158.82 kB | lazy legal viewer (charged to the reader, by design) |
| `generateCategoricalChart-…` | 360.57 kB | 101.20 kB | recharts core — lazy chart routes only (config comment records why it is not manually chunked) |
| `supabase-…` / `react-…` / `motion-…` | 227 / 176 / 124 kB | 59 / 58 / 41 kB | manual vendor chunks (`vite.config.ts`) |
| `index-Byb_cv5R.css` | 228 kB | ~32 kB | full Tailwind output |

### Where the 601 kB entry chunk actually came from (source-map attribution)

| Share | Module group |
|---|---|
| ~97 kB | `src/lib/health` (bridge, providers, import runner) — genuinely needed at boot |
| 92 kB | `@tanstack/query-core` + react-query client |
| 81 kB | i18next + react-i18next (English fallback ships in the entry by design; other 11 languages are already lazy per-language chunks) |
| 76 kB | `src/components/layout` (AppLayout, nav, sheets) |
| 73 kB | `tailwind-merge` + clsx + cva (`cn()` on every screen) |
| 59 kB | lucide-react icons (named imports only, tree-shaken — no namespace imports anywhere) |
| **49 kB** | **`src/pages/Auth.tsx` — statically imported** |
| 43 kB | `src/lib/notificationTriggers` |
| 62 kB | `@floating-ui/core` + dom (tooltip/dropdown positioning deps) |
| 33 kB + 24 kB | sonner, @capacitor/core |
| **30 kB** | **`src/pages/Onboarding.tsx` — statically imported** |

The two flagrant entries: `Auth` and `Onboarding` were the only *screens*
inside the entry chunk — static `import Auth from "./pages/Auth"` /
`import Onboarding from "./pages/Onboarding"` in `src/App.tsx`, while 30+
other routes were already `lazy()`.

### Checked and found already sound

- **CookieNotice mount (findings.md §1.1)** — already resolved in source:
  mounted once app-wide at [App.tsx](../src/App.tsx) next to
  `TermsChangeNotice`, with the rationale in a comment. No change made.
- **Icons** — 198 files import lucide named; zero `import * as` (which would
  break tree-shaking). Nothing to fix.
- **Vendor splitting** — `vite.config.ts` manualChunks for react/motion/
  supabase; recharts deliberately left to route chunks. Keep as is.

## 2. Change (the fix)

In [src/App.tsx](../src/App.tsx): `Auth` and `Onboarding` converted from
static imports to `lazy(() => import(...))`. Both render as route elements
(`/auth`, `/onboarding`) inside the existing `<Suspense fallback={<ScreenFallback />}>`
wrapper, so a first-visit chunk fetch shows the same inline skeleton every
other lazy route uses. Signed-in athletes — nearly everyone, every session —
never download either screen again.

## 3. Measurements (after)

| Chunk | Before | After | Δ |
|---|---|---|---|
| entry chunk | 601.35 kB / **184.87 kB gzip** | 517.11 kB / **161.80 kB gzip** | **−84 kB raw / −23.1 kB gzip on every cold start** |
| `Auth` chunk | — (in entry) | 28.70 kB / 7.55 kB gzip | fetched only when /auth renders |
| `Onboarding` chunk | — (in entry) | 17.79 kB / 6.06 kB gzip | fetched only when /onboarding renders |
| everything else | unchanged | unchanged | — |

Cold-start JS (entry + react + supabase + motion, gzip): ~343 kB before →
~320 kB after; the two gate screens no longer parse for users who never see
them in a session.

## 4. What would come next (not done — diminishing returns or needing review)

1. `LegalDocument` at 772 kB raw embeds the generated legal HTML in the
   chunk. Fine for the reader-only economics, but if it needs to shrink, fetch
   `/legal/*.html` from the site instead of bundling — a content-loading
   change worth its own pass because offline-in-app reading currently comes
   free from the bundle.
2. `@floating-ui` (62 kB) rides in via `@radix-ui/react-tooltip` +
   `@radix-ui/react-dropdown-menu`. Both are used on first screen(s); not
   worth the churn now.
3. Tailwind CSS at 228 kB (gzip 32 kB) — lean for this design system; a purge
   audit belongs with the next design-system change, not this pass.
4. `tailwind-merge`/cva (73 kB) — the shared `cn()` utility; replacing it is a
   risky cross-cutting change for ~20 kB gzip. Revisit only if the entry chunk
   becomes a budget item again.

## 5. Verification

- `npm run build`: exit 0 (29.9 s), new chunks present and hash-stable.
- `tsc --noEmit -p tsconfig.app.json`: clean.
- `vitest run authShell guestMode healthConnectEntry appleHidden`: 75/75 pass —
  these pin the auth gate, guest entry and OAuth wiring that the import
  change touches.
