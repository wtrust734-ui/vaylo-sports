import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ShieldCheck } from "lucide-react";

import { INJURY_PROGRESS_CEILING, injuryPlanSeconds } from "@/lib/injuryPlan";

// ============================================================================
// INJURY PLAN PROGRESS — the screen shown while an AI rehab plan is written
// ----------------------------------------------------------------------------
// The plan is one provider call, so this screen cannot make the model faster.
// What it can do is be honest about the wait and legible: a real percentage
// that climbs steadily, the stages the plan actually goes through, and the
// facts it is being written from. The counter holds at 94% until the answer is
// saved — it never claims 100% before the plan actually exists on the row.
// ============================================================================

type Stage = { label: string; detail: string };

const STAGES: Stage[] = [
  { label: "Reading your injury log", detail: "The site, severity, how it happened and what still works" },
  { label: "Checking your training week", detail: "What has to stop, what can continue, how long the plan needs, how to build back" },
  { label: "Writing the rehab work", detail: "Mobility, activation and strength, week by week" },
  { label: "Saving it to this injury", detail: "The plan lands in this tab, on this injury" },
];

const stageFor = (pct: number): number => {
  if (pct < 24) return 0;
  if (pct < 52) return 1;
  if (pct < 82) return 2;
  return 3;
};

export type InjuryPlanProgressProps = {
  /** The injury the plan is for, shown so the wait is clearly about their injury. */
  bodyPart: string;
  severity: number;
  /** True once the plan has been written AND saved. */
  done: boolean;
  /** Override for tests. */
  seconds?: number;
};

export default function InjuryPlanProgress({
  bodyPart,
  severity,
  done,
  seconds,
}: InjuryPlanProgressProps) {
  const totalMs = Math.max(1, (seconds ?? injuryPlanSeconds()) * 1000);
  const [pct, setPct] = useState(0);
  // A parent re-render (a toast, a profile refresh) must not restart the climb.
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      const progress = Math.min(1, elapsed / totalMs);
      // Ease out: fast early movement, slower near the end, so the bar reads as
      // work happening rather than a timer counting down.
      const next = Math.round(INJURY_PROGRESS_CEILING * (1 - Math.pow(1 - progress, 1.7)));
      setPct((current) => Math.max(current, Math.min(INJURY_PROGRESS_CEILING, next)));
    }, 120);
    return () => window.clearInterval(id);
  }, [totalMs]);

  useEffect(() => {
    if (done) setPct(100);
  }, [done]);

  const stage = done ? STAGES.length : stageFor(pct);

  const overlay = (
    <div
      role="status"
      aria-live="polite"
      aria-busy={!done}
      data-testid="injury-plan-progress"
      className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-background px-5 pb-[calc(var(--vaylo-inset-bottom)+1.5rem)] pt-[calc(var(--vaylo-screen-top)+1rem)]"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 py-6">
        <div className="text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
            <ShieldCheck size={24} className="text-primary-foreground" aria-hidden />
          </span>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
            Writing your rehab plan
          </p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums" aria-hidden>
            {pct}%
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bodyPart} · severity {severity}/10
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Usually 10–20 seconds. Your credits are only kept if the plan is delivered.
          </p>
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="AI injury plan progress"
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-gradient-primary transition-[width] duration-200 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ol className="space-y-2">
          {STAGES.map((item, index) => {
            const complete = index < stage;
            const active = index === stage;
            return (
              <li key={item.label} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                    complete
                      ? "border-success/40 bg-success/15 text-success"
                      : active
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  {complete ? <Check size={11} /> : index + 1}
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
          The plan is built from what you logged and runs alongside your normal training. Keep this
          screen open until it finishes — the plan is saved to this injury the moment it arrives.
        </p>
      </div>
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}
