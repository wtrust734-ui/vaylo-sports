import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";

import { expectedPlanSeconds, planChunkCount } from "@/lib/planGeneration";

// ============================================================================
// PLAN GENERATION PROGRESS
// ----------------------------------------------------------------------------
// Creating a plan is a long wait — the model writes every session of every week
// — and until this existed the only feedback was a button that said
// "Creating…". Athletes left the screen, tapped Create twice, or assumed the
// app had hung, and the plan arrived afterwards to an empty wizard.
//
// What is honest here, and what is not, matters. The server does not stream
// progress, so the percentage is a TIME ESTIMATE, not a measured one. So the
// bar is presentational and the *stages* carry the meaning: each one names work
// that genuinely happens, in the order it happens. The bar only claims
// "roughly this far through the wait", and past the estimate it stops and says
// so rather than sailing to 99% and lying.
//
// The last line is a promise the server actually keeps: `generate-plan` charges
// up front and refunds on every failure path (provider error, malformed output,
// throw), so telling the athlete their credits are safe while they wait is not
// marketing — it is the documented behaviour of that function.
// ============================================================================

type Stage = { label: string; detail: string };

function stagesFor(weeks: number): Stage[] {
  return [
    { label: "Reading your training history", detail: "Personal bests, injuries, recent load and recovery" },
    { label: "Setting the periodisation", detail: `Deload placement and weekly progression for ${weeks} weeks` },
    { label: "Writing the sessions", detail: "Every day of every week, chosen around your equipment and caps" },
    { label: "Checking the safety limits", detail: "Age caps, rest days and session lengths" },
    { label: "Saving your plan", detail: "Almost there" },
  ];
}

export default function PlanGenerationProgress({ weeks }: { weeks: number }) {
  const reduceMotion = useReducedMotion();
  const stages = useMemo(() => stagesFor(weeks), [weeks]);
  const expected = useMemo(() => expectedPlanSeconds(weeks), [weeks]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => window.clearInterval(id);
  }, []);

  // Asymptotic, and capped below 100 on purpose: the app cannot know when the
  // call returns, so the bar must never be the thing that says "done".
  const percent = Math.min(94, 94 * (1 - Math.exp((-1.7 * elapsed) / expected)));

  // The writing stage owns most of the wait, so the stage index is mapped
  // against the real time each phase takes instead of an even split.
  const stage = elapsed < 2 ? 0 : elapsed < expected * 0.22 ? 1 : elapsed < expected * 0.86 ? 2 : elapsed < expected * 0.95 ? 3 : 4;
  const overdue = elapsed > expected * 2.2;

  // One block per chunk the server actually requests the plan in — a week each
  // for any plan up to twelve weeks (see planChunkWeeks); they light together
  // because those calls run at the same time.
  const chunks = planChunkCount(weeks);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="rounded-2xl border border-primary/25 bg-gradient-card p-4 shadow-card"
    >
      <div className="flex items-center gap-2">
        <Loader2 size={16} className={`text-primary ${reduceMotion ? "" : "animate-spin"}`} aria-hidden />
        <p className="text-sm font-semibold">Building your {weeks}-week plan</p>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {overdue ? "still working" : `~${Math.max(5, Math.round((expected - elapsed) / 5) * 5)}s left`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label="Plan generation progress"
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        {/* A CSS width transition rather than a motion animation: the value
            changes every 250ms and each change is a small step, so the
            interpolation belongs in the compositor, not in JS. */}
        <div
          className="h-full rounded-full bg-gradient-primary transition-[width] duration-300 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-3 space-y-1.5">
        {stages.map((s, i) => (
          <li key={s.label} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                i < stage
                  ? "border-success/40 bg-success/15 text-success"
                  : i === stage
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground"
              }`}
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
          : "Longer plans take longer to write. Credits are only kept if a plan is delivered — if anything fails, the cost is refunded automatically."}
      </p>
    </div>
  );
}
