// ============================================================================
// /insights — the refined analytics screen
// ----------------------------------------------------------------------------
// Seven readings, each one a sentence the athlete can act on, and none of them
// a chart for its own sake. The specification for this phase is explicit that
// analytics should answer "what am I doing, why, how am I progressing, and what
// should I do next" — so every card here is the metric, the recommendation, and
// the reasons behind a tap. The only visualisation on the page is the weekly
// load strip, and it earns its place because the shape of eight weeks is the
// thing a single number cannot say.
//
// Progressive disclosure is the whole layout: the lead card is the most
// actionable reading, the grid is the rest, and the numbers that cannot be
// computed yet are listed last with the reason and what would fix it. Nothing
// here is a placeholder — a metric with no data says so instead of showing a
// zero, because a zero is a claim.
// ============================================================================

import { Link } from "react-router-dom";
import { ArrowRight, CloudOff, Gauge, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInsights } from "@/hooks/useInsights";
import { cacheAgeLabel } from "@/lib/offlineCache";
import { insightsSourceLabel } from "@/lib/insightsPlanning";
import type { InsightMetric } from "@/lib/insights";
import WhyDisclosure from "@/components/insights/WhyDisclosure";

/** Eight bars, one per week. Heights are relative to the window's own peak. */
const LoadStrip = ({ metric }: { metric: InsightMetric }) => {
  const series = metric.series ?? [];
  if (series.length === 0) return null;
  const peak = Math.max(...series, 1);
  return (
    <div className="mt-3">
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`Weekly load, ${series.length} weeks`}>
        {series.map((value, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${i === series.length - 1 ? "bg-primary" : "bg-primary/40"}`}
            // Floor of 4% so a genuine zero week still shows as a bar rather
            // than as a gap in the row, which would read as missing data.
            style={{ height: `${Math.max(4, Math.round((value / peak) * 100))}%` }}
            title={`${value} load`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/70">
        <span>{series.length} weeks ago</span>
        <span>this week</span>
      </div>
      {metric.seriesSports && metric.seriesSports.length > 1 ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Across {metric.seriesSports.join(" and ")}.
        </p>
      ) : null}
    </div>
  );
};

const MetricCard = ({ metric }: { metric: InsightMetric }) => (
  <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {metric.label}
      </h2>
      <span className="font-display text-lg font-bold">{metric.value}</span>
    </div>
    <WhyDisclosure explanation={metric} className="mt-3" />
    {metric.id === "load_trend" ? <LoadStrip metric={metric} /> : null}
  </section>
);

const InsightsPage = () => {
  const { user } = useAuth();
  const { state, refresh, busy } = useInsights(user?.id ?? null);

  if (state.kind === "loading") {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-10">
        <p className="text-sm text-muted-foreground">Reading your training…</p>
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-10">
        <h1 className="font-display text-2xl font-bold">Your training insights</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          There is nothing to read yet. Log a few sessions — or import your history — and this
          becomes a reading of how you are actually training: consistency, workload, recovery and
          what it adds up to.
        </p>
        <Link
          to="/profile"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Import your training history
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    );
  }

  const { insights, offline, savedAt, stale } = state;
  const available = insights.metrics.filter((m) => m.available);
  const unavailable = insights.metrics.filter((m) => !m.available);
  const source = insightsSourceLabel(insights);
  const lead = insights.top;

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Your training insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {insights.sessionCount} session{insights.sessionCount === 1 ? "" : "s"} in the last{" "}
            {insights.windowDays} days
            {source ? ` · ${source}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-60"
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : undefined} aria-hidden />
          Refresh
        </button>
      </header>

      {offline && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <CloudOff size={13} aria-hidden />
          Offline — showing the reading saved to this device
          {savedAt ? ` ${cacheAgeLabel(Date.now() - savedAt)}` : ""}.
          {stale ? " It is old enough that your training may have moved on since." : ""}
        </p>
      )}

      {insights.empty ? (
        <p className="mt-4 rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
          {insights.reason}
        </p>
      ) : (
        <>
          {lead && (
            <section className="mt-5 rounded-2xl border border-primary/30 bg-gradient-card p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                <Gauge size={12} aria-hidden />
                What needs your attention
              </div>
              <p className="mt-2 font-display text-base font-bold">{lead.headline}</p>
              {/* The disclosure carries the next step itself, so the card does
                  not say it twice — an open panel plus an identical line under
                  it reads as a template rather than as advice. */}
              <WhyDisclosure explanation={lead} defaultOpen className="mt-3 bg-background/40" />
            </section>
          )}

          {/* `grid-cols-1` is not decoration: a bare `grid` with only a
              breakpoint variant leaves mobile with an auto track sized to
              max-content, which overflows the viewport. overflowLayout.test.ts
              catches it; the explicit base column is the fix. */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {available
              .filter((m) => m.id !== lead?.id)
              .map((metric) => (
                <MetricCard key={metric.id} metric={metric} />
              ))}
          </div>

          {unavailable.length > 0 && (
            <section className="mt-6">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Not measurable yet
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {unavailable.map((metric) => (
                  <div
                    key={metric.id}
                    className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-4"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {metric.label}
                      </h3>
                      <span className="text-xs text-muted-foreground">{metric.value}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      {metric.headline}
                    </p>
                    {metric.why.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {metric.why.map((reason) => (
                          <li key={reason.text} className="text-[11px] text-muted-foreground/70">
                            · {reason.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    {metric.nextStep ? (
                      <p className="mt-2 text-[12px] text-foreground/90">{metric.nextStep}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              What this is based on
            </h2>
            <ul className="mt-2 space-y-1.5">
              {insights.caveats.map((line) => (
                <li key={line} className="text-xs leading-relaxed text-muted-foreground/80">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* The row sits outside the empty/full branch on purpose. An athlete with
          nothing logged yet was the one who most needed somewhere to go: the
          empty state ended with "log a few sessions or import your history" and
          offered no route to either, so the screen read as a dead end exactly
          when it should have been an invitation. */}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          to="/training"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
        >
          Open your plan
          <ArrowRight size={14} aria-hidden />
        </Link>
        <Link
          to="/goals"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
        >
          Goals and roadmap
          <ArrowRight size={14} aria-hidden />
        </Link>
        <Link
          to="/recovery"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
        >
          Log a check-in
          <ArrowRight size={14} aria-hidden />
        </Link>
        {/* "Plan changes" is one of these seven readings, and it was the only
            one with nowhere to go. The life that moved the plan is recorded on
            the availability screen, so that is where this points. */}
        <Link
          to="/availability"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
        >
          Availability and breaks
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  );
};

export default InsightsPage;
