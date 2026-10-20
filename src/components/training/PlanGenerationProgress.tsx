import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Clock, RefreshCw } from "lucide-react";

import { expectedPlanSeconds, planChunkCount } from "@/lib/planGeneration";
import { estimatePlanSeconds, type EstimateSource } from "@/lib/planTiming";

// ============================================================================
// PLAN GENERATION PROGRESS — the full-screen loading screen for AI plans
// ----------------------------------------------------------------------------
// Creating a plan goes through the AI and takes tens of seconds. Until this
// existed the only feedback was a button that spun and said "Creating…" and
// athletes assumed the app had hung, tapped Create twice, or left the screen
// with a request that could not be cancelled.
//
// This is a real loading screen, not a status card. It covers the entire
// screen, uses a proper progress bar rather than a spinner-only state, and
// tells the athlete the wait is real and moving — elapsed seconds plus the
// usual wait, because a wait with no progress stream cannot honestly answer
// "how long is left". Three things pay for it:
//
//   * A TIME ESTIMATE, not a percentage and never a countdown. The server
//     does not stream progress, so the bar is presentational and the *stages*
//     carry the meaning — each one names work that genuinely happens, in the
//     order it happens. The screen shows ELAPSED time ("23s so far", always
//     true) next to the usual wait ("usually about 40s", an honest average),
//     and never the arithmetic `expected - elapsed` dressed as "Xs left":
//     that number parks at "5 seconds left" for up to a minute when the
//     wait overruns, which is exactly the lie this screen used to tell.
//     Past 1.5× its own estimate it stops claiming a time at all and says
//     the plan is taking longer than usual — which is always the honest
//     answer when the work outlasted the model.
//
//   * A WAY OUT. A full-screen overlay that cannot be dismissed is a trap, and
//     the request is already in flight and cannot be cancelled from here — so
//     `Hide` drops the overlay and the page underneath keeps a compact inline
//     version of the same status. Nothing is lost by hiding it.
//
// The last line is a promise the server actually keeps: `generate-plan` charges
// up front and refunds on every failure path (provider error, malformed output,
// throw), so telling the athlete their credits are safe while they wait is not
// marketing — it is the documented behaviour of that function.
// ============================================================================

type Stage = { label: string; detail: string };

/**
 * Which pipeline the overlay is describing.
 *
 * This screen used to be training-shaped no matter who opened it: a nutrition
 * plan generation showed "Reading your training history" and "Setting the
 * periodisation" — steps `generate-nutrition-plan` never performs. Every stage
 * below names work the matching edge function genuinely does, in order:
 *
 *   training (`generate-plan`)     — dossier, periodisation, sessions, caps
 *   nutrition (`generate-nutrition-plan`) — intake/goals, week calorie+macro
 *                                           targets the APP computes, meals
 *                                           the model fills in, shape+safety
 *                                           validation, save
 */
export type PlanGenerationKind = "training" | "nutrition";

function stagesFor(kind: PlanGenerationKind, weeks: number): Stage[] {
  if (kind === "nutrition") {
    return [
      { label: "Reading your goals and intake", detail: "Body metrics, training days and the goal you picked" },
      { label: "Setting your calorie and macro targets", detail: `Weekly energy and protein targets for ${weeks} weeks` },
      { label: "Writing the meals", detail: "Every meal of every day, chosen around your dietary pattern" },
      { label: "Checking the safety limits", detail: "Adults only, portion sanity and week-shape validation" },
      { label: "Saving your plan", detail: "Almost there" },
    ];
  }
  return [
    { label: "Reading your training history", detail: "Personal bests, injuries, recent load and recovery" },
    { label: "Setting the periodisation", detail: `Deload placement and weekly progression for ${weeks} weeks` },
    { label: "Writing the sessions", detail: "Every day of every week, chosen around your equipment and caps" },
    { label: "Checking the safety limits", detail: "Age caps, rest days and session lengths" },
    { label: "Saving your plan", detail: "Almost there" },
  ];
}

/** How far through the wait is the bar, from 0 to 1. */
function progressFor(elapsed: number, expected: number): number {
  // Asymptotic curve: fast at the start, slower as it settles, never climbs
  // past its own claim. The constant is tuned so that at 60% of the estimate
  // the bar is at 80% — the visible wait is what matters, and the last third
  // is deliberately longer because that is where the athlete perceives the
  // longest time.
  return 1 - Math.exp((-2.2 * elapsed) / Math.max(expected, 1));
}

export type PlanGenerationProgressProps = {
  weeks: number;
  /** Which plan is being built. Defaults to "training" (the original screen);
   *  Nutrition passes "nutrition" so the stages describe its real pipeline. */
  kind?: PlanGenerationKind;
  /** `overlay` (the default) covers the screen; `inline` is the same status as
   *  a card, for after the athlete has hidden the overlay. */
  variant?: "overlay" | "inline";
  /** Where the estimate comes from. When the caller does not supply one the
   *  component calibrates from this device's recorded generation history
   *  (see `planTiming.ts`) and falls back to the documented model constants
   *  when there is not enough of it — and SAYS which it is quoting, because
   *  "usually about 40s" is a claim about measurements that an unmeasured
   *  constant must not make on its behalf. */
  estimate?: { seconds: number; source: EstimateSource };
  /** Only meaningful for the overlay: drops it without cancelling the request.
   *  Once hidden, it does not come back — the inline version is accurate. */
  onHide?: () => void;
};

export default function PlanGenerationProgress({
  weeks,
  kind = "training",
  variant = "overlay",
  estimate,
  onHide,
}: PlanGenerationProgressProps) {
  const reduceMotion = useReducedMotion();
  const stages = useMemo(() => stagesFor(kind, weeks), [kind, weeks]);
  // "plan" vs "meal plan": one noun, so the header never claims a training
  // plan to an athlete who is waiting on meals.
  const noun = kind === "nutrition" ? "meal plan" : "plan";
  const expected = useMemo(
    () => estimate?.seconds ?? (kind === "nutrition" ? expectedPlanSeconds(weeks) : estimatePlanSeconds("training", weeks).seconds),
    [estimate, kind, weeks],
  );
  // Which number the screen is quoting, labeled honestly. A history-based
  // estimate is measured ("usually"); a model fallback is unmeasured and
  // cannot claim that — it says "estimated" instead.
  const estimatedFromHistory = (estimate?.source ??
    (kind === "nutrition" ? "model" : estimatePlanSeconds("training", weeks).source)) === "history";
  const [elapsed, setElapsed] = useState(0);

  // The wait has no progress stream, so elapsed time is the only thing that
  // moves the bar and the stages. Without this the screen is a frozen frame.
  // The interval is owned by the component instance that mounted it; when React
  // unmounts the overlay (e.g. the athlete hid it, or navigated away) the
  // cleanup clears it. The parent (Training.tsx) owns whether a generation is
  // actually in flight, so dropping the overlay never cancels the request.
  useEffect(() => {
    let cancelled = false;
    const id = window.setInterval(() => {
      if (!cancelled) setElapsed((e) => e + 0.25);
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // The bar is an honest estimate. It claims nothing beyond what the server
  // actually does on failure, and past its own estimate it stops claiming a
  // time at all — which is always the honest answer when the work took longer
  // than the model predicted.
  // `progressFor` returns a 0–1 fraction; the bar, the label and the ARIA
  // value are all 0–100 percents. Forgetting the scale leaves the screen on
  // "0%" for the whole wait, which is exactly what this screen replaced.
  const pct = useMemo(() => progressFor(elapsed, expected) * 100, [elapsed, expected]);
  const cappedPct = Math.min(94, pct);
  const stage = elapsed < 2 ? 0 : elapsed < expected * 0.22 ? 1 : elapsed < expected * 0.86 ? 2 : elapsed < expected * 0.95 ? 3 : 4;
  // 1.5×, not 2.2×: the old threshold kept saying "5 seconds left" for the
  // whole overrun. The moment the wait outlasts the model by half again, the
  // estimate has stopped being useful and the screen says so.
  const overdue = elapsed > expected * 1.5;
  // Elapsed, floored — the only number on this screen that is a measurement
  // rather than a model. It ticks every second, never backwards, never stuck.
  const elapsedSecs = Math.floor(elapsed);

  // One block per chunk the server actually requests the plan in — a week each
  // for any plan up to twelve weeks (see planChunkWeeks); they light together
  // because those calls run at the same time.
  const chunks = useMemo(() => planChunkCount(weeks), [weeks]);

  // No countdown is ever derived here. `expected - elapsed` used to be
  // printed as "About Xs left" with a 5-second floor, which parked the
  // screen on "5 seconds left" for the entire overrun — tens of seconds of
  // a promise the app could not keep. The header states the usual wait and
  // the body states the elapsed wait; neither claims to know the future.
  const header = overdue
    ? "Still working — this plan is taking longer than usual"
    : estimatedFromHistory
      ? `Usually about ${expected}s for a ${weeks}-week plan`
      : `Estimated at about ${expected}s · based on the workflow, before enough of your own timings have been recorded`;

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Loader2 size={16} className={`text-primary ${reduceMotion ? "" : "animate-spin"}`} aria-hidden />
        <p className="text-sm font-semibold">Building your {weeks}-week {noun}</p>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {overdue ? "still working" : `${elapsedSecs}s so far`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cappedPct)}
        aria-label={`AI ${kind} plan generation progress`}
        className={`mt-3 h-2 w-full overflow-hidden rounded-full bg-muted ${variant === "overlay" ? "sm:h-2.5" : ""}`}
      >
        {/* A CSS width transition rather than a motion animation: the value
            changes every 250ms and each change is a small step, so the
            interpolation belongs in the compositor, not in JS. */}
        <div
          className="h-full rounded-full bg-gradient-primary transition-[width] duration-300 ease-linear"
          style={{ width: `${cappedPct}%` }}
        />
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Clock size={10} aria-hidden />
        <span>{header}</span>
        <RefreshCw size={10} className={`${reduceMotion ? "" : "animate-spin"}`} aria-hidden />
      </div>

      <ol className="mt-3 space-y-1.5">
        {stages.map((s, i) => (
          <li key={s.label} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${i < stage ? "border-success/40 bg-success/15 text-success" : i === stage ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
            >
              {i < stage ? <Check size={10} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-[12px] ${i === stage ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {s.label}
              </span>
              {i === stage && <span className="block text-[11px] text-muted-foreground">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      {stage === 2 && (
        <div className="mt-3 flex gap-1" aria-hidden>
          {Array.from({ length: chunks }).map((_, i) => (
            <motion.span
              key={i}
              className="h-1.5 flex-1 rounded-full bg-primary/25"
              animate={reduceMotion ? undefined : { opacity: [0.25, 0.9, 0.25] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
            />
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {overdue
          ? "This is taking longer than usual — the plan is still being written. You can leave this screen and it will be saved when it lands."
          : estimatedFromHistory
            ? `Most ${weeks}-week plans on this device have taken about ${expected}s. Credits are only kept if a plan is delivered — if anything fails, the cost is refunded automatically.`
            : `A ${weeks}-week plan is estimated at about ${expected}s; the figure sharpens to your own timing as plans complete. Credits are only kept if a plan is delivered — if anything fails, the cost is refunded automatically.`}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
        If this stays on screen much longer than the time above, the plan is still being written in the background — you do not need to stay here.
      </p>
    </>
  );

  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="rounded-2xl border border-primary/25 bg-gradient-card p-4 shadow-card"
      >
        {body}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="plan-generation-overlay"
      className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-background px-5 pb-[calc(var(--vaylo-inset-bottom)+1.5rem)] pt-[calc(var(--vaylo-screen-top)+1rem)]"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 py-6">
        <div className="text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
            <Loader2 size={24} className={`text-primary-foreground ${reduceMotion ? "" : "animate-spin"}`} aria-hidden />
          </span>
          {/* Elapsed seconds, not a percent: with no progress stream a "87%"
              headline is fabricated precision — it climbs toward a cap and
              parks there, which reads as "almost done" for a wait that may
              not be. Seconds-so-far is always true, and next to the usual
              wait it tells the athlete everything they need: keep waiting or
              make coffee. */}
          <p className="text-3xl font-display font-bold tabular-nums">{elapsedSecs}s</p>
          <p className="mt-1 text-xs text-muted-foreground">{header}</p>
        </div>

        <div className="rounded-2xl border border-primary/25 bg-card p-4 shadow-card">{body}</div>

        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="mx-auto min-h-[44px] rounded-xl border border-border bg-card px-5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40"
          >
            Hide — I&apos;ll keep waiting in the background
          </button>
        )}
      </div>
    </div>
  );
}
