import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";

import { planChunkCount } from "@/lib/planGeneration";
import { estimatePlanSeconds, type EstimateSource } from "@/lib/planTiming";

// ============================================================================
// PLAN GENERATION PROGRESS — the full-screen loading screen for AI plans
// ----------------------------------------------------------------------------
// Creating a plan goes through the AI and takes a while. This covers the screen,
// names the work in the order the server does it, and moves, because a spinner
// with no progress reads as a hang.
//
// It leads with a PERCENTAGE, not a countdown. The server does not stream
// progress, so the two honest options are "how much of the estimate has been
// spent" and "how long you have been waiting". Seconds-so-far answers a question
// nobody asked — an athlete watching a plan arrive wants to know how far along
// it is, not how long they have been staring at it — and it made a short wait
// read as a long one. The bar is paced by a calibrated estimate (see
// `planTiming.ts`), and it settles below 100% until the plan actually exists:
// the app must never be the thing that claims the work is finished.
//
// There is no "Xs left" anywhere in this file, deliberately. The old screen
// derived one from `expected - elapsed` and parked on "5 seconds left" for the
// whole overrun. Past 1.5× its own estimate it stops implying it knows and says
// the plan is taking longer than usual, which is true whenever the work outlasts
// the model.
//
//   * A WAY OUT. A full-screen overlay that cannot be dismissed is a trap, and
//     the request cannot be cancelled from here — so `Hide` drops the overlay and
//     the page keeps a compact inline version of the same status.
//
// The last line is a promise the server keeps: `generate-plan` and
// `generate-nutrition-plan` charge up front and refund on every failure path,
// so telling the athlete their credits are safe while they wait is not
// marketing — it is documented behaviour.
// ============================================================================

type Stage = { label: string; detail: string };

/**
 * Which pipeline the overlay is describing.
 *
 * Each stage below names work the matching edge function genuinely does, in
 * order:
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

/**
 * How far through the wait the bar is, from 0 to 1.
 *
 * Asymptotic: fast at the start, slower as it settles, never climbing past its
 * own claim. 2.6 (rather than a linear ramp) is what makes a ~20 s nutrition
 * plan read as moving from the first frame: at half the estimate it is already
 * near 70%, and the last few points are deliberately the slowest, because that
 * is where an athlete watches most closely and where a bar that keeps promising
 * "nearly there" is most likely to be wrong.
 */
function progressFor(elapsed: number, expected: number): number {
  return 1 - Math.exp((-2.6 * elapsed) / Math.max(expected, 1));
}

export type PlanGenerationProgressProps = {
  weeks: number;
  /** Which plan is being built. Defaults to "training"; Nutrition passes
   *  "nutrition" so the stages and the estimate describe its real pipeline. */
  kind?: PlanGenerationKind;
  /** `overlay` (the default) covers the screen; `inline` is the same status as
   *  a card, for after the athlete has hidden the overlay. */
  variant?: "overlay" | "inline";
  /** Where the estimate comes from. When the caller does not supply one the
   *  component calibrates from this device's recorded generation history for
   *  the same kind (see `planTiming.ts`) and falls back to that pipeline's
   *  documented model when there is not enough of it. Either way the number is
   *  only used to pace the bar — it is never printed on this screen. */
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
    () => estimate?.seconds ?? estimatePlanSeconds(kind, weeks).seconds,
    [estimate, kind, weeks],
  );
  const [elapsed, setElapsed] = useState(0);

  // The wait has no progress stream, so elapsed time is the only thing that
  // moves the bar and the stages. Without this the screen is a frozen frame.
  // The interval is owned by this component instance; when React unmounts the
  // overlay the cleanup clears it. The parent owns whether a generation is in
  // flight, so hiding the overlay never cancels the request.
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

  const pct = useMemo(() => progressFor(elapsed, expected) * 100, [elapsed, expected]);
  // Hard ceiling below 100: the plan does not exist until the call returns, and
  // a bar that reaches 100 first is the screen lying about completion.
  const cappedPct = Math.min(94, pct);
  const shownPct = Math.round(cappedPct);

  const stage =
    elapsed < 2
      ? 0
      : elapsed < expected * 0.22
        ? 1
        : elapsed < expected * 0.86
          ? 2
          : elapsed < expected * 0.95
            ? 3
            : 4;
  // Past 1.5× the model, the estimate has stopped being useful and the screen
  // says so instead of implying the bar knows something it does not.
  const overdue = elapsed > expected * 1.5;

  // One block per chunk the server actually requests the plan in — a week each
  // for any plan up to twelve weeks (see planChunkWeeks); they light together
  // because those calls run at the same time.
  const chunks = useMemo(() => planChunkCount(weeks), [weeks]);

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Loader2 size={16} className={`text-primary ${reduceMotion ? "" : "animate-spin"}`} aria-hidden />
        <p className="text-sm font-semibold">
          Building your {weeks}-week {noun}
        </p>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{shownPct}%</span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shownPct}
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

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {overdue
          ? "This is taking longer than usual — the plan is still being written in the background. You can leave this screen and it will be saved when it lands."
          : "Credits are only kept if a plan is delivered — if anything fails, the cost is refunded automatically."}
      </p>

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

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
        Your answers are all part of this plan. It is saved to your account before this screen closes,
        so you can hide this and keep waiting in the background.
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
          {/* The percentage is the headline, and it is a fraction of the wait
              rather than a countdown. It stays on screen during an overrun
              too: swapping it for a word at the moment the athlete is most
              anxious is how a moving screen starts to look stuck.
              `aria-hidden` because the progressbar below already carries the
              same value for assistive tech — reading it twice is noise. */}
          <p className="text-3xl font-display font-bold tabular-nums" aria-hidden>
            {shownPct}%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {overdue
              ? "Taking longer than usual — still being written"
              : `of the wait for your ${weeks}-week ${noun}`}
          </p>
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
