# RELEASE VERIFICATION & GATE REPORT — 20 October 2026 (Prompt 12)

QA lead verification pass over the Prompts 1–11 remediation track, run against
the repo, the full test suite, the production build, and — via the Supabase
MCP — the **live database** of `wtrust734-ui's Project`
(`vvwhausdjzdmsyxekrcl`, region eu-central-1, ACTIVE_HEALTHY, Postgres 17).

## 1. Regression suite result (post-fix, authoritative)

| Check | Command | Result |
|---|---|---|
| Full suite | `npx vitest run` (177 files) | **2870/2870 passed, exit 0** (74 s) — run AFTER the final fix of this pass |
| Web build | `npm run build` | exit 0, 28.7 s |
| Typecheck (app) | `tsc --noEmit -p tsconfig.app.json` | exit 0 |
| Secret scan | `node scripts/secret-scan.mjs` | **PASS, 0 findings, 1110 files, 11 rules** |
| Function typecheck (Prompts 9–11 files) | `tsc -p tsconfig.functions.json` | clean for all touched files (the only remaining errors are the pre-existing, unrelated `ad-engine-tick` / `manus-invoke` blocks) |

## 2. Regression found in this pass → minimal fix applied

`src/pages/Legal.tsx` carried a one-character-off support inbox literal
(`vaylosportsupport@gmail.com`) on the visible mailto link — flagged in the
legal checklist as "noted, not changed", still shipping. Support mail from the
app therefore landed at an address nobody reads (the real monitored inbox in
`legal/operator.json` is `vaylosportssupport@gmail.com`). Fixed minimally to
read the operator.json value with a source comment, plus a two-test drift-pin
in `legalContentConsistency.test.ts` (app CONTACT_EMAIL must equal
`operator.json`; generated pages must contain no `%%` placeholders) — 50/50
legal tests green after the change.

## 3. Live-database evidence (read-only audit)

| RT / finding | Query evidence | Verdict |
|---|---|---|
| **RT-001 RLS isolation** | 172/172 `public` tables have RLS **enabled**, zero with RLS off. The 13 RLS-on-with-zero-policies tables were grant-audited: **0 grants to anon/authenticated, 7 service-role grants each** — exactly the documented deny-all service-only pattern (tokens, click tracking, reward claims, XP rules). | **PASS (live)** |
| Deployed migrations | latest applied `20261020172028`; today's RLS-era migrations are in | current |
| Cron jobs live | `waitlist-campaigns-daily`, `referral-commissions-hold-sweep`, `video-ai-data-retention-daily` | running |
| Refund alert store | `app_error_reports` exists live | Prompt 9 wiring ready |
| Ops monitoring (Prompt 10) | `ops_metrics_daily` / `ops_ai_cost_daily` / the `ops-metrics-daily` cron are **not yet applied live** | **deploy pending** — see §6 |

## 4. MDF register — fix-to-evidence map

| MDF | Where the fix lives | Evidence in this pass |
|---|---|---|
| MDF-001 purchase rollback | `process-purchase` rollback/idempotency contracts | `purchaseSequence.test.ts` + monetisation suites green (contract level); live sandbox run outstanding (RT-003) |
| MDF-002 RLS coverage | RLS matrix + hardening migrations | **live audit above: PASS** |
| MDF-003 operator placeholders | build-time substitution with a refuse-to-publish guard | `pages.generated.ts` contains zero `%%` tokens and resolves "Vaylo Sports"; `legal/operator.json` is the source; counsel pack in `docs/LEGAL-COUNSEL-REVIEW-PACKAGE.md` |
| MDF-004 log retention | decided: 30 days, published (privacy v1.7, data-rights v1.3) | retention sweep cron **verified running live** |
| MDF-005 child-safety completeness | legal package + consistency tests | published doc complete except the operator legal particulars (§6) |
| MDF-006 Health-Connect plugin | `docs/SECURITY-HEALTHCONNECT-PLUGIN-REVIEW.md` | verdict: **no critical/high findings**; 2 medium, ship-compatible with recorded recommendations |
| MDF-007 observability | `20261020130000_ops_metrics.sql`, `ops-health` function, `docs/MONITORING-STRATEGY.md` | `opsMonitoring.test.ts` 9/9 green; **live apply pending** |
| MDF-008 refund resilience | `_shared/refund.ts` (deterministic keys, 2-attempt retry, durable `app_error_reports` alert), 7 call sites threaded, orphan copy deleted | `entitlementLifecycle` + AI security suites green; alert store present live |

## 5. Release gates

| Gate | Status | Evidence / residuals |
|---|---|---|
| 1 — Security | **PASS** | live RLS audit; PKCE/session contracts (`authShell`, native OAuth tests); secret scan 0 findings; edge log-hygiene pack green; plugin review closed |
| 2 — Legal & compliance | **AMBER — operator inputs open** | operator.json resolved everywhere; 30-day retention published; child-safety published. Open: registered company name/number + postal address (ICO form), counsel sign-off |
| 3 — Financial | **PASS in safe mode; sandbox pending** | payments remain refused (`payments_not_available`) — the safe state; rollback + refund-idempotency contracts green; RT-003 sandbox receipts need a Play sandbox account |
| 4 — Core functionality | **PASS by contract** | auth / age / deletion / plans / refund suites green (RT-004, RT-005, RT-008, RT-009); live device runthroughs remain a store-submission task |
| 5 — Quality | **PASS (web); Android via CI** | builds and 2870 tests green; monitoring implemented (deploy pending); bundle report in place |

## 6. Outstanding before public launch (all non-code)

1. **Deploy the Prompt 9/10 artifacts to Supabase**: `refund.ts` + `guard.ts`
   + the seven AI functions; `20261020130000_ops_metrics.sql`; the
   `ops-health` function and `OPS_HEALTH_SECRET`. The code is green but
   **not yet live** — the live project still runs the three earlier cron jobs
   and has neither the ops rollup nor the deployed refund-alert path.
2. **RT-003** sandbox purchase run (Play sandbox account) — the only critical
   test that cannot land without external credentials.
3. **Gate 2 particulars**: registered entity name/number, postal address, ICO
   number, and counsel sign-off (listed in
   `docs/LEGAL-PLACEHOLDERS-RETENTION-CHECKLIST.md` §2).
4. **RT-005 / RT-009 staging runthroughs** on a device (deletion end-to-end +
   auth/restore) — the store-submission standard test pass.
5. **Android release build**: the workflow exists
   (`.github/workflows/android-release.yml`) but no local gradle run happened
   in this session — confirm the CI run is green before any store upload.

## 7. Verdict

**Code-level release blockers from Prompts 1–11: none remaining.** Every MDF
has a fixed, tested implementation; the full 2870-test regression suite passes
after the final fix; the live database shows RLS fully deployed and the grant
audit clean. **Public launch still waits on three things, none of them code:**
deploy of the last two prompts' edge/migration artifacts, the RT-003 sandbox
purchase run, and the operator's legal particulars (entity / ICO / counsel).
