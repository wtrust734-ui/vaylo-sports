// ============================================================================
// PHASE 6 WIRING — the properties that only exist across files
// ----------------------------------------------------------------------------
// Same pattern as androidNative.test.ts and safeAreaShell.test.ts: the pure
// behaviour is covered by its own suite, and what is left are the claims that
// live in how the parts are connected — the route exists, every surface that
// makes a recommendation renders the shared framework rather than its own copy
// of the reasons, the analytics reading is cached for offline viewing, and no
// screen went back to claiming medical certainty.
//
// These fail loudly on the edit that silently drops one of them, which is
// exactly the failure mode they exist for: a framework nobody mounted is
// indistinguishable from no framework at all.
// ============================================================================

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

/** Source with comments removed, so a comment cannot satisfy or break an assertion. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const APP = "/src/App.tsx";
const INSIGHTS_PAGE = "/src/pages/Insights.tsx";
const WHY = "/src/components/insights/WhyDisclosure.tsx";
const TRAINING = "/src/pages/Training.tsx";
const WEEKLY = "/src/components/dashboard/WeeklySummary.tsx";
const METRICS = "/src/pages/MetricsHub.tsx";
const PLAN = "/src/lib/insightsPlanning.ts";
const CACHE = "/src/lib/offlineCache.ts";
const NAV = "/src/lib/personalization/nav.ts";
const FEATURES = "/src/lib/personalization/features.ts";
const HUB = "/src/pages/Perform.tsx";
const AUDIT = "/scripts/ui-audit.mjs";
const CRAWL = "/scripts/qa-crawl.mjs";
const LOCALES = "/src/i18n/locales";

describe("phase 6 — the screen is reachable", () => {
  it("routes /insights to a lazily loaded page", () => {
    const app = read(APP);
    expect(app).toMatch(/const Insights = lazy\(\(\) => import\("\.\/pages\/Insights"\)\)/);
    expect(app).toContain('path="/insights"');
  });

  it("is not gated behind a feature flag, because it reads whatever training exists", () => {
    const app = read(APP);
    const route = app.slice(app.indexOf('path="/insights"'));
    expect(route.slice(0, 200)).not.toMatch(/isFlagOn/);
  });

  it("registers a feature and a nav entry that point at the same route", () => {
    expect(read(FEATURES)).toContain('"perform.insights"');
    expect(read(FEATURES)).toMatch(/key: "perform\.insights",\s*families: \["\*"\],\s*route: "\/insights"/);
    expect(read(NAV)).toMatch(/feature: "perform\.insights", labelKey: "sidebar\.insights", path: "\/insights"/);
    // Reachable from the hub it belongs to, not only from a direct URL.
    expect(read(HUB)).toMatch(/path: "\/insights", feature: "perform\.insights"/);
  });

  it("is crawled and screenshotted by the site tooling", () => {
    expect(read(AUDIT)).toMatch(/\["insights", "\/insights"\]/);
    expect(read(CRAWL)).toContain('"/insights"');
    // The website's per-screen preview pages were removed at the owner's
    // request, so the crawl + audit entries above are now the only
    // tooling-side descriptions of this route.
  });

  it("has its copy in every supported language", () => {
    const locales = readdirSync(path.resolve(__dirname, "..", "i18n", "locales")).filter(
      (f) => f.length === 2,
    );
    expect(locales.length).toBeGreaterThanOrEqual(12);
    for (const code of locales) {
      const bundle = JSON.parse(read(`${LOCALES}/${code}/index.json`));
      expect(bundle.sidebar.insights, `${code}: sidebar.insights`).toBeTruthy();
      expect(bundle.hub.perform.insights, `${code}: hub.perform.insights`).toBeTruthy();
      expect(bundle.hub.perform.insightsDesc, `${code}: hub.perform.insightsDesc`).toBeTruthy();
    }
  });
});

describe("phase 6 — one framework explains every recommendation", () => {
  it("renders the plan screen's reading through the shared reasons, not its own copy", () => {
    const training = read(TRAINING);
    expect(training).toContain("explainDecision");
    expect(training).toContain("explainWeek");
    expect(training).toContain("WhyBody");
    // The hand-rolled evidence list is gone; two renderers is how the screen
    // starts explaining a decision differently from the rules that made it.
    expect(code(training)).not.toMatch(/evidence\.map/);
  });

  it("drops the unmounted weekly report instead of carrying a source contract for it", () => {
    // WeeklySummary was never re-mounted after Phase 6 (the dashboard renders
    // `DailyTrainingCard`) and was deleted in the 2026-10-06 dead-code pass
    // along with its only consumer of the RPE log. A source contract for a
    // file nothing renders is coverage of a comment: the component could rot,
    // diverge from the framework, or come back unwired, and the contract would
    // stay green. Asserting its absence is the guarantee that survives — the
    // live surfaces (the plan panel, the insights screen) are pinned above and
    // below this block.
    expect(existsSync(path.resolve(__dirname, "../.." + WEEKLY))).toBe(false);
  });

  it("puts the why behind a tap on the analytics screen, with the lead card open", () => {
    const page = read(INSIGHTS_PAGE);
    expect(page).toContain("WhyDisclosure");
    // The most actionable reading is expanded; the rest is not, which is the
    // progressive disclosure the specification asks for.
    expect(page).toMatch(/<WhyDisclosure explanation=\{lead\} defaultOpen/);
  });

  it("keeps the reasons, the rationale and the honesty in one component", () => {
    const why = read(WHY);
    expect(why).toContain("What this means");
    expect(why).toContain("not a medical assessment");
    // Bullets carry their provenance, so a claim is checkable.
    expect(why).toContain("reasonSourceLabel");
    // The toggle is a real control with a state, and meets the touch floor.
    expect(why).toMatch(/aria-expanded=\{open\}/);
    expect(why).toMatch(/min-h-11/);
  });

  it("labels a thin case rather than presenting it as settled", () => {
    const why = read(WHY);
    expect(why).toMatch(/confidence === "low" \|\| confidence === "none"/);
    expect(why).toContain("confidenceLabel");
  });
});

describe("phase 6 — the reading is available offline (Phase 5)", () => {
  it("has its own cache key with an age limit", () => {
    const cache = read(CACHE);
    expect(cache).toMatch(/\| "insights"/);
    expect(cache).toMatch(/insights: \d+ \* 24 \* 60 \* 60 \* 1000/);
  });

  it("writes the reading under the athlete's own key and reads it back with its age", () => {
    const plan = read(PLAN);
    expect(plan).toMatch(/cacheWrite\(userId, INSIGHTS_CACHE_KEY/);
    expect(plan).toMatch(/cacheRead<TrainingInsights>\(userId, INSIGHTS_CACHE_KEY\)/);
    // The age survives the read, so the screen can say how old its reading is.
    expect(plan).toMatch(/stale: snapshot\.stale/);
  });

  it("falls back to the saved reading instead of claiming there is no training", () => {
    const hook = read("/src/hooks/useInsights.ts");
    expect(hook).toContain("readCachedInsights");
    // An empty screen is a real answer only when the account was reached: a dead
    // connection must not render as "you have no training".
    expect(hook).toMatch(/catch \{/);
    expect(hook).toMatch(/cached\s*\n?\s*\? \{/);
    const page = read(INSIGHTS_PAGE);
    expect(page).toMatch(/cacheAgeLabel/);
    expect(page).toMatch(/Offline — showing the reading saved to this device/);
  });

  it("reads the cached snapshot rather than recomputing while offline", () => {
    // The reading is recomputed only through the live path; the offline path is
    // a read, so an offline screen never silently produces a second answer.
    const page = read(INSIGHTS_PAGE);
    expect(page).not.toContain("loadInsights(");
    expect(page).toContain("useInsights");
  });
});

describe("phase 6 — safety and scope", () => {
  it("no screen claims a medical risk score any more", () => {
    // `analyzeLoads` keeps its field — that is a tested contract of an older
    // module — but no screen may print it as a verdict on the athlete.
    const metrics = code(read(METRICS));
    expect(metrics).not.toMatch(/injury risk/i);
    expect(metrics).not.toContain("analysis.injuryRisk");
    // The actionable version is there instead.
    expect(metrics).toContain("workloadStatus");
    expect(metrics).toContain("not a medical assessment");
  });

  it("keeps the new reasoning pure: no clock, no database, no JSX", () => {
    for (const f of ["/src/lib/insights.ts", "/src/lib/explanations.ts"]) {
      const source = read(f);
      expect(source, `${f} reads the clock`).not.toMatch(/new Date\(|Date\.now\(/);
      expect(source, `${f} reaches the database`).not.toContain("supabase");
      expect(source, `${f} is a component`).not.toContain("from \"react\"");
    }
  });

  it("keeps the database access in the one impure module", () => {
    const plan = read(PLAN);
    expect(plan).toContain("supabase");
    // Today is passed in, not read inside the pure layer.
    expect(plan).toMatch(/today: string = localDateKey\(\)/);
  });

  it("counts a session inside a recorded break as excused, as Phase 1 requires", () => {
    // The denominator rule is Phase 1's, and the analytics layer must call it
    // rather than re-deriving it — a holiday reading as fourteen failures was a
    // real bug this product already fixed once.
    expect(read(PLAN)).toContain("countsTowardCompletion");
  });

  it("leaves the parent view reading the sanitized overview it already had", () => {
    // Phase 6 adds no athlete-visible surface to a guardian. A linked parent
    // reads one Postgres function written in Phase 4 — general status, no raw
    // metrics — and nothing in this phase adds a second path into the athlete's
    // training. A parent getting the new readings by accident would be a
    // privacy regression dressed as a feature.
    const guardian = read("/src/pages/Guardian.tsx");
    expect(guardian).toContain("guardian_athlete_overview");
    expect(guardian).not.toMatch(/insights/i);
  });

  it("needs no schema change, because the reading is derived rather than stored", () => {
    // Explanations here are computed from rows that already exist and cached on
    // the device (Phase 5). A new table would be a second source of truth for
    // numbers that are already reproducible from `workouts` and `plan_events`.
    const migrations = readdirSync(path.resolve(__dirname, "../..", "supabase", "migrations"));
    expect(migrations.some((f) => /phase6|insight/i.test(f))).toBe(false);
  });
});
