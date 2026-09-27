# Vaylo Sports — Internationalisation (i18n)

How the multilingual system works, and how to extend it.

## The 30-second version

- Library: **i18next + react-i18next**, initialised in `src/i18n/index.ts`, wired in `src/main.tsx` before the first render.
- Languages live in `src/i18n/locales/<code>/index.json` (12 supported).
- UI text: `const { t } = useTranslation(); … t("hub.train.title")`.
- Dates/numbers: helpers in `src/i18n/format.ts` (`formatFullDate`, `formatTime`, `formatNumber`, `formatRelativeTime`, …).
- Language choice: Profile → Settings → Language. Persisted in `localStorage["vaylo.languagePref"]`.
- AI answers in the athlete's language via `userLocale` on every AI request.

## How language detection works

On startup `initI18n()` runs **before** React mounts:

1. Read the stored preference (`loadLanguagePref()`). Values: `"auto"` or a language code.
2. If `"auto"` (the default), `detectDeviceLanguage()` reads `navigator.language` (and `navigator.languages`), takes the base language (`fr-CA` → `fr`), and checks it against the registry.
3. Supported → that language loads; unsupported → English.
4. English ships inside the main bundle; every other language is a lazy-loaded JSON chunk (`LAZY_LOADERS` in `src/i18n/index.ts`), so startup cost is one language.

In the Capacitor WebViews `navigator.language` reports the **OS locale**, so the same code covers web, Android and iOS without any native plugin. If a native locale API is ever needed (e.g. per-app language on iOS), add it inside `detectDeviceLanguage()` — it's the single detection seam.

## How manual selection works

`applyLanguage(pref)` (in `src/i18n/index.ts`) is the only switch path:

1. Resolve `"auto"` → device language.
2. Persist the preference (localStorage; survives restarts, works signed-out).
3. Lazy-load the bundle if needed, then `i18n.changeLanguage()`.
4. The `languageChanged` listener updates `document.documentElement.lang` and `.dir` (RTL for Arabic) and re-points the Intl formatting locale.

Nothing reloads; React re-renders through i18next's subscription. The picker UI is `src/components/settings/LanguageSetting.tsx`.

## Where translation files live

```
src/i18n/
├── index.ts            # init, applyLanguage, getAiLocale, fallback chain
├── languages.ts        # registry: codes, native names, RTL flags, detection, persistence
├── format.ts           # Intl helpers bound to the active language
└── locales/
    ├── en/index.json   # ships in the main bundle — the fallback
    ├── es|fr|de|pt|it|nl|ar|zh|ja|ko|hi/index.json   # lazy chunks
```

Namespaces are top-level keys inside each file: `common`, `navigation`, `quickActions`, `hub.*`, `dashboard`, `vpr`, `settings`, `auth`, `errors`, `loading`, `emptyStates`, `sidebar`.

## Adding a new language

1. `src/i18n/languages.ts` — add one entry to `LANGUAGES` (`code`, `name`, `nativeName`, `rtl`).
2. `src/i18n/index.ts` — add the loader line in `LAZY_LOADERS`.
3. `src/i18n/locales/<code>/index.json` — copy `en/index.json` and translate. Missing keys automatically render the English string (per-key fallback), so partial translations are safe to ship.
4. If it's RTL, also add the language name to `LANGUAGE_NAMES` in `supabase/functions/_shared/openai.ts`.
5. Restart — the picker and detection pick it up automatically.

## Adding a new translation key

1. Add the key to **every** `src/i18n/locales/*/index.json` (keep the key sets identical; `npm run test` includes a bundle-parity test that fails otherwise).
2. Use it: `t("mySection.myKey")`. For interpolation: `t("dashboard.readinessUp", { value: "+4" })` with `"…+{{value}} vs yesterday"` in the JSON.
3. Never build keys by string concatenation and never hard-code user-facing English in JSX.

## How AI language selection works

- Frontend: `getAiLocale()` (active language code) is attached as `userLocale` to every AI request — centrally in `runAIDetailed()` for the 26 `ai-service` features, and per-call for the dedicated functions (`generate-plan`, `ai-analyze`, `weekly-review`, `coach-chat`, `video-form-analysis`).
- Server: the shared `languageDirective()` in `supabase/functions/_shared/openai.ts` appends a system-level "respond entirely in <language>" instruction when the locale isn't English. English requests are byte-identical to before. Dedicated functions build the same directive inline.
- Prompts, data and JSON schemas are unchanged — only the response language is directed. Universal abbreviations (VPR, VO2max, HR, RPE) stay untranslated.

## How RTL is handled

- `applyLanguage` sets `<html dir="rtl">` for Arabic (from the `rtl` flag in the registry) — everything downstream inherits.
- Layout uses logical Tailwind utilities: `start-*`/`end-*`, `text-start`, `border-s`/`border-e` (e.g. the sidebar anchors to `start-0`, the Coach drawer to `end-0`).
- Drawer slide animations read `document.documentElement.dir` at open time so they enter from the anchored side (`drawerSlide()` in Coach, inline check in AppSidebar).
- Directional icons get the `rtl-flip` class (CSS `scaleX(-1)` under `[dir="rtl"]`).
- Rule of thumb for new UI: no `left-`/`right-` positioning, no `text-left`/`pl-`/`pr-` where `start-`/`end-`/`ps-`/`pe-` work.

## How locale-aware formatting works

`src/i18n/format.ts` wraps `Intl`:

- `formatFullDate`, `formatShortDate`, `formatTime`, `formatDateTime`, `formatWeekdayDate`, `formatRelativeTime` — dates follow the athlete's language, with one refinement: if the device locale's *language* matches the active Vaylo Sports language, the full device tag is kept (an en-GB device keeps "22 September", en-US keeps "September 22").
- `formatNumber`, `formatCompactNumber`, `formatPercent` — thousands/decimal separators and percentages per locale.
- The `useLocale()` hook re-renders components on language change if you need the raw tag.
- Units are deliberately **not** part of this module — language ≠ units, and unit preference remains a separate concern. Existing unit handling is untouched.

## How fallback behaviour works

Lookup order: active language → English (`fallbackLng`). `returnEmptyString: false` means an empty translation also falls back to English. A key missing everywhere renders its own name — treat that as a bug: the bundle-parity test catches keys that drift out of sync across languages.

## Testing your changes

- `npm run typecheck` — includes both app and edge-function projects.
- `npm run test` — unit tests, including bundle parity.
- Manual: switch to Arabic in Profile → Settings → Language; the whole shell should mirror instantly, including the sidebar side, drawer slide and chevrons. Switch back — same in reverse.
