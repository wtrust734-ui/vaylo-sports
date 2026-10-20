# Vaylo Sports — Full Architecture and Risk Audit

**Scope:** inspection and planning only. Produced before Prompt 2. No code, database, configuration, deployment, or production data was changed for this report.

**Date of inspection:** 2026-10-19
**Repo root inspected:** the workspace containing `package.json`, `supabase/`, `src/`, `android/`, `.env.example`, `.env.local`, `capacitor.config.ts`.

---

## A. Architecture overview

### A.1 Frontend
- **Framework:** React 18 + React Router 7 (`react-router`/`react-router-dom ^7.18.4`), rendered as a Vite app.
- **UI layer:** custom design system plus Radix UI primitives and `shadcn/ui`-style components under `src/components/ui/`.
- **State:** a mix of React context/hooks and server-state via `@tanstack/react-query ^5.83.0`; Supabase client is the main typed data layer.
- **Styling:** Tailwind CSS 4.x via `@tailwindcss/postcss`, with `@tailwindcss/typography` and `tailwindcss-animate`.
- **i18n:** `i18next` + `react-i18next`, with locale files under `src/i18n/locales/` (including `en`, `es`, `fr`, `de`, `pt`, `it`, `nl`, `ar`, `zh`, `ja`, `ko`, `hi`).
- **Navigation base path:** Vite config defaults `base` to `"/"` unless `VITE_BASE` is set; this matters for nested-route cold loads and native bundle asset paths.

### A.2 Native shell
- **Runtime:** Capacitor 8 shell (`@capacitor/core ^8.5.2`, `@capacitor/android ^8.5.2`, `@capacitor/cli ^8.5.2`).
- **Config:** `capacitor.config.ts` → `appId: "com.vaylosports.app"`, `webDir: "dist"`.
- **Installed Capacitor plugins:** `@capacitor/android`, `@capacitor/app`, `@capacitor/browser`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/local-notifications`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/status-bar`.
- **Two build modes:** `npm run build` (web build into `dist`) and `npm run build:native` (native build with `--mode native`). `npm run cap:sync` builds native then runs `npx cap sync android`; `npm run cap:apk` also runs Gradle `assembleDebug`.
- **Native assumption in the repo:** `android/` is tracked, the APK is built from it in CI, and the JS→native bridge is extended via `src/lib/platform.ts` plugin loading plus native plugin sources under `android/`.

### A.3 Backend / edge functions
- **Runtime:** Supabase Edge Functions (Deno-based), under `supabase/functions/`. Functions are ES module `Deno.serve(...)` handlers.
- **Local type-checking:** `tsconfig.functions.json` type-checks `supabase/functions/**/*.ts` using path aliases that remap bare `https://esm.sh/...` and `npm:` specifiers to local `.d.mts` shims under `types/`.
- **Shared function code:** `supabase/functions/_shared/*.ts` holds catalog mirrors and helpers (for example `moneyCatalog.ts`, `planPeriodisation.ts`, `planSchema.ts`, `playBilling.ts`, `openai.ts`, `google.ts`, `coachVoice.ts`, `researchPipeline.ts`, `imageRun.ts`, `veo.ts`, `campaign.ts`, `composeJob.ts`, `format`-adjacent helpers).
- **Selected operational functions:**
  - `process-purchase/index.ts` — purchase basket validation + grant orchestration (credits/coins/unlocks/event packs), payment verification gating, referral settlement callout.
  - `ai-service/index.ts`, `ai-analyze/index.ts`, `generate-plan/index.ts`, `generate-nutrition-plan/index.ts`, `edit-plan/index.ts`, `weekly-review/index.ts`, `video-form-analysis/index.ts`, `coach-chat/index.ts`, `coach-checkout/index.ts`, `manus-invoke/index.ts`, `voiceover/index.ts` — AI/service call sites.
  - `support-request/index.ts`, `support-request-email/index.ts`, `support-request-unsubscribe/index.ts` — user support flow.
  - `link-preview/index.ts` — crawler-facing link preview + redirect.
  - `wearable-oauth/index.ts` + `wearable-oauth/providers.ts` — Health Connect / wearable OAuth path.
  - `push-notify/index.ts`, `delete-account/index.ts`, `export-my-data/index.ts`, `manage-subscription/index.ts`, `legal/index.ts`, `report-error/index.ts`, `sponsor-enquiry/index.ts`, `waitlist-*` — operational/admin-ish flows.
  - `stripe-webhook/index.ts`, `stripe-signature.ts`, `_shared/stripe.ts` — Stripe plumbing exists in the repo.
  - `ad-*` functions (`ad-engine-tick`, `ad-campaigns`, `ad-render`, `ad-video`, `ads-brand`, `ads-chat`, `ads-image`, `ads-research`, `ad-agent`) — ads studio subsystem.
  - `pipeline` subsystem under `src/components/pipeline/`, `src/server/`, `supabase/functions/manus-invoke/`, plus `supabase/migrations/20261016200000_pipeline_dashboard.sql`.

### A.4 Database
- **Database:** Supabase/Postgres, accessed through a typed generated client under `src/integrations/supabase/types.ts` plus untyped edge-function DB clients.
- **Generated client:** `src/integrations/supabase/types.ts` appears large and is the source of truth the app imports for typed table/RPC access.
- **Migrations:** many sequential migrations under `supabase/migrations/`. The newest dated files around the inspection snapshot include referral, health-sync, streak, cosmetics, event-trophy, pipeline, ad-engine, and referral-commission migrations. This repo contains **a lot** of migration history, and several recent docs and prior notes indicate migration drift between the local tree and a live linked project.
- **Important Postgres objects likely relevant:** typed tables generated into `types.ts`, and a large number of DB functions used by the app (especially credits/entitlement/referral/health/challenge/scheduling/admin functions). The exact function catalog is best read from `types.ts` and migrations rather than assumed.

### A.5 Auth
- **Auth provider:** Supabase Auth, client initialized in `src/integrations/supabase/client.ts` with PKCE, passkey support, persisted sessions.
- **Env for client:** `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`; `.env.local` currently sets a publishable key and a Vercel OIDC token.
- **Redirects/deep links:** `src/lib/share.ts` has a custom auth-return-origin allowlist and native deep-link scheme handling; OAuth flows appear to use PKCE + native deep links.
- **Consent/terms:** `src/lib/consent.ts` and `src/pages/Auth.tsx` enforce terms acceptance for account creation.
- **Age/guardrails:** `src/lib/age.ts`, `src/lib/geo.ts`, and various content/sponsor gates; referral commissions and some payouts are age-dependent via `viewer_is_adult()` in the DB.

### A.6 Storage (likely)
- Supabase Storage is plausible given Supabase usage, but I did not fully trace every storage bucket/binding in this audit. Video and image handling code exists; exact storage bucket names and policies should be confirmed from `supabase/config.toml` and migrations before relying on them.

### A.7 AI / provider integrations
- **Providers in code:** OpenAI and Google generative-language/large-model APIs appear in `_shared/openai.ts`, `_shared/google.ts`, and function handlers like `ai-analyze`, `video-form-analysis`, `generate-plan`, `generate-nutrition-plan`, `edit-plan`, `weekly-review`, `manus-invoke`, `coach-chat`, `voiceover`, `ai-images`.
- **Cost model:** `src/config/credits.ts` contains an unusually detailed per-feature cost model, with ceilings, margins, regional pack pricing, and Google Play take assumptions. This is a major source of truth for credit economics.
- **AI privacy/retention hardening:** migrations `20260930072251`, `20260930072403`, `20260930082043` and related docs suggest AI call logging, retention, and privacy hardening have already been part of later changes.

### A.8 Payments / credits / economy
- **Credits:** central config in `src/config/credits.ts`; client spend/grant API in `src/lib/credits.ts`; purchase flow in `src/lib/billing.ts` → `process-purchase` edge function.
- **Coins:** separate economy visible in `src/lib/creditEconomy.ts` and `src/config/coins.ts`; catalog mirror `supabase/functions/_shared/moneyCatalog.ts`.
- **Purchases:** `process-purchase` seems to be the main grant path; web checkout and a future Play Billing path are both represented. Current `src/lib/billing.ts` explicitly sets `STORE_BILLING_ENABLED = false`.
- **Referral economy:** referral credits exist (`redeem_referral`, `settle_referral`, `referral_qualification_count`, `referral_commissions`, `referral_payouts`, `referral_commission_config`, admin RPCs, click recording). The referral commissions migration introduces a cash-commission layer on top of the existing credit-bonus referral flow.

### A.9 Deployment surface
- **Repo deploys/shells:** `worker/`, `website/`, `public-apk-worker.js`, Vercel-related config/tokens, `.netlify/`, `vaylo ad web app/`, `vaylo ad site/`. The repo contains multiple deploy artifacts/sites beyond the core mobile app, including an ads site and web clone tooling.
- **Build tooling:** Vite builds, site generation scripts, APK scripts, money-mirror gen script, avatar-catalog gen script, event-pack gen script, deploy scripts, and a `ui-audit.mjs` script.

---

## B. Nine-feature implementation map

### B.1 Correct credit charging
**Current behaviour**
- Client-side credit spend goes through `src/lib/credits.ts` → `credits_spend()` RPC, which checks balance, deducts, records `credit_transactions`, and returns remaining balance.
- Purchases grant through `process-purchase`, which validates basket, verifies payment where applicable, records `user_purchases`, and grants credits/coins/unlocks via server RPCs including `credits_grant`.
- AI/service pages spend credits per use; many pages call `spendCredits()` or similar APIs before/after the AI call.

**Relevant files**
- `src/lib/credits.ts`, `src/lib/billing.ts`, `src/lib/featureUnlocks.ts`, `src/lib/featureUnlocks.test.ts`, `src/lib/planEdit.ts`, `src/lib/starterOffer.ts`, `src/lib/topUp.ts`, `src/lib/topUpStore.ts`, `src/hooks/useSpendWithTopUp.ts`, `src/pages/Training.tsx`, `src/pages/Injury.tsx`, `src/pages/Nutrition.tsx`, `src/pages/FormAnalysis.tsx`, `src/pages/VideoFormAnalysis.tsx`, `src/pages/Mental.tsx`, `src/pages/CrossTraining.tsx`, `src/pages/Tactics.tsx`, `src/pages/Collection.tsx`, `src/pages/Arcade.tsx`.
- DB: migrations for credits, entitlements, purchase ledger, idempotency.

**Confirmed bugs/limitations**
- This is the highest-risk area and the one most likely to already have partial mitigations. *From the repo alone*, the important open question is **when exactly each credit deduction is committed relative to service completion**, and whether retries/timeouts/duplicate submissions can charge more than once.
- Some AI/service calls likely spend credits up front or outside a clean “service completed” boundary; that needs per-page tracing rather than assumption.
- AI functions are asynchronous, provider-dependent, and can fail late; a “spend then call” pattern is a prime duplicate-charge/failed-service-charge risk.

**Proposed implementation**
- Define service-completion credit accounting explicitly: tentatively reserve or defer deduction until success, or make the service RPC itself the atomic spend+serve boundary.
- Enforce idempotency on every charge path (both credits_spend-style spends and per-use AI charges) so retries cannot double-charge.
- Add robust failure/rollback behavior for partial completions, provider errors, and timeouts.
- Audit every credit-consuming path end to end and document the charging point before changing UI.

**Risks/dependencies**
- High. Touching credit charging can break the whole economy if done broadly. Must preserve existing balance invariants and idempotency constraints.
- DB functions and migrations are authoritative; client-only changes will not close the real risk.

**How to test**
- Unit tests on the client spend/grant helpers and contract tests on the migration source where they exist.
- For strong coverage, need DB-level or integration checks on the actual spend RPC and process-purchase behavior, not just UI.
- Manual verification for time outs, retries, and concurrent submissions.

### B.2 Larger video uploads for form analysis
**Current behaviour**
- There is a form-analysis flow and a video-form-analysis flow, with an upload step and an AI analysis call.
- The repo already has multiple video-analysis-related migrations/settings from late September 2026 (quota, metered spend, request claims, idempotency, claim fix).

**Relevant files**
- `src/pages/VideoFormAnalysis.tsx`, `src/pages/FormAnalysis.tsx`, `src/lib/formVideo.ts`, `src/lib/formVideo.test.ts`, `src/lib/camera.ts`, `src/lib/nutritionPlan.ts`, `src/pages/Nutrition.tsx`.
- `supabase/functions/video-form-analysis/index.ts`.
- DB: video-related migrations in `supabase/migrations/`.

**Confirmed bugs/limitations**
- A larger frontend limit alone does not solve this. The real bottlenecks are likely distributed across: browser/ Capacitor upload transport, Supabase function request size/time limits, storage upload limits, AI provider input size/cost limits, processing time, and failure/retry behavior.
- Mobile and Android WebView constraints may further limit upload size, duration, and supported formats.

**Proposed implementation**
- Trace caps at each layer: client file pick/validate, upload transport, storage, edge function request/processing, AI input constraints, and per-user quota/cost.
- Choose a pipeline that can handle the target size/duration reliably: direct upload vs. multipart/chunked upload, optional client compression/transcoding, and server-side validation before any paid or metered AI call.
- Make failure handling explicit (partial uploads, failed analysis, quota exhaustion).

**Risks/dependencies**
- Medium-high. Raising limits without checking the server/AI/storage layer can create silent failures, rejections, or cost spikes.
- Vendor constraints (Supabase function limits, storage, AI provider limits) are likely hard constraints, not app code.

**How to test**
- Instrumented tests of upload size/duration boundaries where possible.
- Manual tests on real mobile web and Android WebView for size, duration, format, and failure recovery.
- Verify AI input constraints against the actual provider config in `_shared/google.ts`/`_shared/openai.ts` and function handlers.

### B.3 Legal compliance
**Current behaviour**
- Legal UI: `src/pages/Legal.tsx`, `src/pages/LegalDocument.tsx`, `src/components/legal/`, `legal/*.html`, and a legal edge function route.
- Consent/terms acceptance in onboarding/auth.
- Lots of privacy/safety/disclaimer docs and migration-driven privacy defaults.

**Relevant files**
- `src/pages/Legal.tsx`, `src/pages/LegalDocument.tsx`, `src/components/legal/*`, `src/lib/legalUrls.ts`, `src/lib/legalInApp.test.ts`, `src/lib/legalContentConsistency.test.ts`, `src/lib/legalHostLayout.test.ts`.
- `legal/` HTML policies.
- Supabase legal function route + generated pages.

**Confirmed bugs/limitations**
- There is clearly a lot of legal text and a lot of backend hardening/privacy work already done.
- The main risk is **gaps between written policy and live behaviour**: what is collected, retained, shared, sold, deleted, or shown to minors; whether refund/cancellation/purchase terms match the actual purchase flow; whether AI disclosure matches actual AI usage; whether deletion/export actually covers everything claimed.
- Some of this is a legal-review question, not a code question; code can show discrepancies, but it cannot certify compliance.

**Proposed implementation**
- Map each major policy claim to an implementation surface: auth, profile, health data, referral/clicks data, AI call logs, purchase/credit data, storage, retention jobs, deletion/export.
- Fix clear discrepancies first (missing disclosures for features that exist, or features that behave differently from the policy).
- Add/align in-app notices where the app behaviour changed after the policy was written.

**Risks/dependencies**
- High for trust/regulatory exposure; medium for implementation scope.
- Any statement that the app is “compliant” would be unsupported here; this audit can only identify likely gaps.

**How to test**
- Cross-check policy claims against actual code paths and data tables.
- Verify account deletion/export and privacy defaults where testable without production data.
- Legal language fits should be reviewed by a qualified reviewer for the intended markets.

### B.4 Major UI redesign and formatting fixes
**Current behaviour**
- UI is substantial and varied: dashboards, training, nutrition, injury, recovery, VPR, achievements, streaks, market, referrals, challenges, events, learning, mental, settings, profile, admin consoles, and ads studio.
- Styles are dark navy/purple themed and use Tailwind + Radix + custom components.

**Relevant files**
- `src/pages/*`, `src/components/*`, `src/components/ui/*`, `src/index.css`, `tailwind.config.*`, `postcss.config.js`, `src/lib/*` UI helpers.
- Existing UI audit scripts: `scripts/ui-audit.mjs`, `npm run ui:audit`, `npm run ui:check`.

**Confirmed bugs/limitations**
- This is a big surface. From repo structure alone, likely issues include inconsistent spacing/typography across pages, loading-state inconsistencies, and layout edge cases on small screens.
- Some screens are clearly larger and more complex than others, so inconsistency is expected rather than exceptional.

**Proposed implementation**
- Build a small internal UI consistency guide from what already exists (type scale, spacing tokens, card/panel conventions, button/link hierarchy, loading skeleton conventions, error/empty-state conventions).
- Fix the highest-impact breakdowns first: broken layouts, clipped content, unreachable actions, low-contrast or overly small text, and inconsistent loading/error states.
- Standardize loading and empty states globally rather than per screen.

**Risks/dependencies**
- Medium. Large UI work can introduce regressions across many screens; need a repeatable visual/responsive check.
- Must preserve working functionality and not change prices/policy text during this work.

**How to test**
- Automated UI audit script where possible.
- Manual responsive review at multiple widths.
- Accessibility/touch-target checks.

### B.5 Country-specific sports terminology
**Current behaviour**
- Country/region appears to be stored and used (for example `user_region`, country select in onboarding, geo helpers).
- i18n exists for many locales, but that is not the same as localized sport/exercise terminology.

**Relevant files**
- `src/lib/geo.ts`, `src/lib/geo.test.ts`, `src/lib/age.ts`, `src/lib/age.test.ts`.
- `src/pages/Onboarding.tsx`, `src/pages/Availability.tsx`.
- `src/config/equipment.ts`, `src/lib/sport*-related code if any`, i18n locale files.

**Confirmed bugs/limitations**
- Likely currently limited: the app probably has one primary English sport/equipment term set, with translations only partially covering UI strings.
- Need to confirm how sport identity, exercise definitions, measurements, and plan calculations are currently represented vs. how they should be localized.

**Proposed implementation**
- Localize display terminology (sport names, common terms, units, date/number formatting) through locale-aware mappings with stable internal ids.
- Keep the underlying sport/exercise/plan model language-neutral; only translate/adapt presentation and conventions.
- Add sensible fallbacks so an unsupported locale still reads correctly.

**Risks/dependencies**
- Medium. Must not break sport identity or training calculations.
- Requires a terminology mapping approach and review of what is actually localizable vs. canonical.

**How to test**
- Unit tests for locale mapping fallbacks.
- Manual review of localized strings in key flows.

### B.6 Synchronized loading and rendering
**Current behaviour**
- Auth init, Supabase client, React Query, onAuthStateChange handlers, and many per-screen fetches coexist.
- Some screens show loading shells; others render partial content quickly.

**Relevant files**
- `src/lib/sessionLoad.ts`, `src/lib/sessionLoad.test.ts`, auth context, `src/contexts/*`, `src/lib/queryClient.ts`, `src/pages/Index.tsx`, `src/pages/Auth.tsx`, `src/pages/Onboarding.tsx`, `src/components/layout/*`, `src/components/BootVeil.tsx` (if present), splash/shell components.

**Confirmed bugs/limitations**
- The reported behavior (“loading disappears before the app is ready; content appears at different times”) is consistent with a split initialization model where some state resolves earlier than other data, and where per-screen data fetching is not coordinated with a global ready state.
- Blank/partially rendered screens on failure are a likely symptom of missing error/empty handling in some data paths.

**Proposed implementation**
- Define a clear app-ready boundary: auth + critical config + shell stability, and hold the main UI behind it where appropriate.
- Use stable skeletons/placeholders and reserve space to reduce layout shift.
- Standardize error and empty handling so failed requests do not leave holes.
- Consider deferring non-critical fetches until after initial paint, or fetching them in controlled batches.

**Risks/dependencies**
- Medium-high for perceived quality; lower for correctness, but can expose race conditions if done carelessly.
- Auth initialization timing and React Query caching behavior are central.

**How to test**
- Manual startup and navigation tests on slow/poor connections.
- Automated checks for obvious blank-screen regressions where feasible.

### B.7 Offline access to training plans
**Current behaviour**
- There are offline/queue-related modules: `src/lib/offlineQueue.ts`, `src/lib/offlineCache.ts`, `src/lib/userStorage.ts`, and related tests.
- Plans appear to be stored server-side primarily, with some local caching/queueing already present.

**Relevant files**
- `src/lib/offlineQueue.ts`, `src/lib/offlineQueue.test.ts`, `src/lib/offlineQueueConflict.test.ts`, `src/lib/offlineCache.ts`, `src/lib/offlineCache.test.ts`, `src/lib/userStorage.ts`.
- Plan-related code: `src/lib/planGeneration.ts`, `src/lib/planEdit.ts`, `src/lib/planExport.ts`, `src/lib/planDeliveryWiring.test.ts`, `src/pages/Training.tsx`, `src/pages/Goals.tsx`, and server plan functions.

**Confirmed bugs/limitations**
- Likely partial today: some read caching may work, but full offline plan access with auth/refresh and conflict handling is usually still incomplete in apps like this.
- Offline edits vs. AI-generated/server-controlled plans raise conflict and freshness questions.

**Proposed implementation**
- Distinguish clearly between:
  - offline-readable content (previously loaded plans, static guidance),
  - offline-deferrable actions (draft edits, queue actions),
  - online-only actions (AI generation, account changes, syncs).
- Persist plans locally with clear ownership, staleness metadata, and a sync/conflict strategy.
- Handle auth expiry and reconnection gracefully.

**Risks/dependencies**
- Medium-high. Offline sync is easy to make inconsistent; local edits can conflict with server state.
- Need to be careful not to present stale or unsynced data as current.

**How to test**
- Unit tests for the queue/cache/conflict modules.
- Manual offline/navigation/relaunch tests for plan readability and sync behavior.

### B.8 Improve Market accessibility
**Current behaviour**
- Market exists as a first-class surface: `src/pages/Market.tsx`, `src/components/market/*`, pricing/credit-cost components, purchase confirmation sheets, top-up sheets.
- Purchase flow routes through `billing.ts` and `process-purchase`.

**Relevant files**
- `src/pages/Market.tsx`, `src/components/market/*`, `src/components/market/CreditCostsList.tsx`, `src/components/market/CreditTopUpSheet.tsx`, `src/components/market/CoinTopUpSheet.tsx`, `src/components/market/SubscriptionsSection.tsx`, etc.
- `src/lib/billing.ts`, `src/lib/featureUnlocks.ts`, `src/config/credits.ts`, `src/config/coins.ts`, `src/config/closedTesting.ts`, `src/config/subscriptionPlans.ts`.

**Confirmed bugs/limitations**
- Market usability issues likely include: discoverability from elsewhere in the app, clarity of credit vs. money pricing, number of steps to buy, and clarity of purchase confirmation/history.
- If credit pricing is shown without clear context, users may be confused about what they are buying and what it costs.

**Proposed implementation**
- Improve entry points to Market from the main app.
- Make prices, credit costs, and purchase outcomes clearer and more consistent.
- Reduce unnecessary steps and clarify confirmation, errors, and history.
- Keep existing products/prices/economics unchanged during the audit/repair.

**Risks/dependencies**
- Medium. This is mostly UX, but it intersects purchase flow and credit display, so changes must not mislead about cost or availability.

**How to test**
- Task-based usability review on mobile.
- Walk through purchase, failure, and history paths.
- Verify price/cost display consistency with `src/config/credits.ts` and related components.

### B.9 Thorough repeated testing
**Current behaviour**
- Tests: Vitest suite under `src/` and `supabase/functions/`, with `vitest.config.ts` including both `src/**/*.{test,spec}.{ts,tsx}` and `supabase/functions/**/*.{test,spec}.{ts,tsx}`.
- Quality gates: `npm run typecheck`, `npm run typecheck:app`, `npm run typecheck:functions`, `npm run lint`, `npm run test`, `npm run test:watch`, plus specialized scripts: `npm run security:check`, `npm run auth:posture`, `npm run secret:scan`, `npm run ai:health`, `npm run site:check`, `npm run ui:audit`, `npm run ui:check`, `npm run push:ready`.
- CI: `.github/workflows/android-release.yml` and other workflow files.

**Relevant files**
- `vitest.config.ts`, `package.json` scripts, `.github/workflows/*`, `src/test/setup.ts`, many `*.test.ts`/`*.test.tsx` files, `scripts/security-check.mjs`, `scripts/auth-posture.mjs`, `scripts/secret-scan.mjs`, `scripts/ai-health.mjs`, `scripts/ui-audit.mjs`, `scripts/push-readiness.mjs`.

**Confirmed bugs/limitations**
- Tests exist but coverage is uneven. Some of the highest-risk areas in this audit (credit charging timing, video pipeline limits, legal behaviour, offline plan sync, market usability) are only partially covered by automated tests in the repo.
- Some modes depend on external services/keys (OpenAI, Google, Play Billing, Stripe, Supabase), so full coverage likely needs credentials or careful mocking.
- No automated E2E suite was clearly evident as the primary regression gate in the parts I inspected; UI audits and manual checks appear heavily relied upon.

**Proposed implementation**
- Establish a regression matrix for the nine areas, separating:
  - automated unit/contract tests,
  - automated build/typecheck/lint/security checks,
  - integration checks where creds exist,
  - manual verification for device/browser/payment/legal/visual items.
- Add tests for the highest-risk new behavior before it ships, especially credit-charge idempotency and video pipeline boundaries.

**Risks/dependencies**
- Medium. Testing gaps are themselves a risk for later changes.

**How to test**
- Run existing commands in their actual environments and record what they cover.
- Identify which journeys still have no automated coverage and require manual verification.

---

## C. Credit and transaction audit

### C.1 Where credits are defined
- `src/config/credits.ts` is the local source of truth for feature costs, promo bonuses, pack defaults, and the detailed cost model.
- Runtime overrides appear to come from `economy_config` (for example `feature_costs`), read by `loadFeatureCosts()` in `src/lib/credits.ts`.

### C.2 Where credits are deducted
- Primary client path: `spendCredits()` in `src/lib/credits.ts`, calling `credits_spend()` RPC.
- Purchase grants: `process-purchase` edge function, which validates and then grants via server RPCs (`credits_grant`, `grant_coins`, `spend_credits`, etc.) depending on item type.
- Various service pages spend credits directly for AI/service usage.

### C.3 Where credits/grants are recorded
- `credit_transactions` ledger for credit activity.
- `coin_transactions` for coins.
- `user_purchases` for entitlement/purchase records.
- Referral credits via `credits_grant` with referral source kinds.
- Reward/milestone grants may use `credits_grant` with various reasons/sources.

### C.4 What makes duplicate charging possible today
Potential duplication vectors to verify, not assume:
- Retrying a failed AI/service call that already charged.
- Race conditions on concurrent requests that spend the same quota.
- UI double-taps or duplicate submissions.
- Provider failure after charge but before completion.
- Purchase/payment verification vs. grant timing in `process-purchase`.

The DB already has some idempotency structure (for example `credit_transactions_idem_uniq` style constraints mentioned in migration notes), but the **timing of charge relative to success** is the key audit question.

### C.5 Failure behavior to verify per service
- Network/timeout failure after spend.
- Provider error after spend.
- Partial completion.
- Retry storms.
- Concurrent identical requests.
- Insufficient balance at spend time vs. at completion time.

---

## D. Legal and privacy gap analysis

### D.1 Likely present
- Terms, privacy, AI disclosure, training-safety/non-medical disclaimers, purchase/refund/cancellation terms, deletion/export flows, support requests, and age/sponsor gates.
- Privacy hardening and AI data-retention changes are visible in migrations and docs.

### D.2 Likely gaps to investigate
- Whether policy text matches the **current** set of collected data (profile, health, activity, location-related, device, AI inputs/outputs, purchase history, referral/click data).
- Whether retention/deletion/export language matches actual implementation.
- Whether AI usage is disclosed to the level the app actually operates at.
- Whether purchase/refund/cancellation terms match the real purchase path and current payment availability.
- Whether minor/age-related handling matches local rules in target markets.
- Whether ads/studio/sponsor surfaces have appropriate disclosures if they are user-facing.

### D.3 Important caveat
This audit can identify discrepancies and missing coverage, but it cannot certify legal compliance. Anything material should be reviewed by qualified counsel for the intended markets.

---

## E. UI and loading audit

### E.1 Most likely significant issues
- Inconsistent loading and empty states across screens.
- Possible layout shifts during auth/init/data fetching.
- Possible contrast/typography/spacing inconsistency across many independent pages.
- Possible small touch targets or crowded controls in some flows (purchase, onboarding, forms).
- Possible content overflow/clipping on small screens in complex screens.
- Possible confusing navigation or duplicate actions in some deeper flows.

### E.2 Priority order
1. Anything that blocks use: blank screens, unreachable actions, broken flows.
2. Anything that misleads about cost/ownership/safety: pricing clarity, purchase confirmation, AI/service completion status.
3. Anything that repeatedly degrades perceived quality: loading flicker, layout shift, inconsistent cards/buttons/typography.

### E.3 Likely affected screens
- Startup/auth/onboarding.
- Dashboard and main hub navigation.
- Training/plan flows.
- AI service flows (pricing, loading, result, retry).
- Market/purchase flows.
- Profile/settings.
- Referrals and challenges.

### E.4 Proposed fixes
- Standard loading skeleton and app-ready gating.
- Standard error/empty states.
- Consistent spacing/type scale/button hierarchy.
- Responsive review pass at multiple widths.
- Touch-target and contrast review.

---

## F. Offline architecture assessment

### F.1 What the repo already has
- Offline queue/cache/user-storage modules.
- Client-side persistence patterns already in use.
- Some plan export/import-like and queueing behavior.

### F.2 What likely still needs work
- Reliable offline reading of saved plans after app restart.
- Clear staleness/ownership metadata.
- Offline edits vs. server authority and conflict resolution.
- Reconnection and auth-expiry behavior.
- Clear separation of read-offline vs. online-only operations.

### F.3 Recommended model
- Local read cache for previously fetched plans, marked with fetch timestamps and plan ids.
- Offline queue for user actions that cannot be completed offline.
- Server-authoritative AI-generated and account-level changes, with explicit “online required” states.
- Conflict rules for any editable plan data.

---

## G. Testing and regression plan

### G.1 Existing automated gates
- `npm run typecheck` / `typecheck:app` / `typecheck:functions`
- `npm run lint`
- `npm run test`
- `npm run security:check`
- `npm run auth:posture`
- `npm run secret:scan`
- `npm run ai:health`
- `npm run ui:audit` / `npm run ui:check`
- `npm run site:check`
- `npm run push:ready`

### G.2 Likely coverage gaps
- Credit-charge timing and duplicate-charge scenarios per service.
- Video upload pipeline caps and failure modes at every layer.
- Legal/policy-vs-behavior alignment.
- Offline plan read/sync/conflict behavior.
- Market usability tasks.
- Startup loading sequence and blank-screen scenarios.
- Some AI/service flows depending on external provider keys.

### G.3 Required test cases for later prompts
- Credit spend only on successful completion; retries do not double-charge.
- Video upload size/duration/format limits at client, transport, server, storage, and AI layers.
- Legal claim vs. behavior discrepancies.
- Offline plan readability and sync/conflict behavior.
- Market noticeability, purchase clarity, error clarity, history clarity.
- Loading stability and no blank/partial screens on failure.

### G.4 Repeated testing strategy
- Keep a short automated gate list in CI where possible.
- Maintain a manual verification checklist for items that need devices, browsers, payments, or credentials.
- Re-run the most relevant checks before each later prompt and after each change.

---

## H. Implementation sequence

### Recommended order
1. **Foundation and risk anchoring**
   - Freeze the current understanding of credit charging and purchase flow end to end.
   - Confirm video pipeline limits at every layer.
   - Confirm legal/policy vs. behavior gaps.

2. **Correct credit charging** (before adding new paid features or raising video limits)
   - Because it affects every paid service and is the highest money/trust risk.

3. **Video upload enlargement** (after the credit model is safe)
   - Because it can increase cost and failure modes and may interact with AI pricing and quota.

4. **Legal/compliance alignment**
   - Parallelizable, but any discovered behavior change should be coordinated with the above.

5. **UI redesign + loading synchronization**
   - Can proceed in parallel with careful scope control; reduces risk of regressions by standardizing patterns first.

6. **Market accessibility**
   - UX work that depends on stable pricing/purchase flows and clear loading/confirmation patterns.

7. **Offline plan access**
   - Depends on a stable plan model and sync/conflict design; safest after core flows are steadier.

8. **Country-specific terminology**
   - Mostly additive; safer once the presentation layer is more consistent.

9. **Repeated testing maturity**
   - Should be built alongside the rest, not last; the highest-risk areas need tests before/after changes.

### Shared components/dependencies
- Auth initialization and session state.
- Supabase client and generated types.
- Credit/economy config and DB functions.
- AI provider config and rate/quota handling.
- UI component library and loading/error patterns.
- Offline queue/cache layer.

---

## I. Critical risks

### I.1 Credit charging errors (highest)
- If credits can be charged for failed/uncompleted services, or charged more than once, the impact is direct and user-visible.
- Mitigation: make the charge conditional on successful completion where possible, enforce idempotency everywhere, and test failure/retry/concurrency paths.

### I.2 Video limit increase without full pipeline validation
- Raising the frontend limit can expose server/function/storage/AI limits or cause confusing failures/costs.
- Mitigation: define target size/duration, then validate each layer and failure mode before exposing a larger limit to users.

### I.3 Legal/policy drift
- Policy text that no longer matches the app can undermine trust and create real exposure.
- Mitigation: map claims to implementation, fix clear mismatches, and leave final compliance certification to qualified review.

### I.4 UI regressions across a large surface
- Broad visual/loading changes can introduce new breaks in many places.
- Mitigation: standardize patterns first, limit scope per change, and use a repeatable responsive/visual check.

### I.5 Offline data inconsistency
- Offline plan access can easily present stale or unsynced data as current.
- Mitigation: be explicit about offline-read vs. online-only, add staleness indicators, and design a clear sync/conflict policy.

### I.6 Auth/loading sequence instability
- A fragmented init sequence can produce blank screens and layout shifts.
- Mitigation: define an app-ready boundary and stable placeholders.

### I.7 Migration/schema drift between local and live
- Several docs/notes indicate the local migration tree and a live linked project may diverge.
- Mitigation: confirm current DB state against the local tree before relying on any schema claim in later prompts.

---

## J. Readiness decision

### Can implementation begin safely?
Partially. The repo is clearly large and capable, and many foundations already exist. However, **implementation should not start with broad UI or feature changes**. The most safety-critical dependencies are:

- a verified end-to-end understanding of credit charging and idempotency,
- a verified video pipeline limit map,
- and a clear picture of legal/policy-vs-behavior gaps.

### Architectural prerequisites
- Confirm the authoritative DB schema/functions against local migrations (because of likely drift).
- Decide the credit-charge completion model before changing any credit-consuming service.
- Decide the video target and validate all layers before exposing it.

### Uncertainties needing clarification
- Exact current credit-charge timing for each AI/service.
- Exact current video upload/processing/storage/AI limits and where the real bottleneck is.
- Exact legal claims that conflict with current behaviour.
- Which screens/states currently produce blank or shifting loading behavior.
- What offline plan access already works today vs. what still needs building.
- Which markets and age/minor rules are actually in scope.

### Bottom line
The app is implementable against, but the safest next move is a focused verification pass on credit charging, video pipeline limits, and legal/behavior alignment before Prompt 2 begins. After that, the remaining work can proceed in the order above, with repeated automated gates plus targeted manual checks.
