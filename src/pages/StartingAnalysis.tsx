// ============================================================================
// /starting-analysis — "Your Vaylo Starting Analysis"
// ----------------------------------------------------------------------------
// The screen an athlete lands on after importing history. It reads the stored
// snapshot from `workout_imports` — the same words they were shown when the
// import finished — and falls back to the offline cache when the account cannot
// be reached, saying which of the two it is showing.
//
// Every section here is optional by design. `buildStartingAnalysis` returns null
// for anything the record cannot support, so the page renders what exists and
// prints the reason for the rest; there is no filler standing in for data.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CloudOff,
  Gauge,
  Target,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cacheAgeLabel, cacheRead, cacheWrite } from "@/lib/offlineCache";
import { IMPORT_SOURCE } from "@/lib/health/importRunner";
import {
  computeStartingAnalysis,
  loadStoredAnalysis,
  type ImportRun,
} from "@/lib/health/importRunner";
import { sourceLabel } from "@/lib/health/importHistory";
import type { AnalysisInsight, StartingAnalysis } from "@/lib/health/startingAnalysis";

interface Snapshot {
  analysis: StartingAnalysis;
  run: ImportRun | null;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ready";
      snapshot: Snapshot;
      offline: boolean;
      savedAt: number | null;
      /**
       * True when this was computed from the record just now rather than read
       * off an import row. The screen says which, because "what you were shown
       * when you imported" and "what your training says today" are different
       * claims and only one of them is a stored snapshot.
       */
      live: boolean;
    }
  | { kind: "none" };

/**
 * One insight, with its basis shown rather than hidden.
 *
 * The tone is carried by the rule down the left edge rather than by a word: an
 * earlier draft announced it in a screen-reader-only span, which said nothing
 * useful to a screen reader and leaked "strength"/"watch" into the page's text.
 */
function InsightCard({ insight, accent }: { insight: AnalysisInsight; accent: string }) {
  return (
    <li className={`rounded-xl border border-l-2 border-border/60 bg-card/40 p-3 ${accent}`}>
      <p className="text-sm font-semibold">{insight.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{insight.detail}</p>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
        {insight.basedOn}
      </p>
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-bold">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

const StartingAnalysisPage = () => {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!user) return;
    const cached = cacheRead<Snapshot>(user.id, "startingAnalysis");
    try {
      // 1. The stored snapshot wins when there is one: it is what the athlete
      //    was shown, and an analysis of a starting point should not drift.
      const stored = await loadStoredAnalysis(user.id);
      if (stored) {
        const snapshot: Snapshot = { analysis: stored.analysis, run: stored.run };
        cacheWrite(user.id, "startingAnalysis", snapshot);
        setState({ kind: "ready", snapshot, offline: false, savedAt: null, live: false });
        return;
      }
      // 2. No snapshot, but training exists: read the record itself. Forty
      //    logged sessions deserve a reading even if nothing was ever imported.
      const analysis = await computeStartingAnalysis(user.id);
      if (analysis.sessionCount > 0) {
        const snapshot: Snapshot = { analysis, run: null };
        cacheWrite(user.id, "startingAnalysis", snapshot);
        setState({ kind: "ready", snapshot, offline: false, savedAt: null, live: true });
        return;
      }
      setState({ kind: "none" });
    } catch {
      // Offline, or the account is unreachable. The cached reading is still a
      // reading — it just has to say how old it is.
      if (cached) {
        setState({
          kind: "ready",
          snapshot: cached.data,
          offline: true,
          savedAt: cached.savedAt,
          live: false,
        });
      } else {
        setState({ kind: "none" });
      }
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-10">
        <p className="text-sm text-muted-foreground">Reading your training…</p>
      </div>
    );
  }

  if (state.kind === "none") {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-10">
        <h1 className="font-display text-2xl font-bold">Your Vaylo Starting Analysis</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          There is nothing to read yet. Import your training history and Vaylo Sports will describe
          how you actually train — volume, rhythm, workload — from the sessions themselves.
        </p>
        <Link
          to="/profile"
          // `min-h-11` is not decoration: the 44px floor in index.css covers
          // buttons and selects, but deliberately not anchors, so a link styled
          // as a button has to claim the height itself.
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Import your training history
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    );
  }

  const { analysis, run } = state.snapshot;
  const importer = sourceLabel(run?.source ?? IMPORT_SOURCE) ?? "your connected app";
  const anyImported = analysis.importedCount > 0;

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Your Vaylo Starting Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {analysis.sessionCount} sessions
          {anyImported ? `, ${analysis.importedCount} imported from ${importer}` : ""}
          {analysis.firstDate && analysis.lastDate
            ? ` · ${analysis.firstDate} to ${analysis.lastDate}`
            : ""}
        </p>
        {state.live && (
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Read from your training as it stands today. Import your history for a starting-point
            reading you can come back to.
          </p>
        )}
      </header>

      {state.offline && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <CloudOff size={13} aria-hidden />
          Offline — showing the reading saved to this device
          {state.savedAt ? ` ${cacheAgeLabel(Date.now() - state.savedAt)}` : ""}.
        </p>
      )}

      {analysis.empty && (
        <p className="mt-4 rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
          {analysis.reason}
        </p>
      )}

      {analysis.patterns && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <BarChart3 size={16} aria-hidden /> Training patterns
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Typical week"
              value={`${analysis.patterns.weeklyVolumeMinutes} min`}
              sub={`${analysis.patterns.weeklySessionCount} sessions`}
            />
            <Stat
              label="Typical session"
              value={`${analysis.patterns.typicalSessionMinutes} min`}
              sub={`longest ${analysis.patterns.longestSessionMinutes} min`}
            />
            <Stat
              label="Usually"
              value={analysis.patterns.typicalIntensity ?? "—"}
              sub="estimated from duration and distance"
            />
            <Stat
              label="Sports"
              value={String(analysis.patterns.commonSports.length)}
              sub={analysis.patterns.commonSports
                .slice(0, 2)
                .map((s) => s.sport)
                .join(", ")}
            />
          </div>
        </section>
      )}

      {analysis.consistency && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <CalendarCheck size={16} aria-hidden /> Consistency
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You hit {analysis.consistency.targetPerWeek} or more sessions in{" "}
            <span className="font-semibold text-foreground">
              {analysis.consistency.weeksMeetingTarget} of {analysis.consistency.weeksConsidered}
            </span>{" "}
            weeks — {analysis.consistency.percent}%.
            {analysis.consistency.daysSinceLastSession > 0
              ? ` Last session logged ${analysis.consistency.daysSinceLastSession} days ago.`
              : ""}
          </p>
        </section>
      )}

      {analysis.recentWorkload && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Gauge size={16} aria-hidden /> Recent workload
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The last {analysis.recentWorkload.recentDays} days carry{" "}
            <span className="font-semibold text-foreground">
              {analysis.recentWorkload.recentLoad}
            </span>{" "}
            load across {analysis.recentWorkload.recentSessions} sessions.
            {analysis.recentWorkload.ratio === null
              ? " There is no earlier period in the record to compare it with yet."
              : analysis.recentWorkload.band === "high"
                ? ` That is well above the ${analysis.recentWorkload.recentDays} days before it.`
                : analysis.recentWorkload.band === "low"
                  ? ` That is well below the ${analysis.recentWorkload.recentDays} days before it.`
                  : " That is close to the period before it."}
          </p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <TrendingUp size={16} aria-hidden /> Progress
        </h2>
        {analysis.progress ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Your {analysis.progress.metric === "distance" ? "distance" : "session length"}
            {analysis.progress.sport ? ` in ${analysis.progress.sport}` : ""} went from{" "}
            {analysis.progress.fromValue} to {analysis.progress.toValue} (
            {analysis.progress.changePercent > 0 ? "+" : ""}
            {analysis.progress.changePercent}%).{" "}
            <span className="text-muted-foreground/70">{analysis.progress.basedOn}.</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{analysis.progressUnavailableReason}</p>
        )}
      </section>

      {analysis.goalAlignment && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Target size={16} aria-hidden /> Goal alignment
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{analysis.goalAlignment.text}</p>
        </section>
      )}

      {analysis.strengths.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold">What is working</h2>
          <ul className="mt-3 space-y-2">
            {analysis.strengths.map((s) => (
              <InsightCard key={s.id} insight={s} accent="border-l-emerald-400" />
            ))}
          </ul>
        </section>
      )}

      {analysis.issues.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <TriangleAlert size={16} aria-hidden /> Worth knowing
          </h2>
          <ul className="mt-3 space-y-2">
            {analysis.issues.map((s) => (
              <InsightCard key={s.id} insight={s} accent="border-l-amber-400" />
            ))}
          </ul>
        </section>
      )}

      {analysis.nextSteps.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold">Where to go next</h2>
          <ul className="mt-3 space-y-2">
            {analysis.nextSteps.map((s) => (
              <InsightCard key={s.id} insight={s} accent="border-l-sky-400" />
            ))}
          </ul>
          <Link
            to="/goals"
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
          >
            Go to your goals and roadmap
            <ArrowRight size={14} aria-hidden />
          </Link>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          What this is based on
        </h2>
        <ul className="mt-2 space-y-1.5">
          {analysis.caveats.map((line) => (
            <li key={line} className="text-xs leading-relaxed text-muted-foreground/80">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground/70">
          A reading of your own logged training — not a medical assessment.
        </p>
      </section>
    </div>
  );
};

export default StartingAnalysisPage;
