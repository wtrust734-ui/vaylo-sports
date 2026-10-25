import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";

// ============================================================================
// PLAN BUILD PROGRESS — the build screen for plans made on the device
// ----------------------------------------------------------------------------
// Training plans are assembled locally, which is fast — fast enough that the
// button used to teleport an athlete from the questionnaire straight into the
// finished plan. That was disorienting: the plan is the point of the screen,
// and nothing on it said it had been built from their answers.
//
// This is the screen for that moment. It runs a real 0→100% counter over a
// fixed 10–20 seconds (longer plans take slightly longer), names the same
// stages the builder actually performs, and only then reveals the plan. The
// work itself is already done — the plan is saved before the bar finishes — so
// this never makes generation slower; it makes it legible.
//
// It is a portal into <body> for the same reason BottomSheet is: the plan
// questionnaire contains elements with their own stacking contexts, and an
// overlay rendered inside one of those would sit under the tab bar.
// ============================================================================

type Stage = { label: string; detail: string };

const STAGES: Stage[] = [
  { label: "Reading your answers", detail: "Age, availability, equipment, notes and access needs" },
  { label: "Building the week", detail: "Training days spread out, full rest where you asked for it" },
  { label: "Writing the sessions", detail: "Warm-ups, main work and cool-downs for your sport" },
  { label: "Checking the safety limits", detail: "Age caps, session lengths and the adaptations you need" },
  { label: "Saving your plan", detail: "Almost there" },
];

export type PlanBuildProgressProps = {
  /** Weeks in the plan being built. */
  weeks: number;
  /**
   * The athlete's own answers, as short phrases. Showing them is the point: a
   * build screen that lists the work but not the inputs looks like a template
   * being filled in, and the athlete has no way to see that the days they
   * chose and the notes they wrote actually went in.
   */
  details?: string[];
  /** How long the counter takes, in seconds. Defaults to 10–20 by plan length. */
  seconds?: number;
  /** Called once, after the counter reaches 100% and is shown there. */
  onComplete: () => void;
};

/** 10s for a short block up to 20s for a full season. */
export const buildSecondsFor = (weeks: number): number => {
  const safe = Number.isFinite(weeks) ? Math.max(1, Math.min(52, Math.round(weeks))) : 4;
  return Math.max(10, Math.min(20, 10 + safe * 0.6));
};

/** Which stage the bar is in, from its percentage. */
const stageFor = (pct: number): number => {
  if (pct < 20) return 0;
  if (pct < 48) return 1;
  if (pct < 82) return 2;
  if (pct < 97) return 3;
  return 4;
};

export default function PlanBuildProgress({ weeks, seconds, details, onComplete }: PlanBuildProgressProps) {
  const totalMs = Math.max(1, (seconds ?? buildSecondsFor(weeks)) * 1000);
  const [pct, setPct] = useState(0);
  // The counter owns its timing; `onComplete` is held in a ref so a parent
  // re-render (a toast, a query settling) can never restart the countdown.
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const next = Math.min(100, Math.round((elapsed / totalMs) * 100));
      setPct(next);
      if (next >= 100 && !completed.current) {
        completed.current = true;
        window.clearInterval(id);
        // Hold the finished bar briefly: hitting 100% and vanishing in the same
        // frame reads as a glitch rather than a completion.
        window.setTimeout(() => onCompleteRef.current(), 450);
      }
    }, 80);
    return () => window.clearInterval(id);
  }, [totalMs]);

  const stage = stageFor(pct);

  const overlay = (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="plan-build-progress"
      className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-background px-5 pb-[calc(var(--vaylo-inset-bottom)+1.5rem)] pt-[calc(var(--vaylo-screen-top)+1rem)]"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 py-6">
        <div className="text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
            <Loader2 size={24} className="animate-spin text-primary-foreground" aria-hidden />
          </span>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
            Building your plan
          </p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums" aria-hidden>
            {pct}%
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {weeks}-week plan · personalised from your answers
          </p>
          {details && details.length > 0 ? (
            <ul
              aria-label="What this plan is built from"
              className="mt-3 flex flex-wrap justify-center gap-1.5"
            >
              {details.map((detail) => (
                <li
                  key={detail}
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] leading-none text-muted-foreground"
                >
                  {detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Training plan build progress"
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-gradient-primary transition-[width] duration-150 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ol className="space-y-2">
          {STAGES.map((item, index) => {
            const done = index < stage;
            const active = index === stage;
            return (
              <li key={item.label} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                    done
                      ? "border-success/40 bg-success/15 text-success"
                      : active
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  {done ? <Check size={11} /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[13px] ${
                      active ? "font-semibold text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {item.label}
                  </span>
                  {active ? (
                    <span className="block text-[12px] leading-relaxed text-muted-foreground">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Your notes, access needs and the days you chose are all part of this plan. It is saved
          before this finishes, so nothing is lost if you close the app.
        </p>
      </div>
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}
