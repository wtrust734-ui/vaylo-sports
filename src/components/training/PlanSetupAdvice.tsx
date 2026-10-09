import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ChevronDown, Sparkles, Wand2 } from "lucide-react";

import type { SetupAdvice } from "@/lib/planSetupAdvice";

// ============================================================================
// The recommendation layer of the create-plan wizard
// ----------------------------------------------------------------------------
// Presentation only — every number comes from `@/lib/planSetupAdvice`, which is
// pure and unit-tested. What lives here is the shape of the suggestion:
//
//   • a chip on each field that *is* the recommendation, so a tap answers the
//     question instead of the athlete having to invent an answer,
//   • one panel per step saying what the whole setup would be, for the athlete
//     who does not want to answer ten questions at all,
//   • and, for an advanced athlete, a note that says these are defaults and not
//     instructions — they were explicit about knowing their own week.
//
// The reasons are behind a toggle rather than always on screen: the athlete who
// needs the number should not have to read a paragraph to get it, and the one
// who wants to know why asked a question the app can actually answer.
// ============================================================================

/** The small "Recommended · 4" chip that sits next to a field's label. */
export function RecommendedChip({
  value,
  onApply,
  applied,
  label = "Recommended",
}: {
  value: string;
  onApply: () => void;
  /** True when the field already holds the recommended value. */
  applied?: boolean;
  label?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onApply}
      whileTap={{ scale: 0.96 }}
      aria-label={`${label}: ${value}`}
      className={`inline-flex min-h-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
        applied
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-electric-purple/40 bg-electric-purple/10 text-electric-purple hover:bg-electric-purple/20"
      }`}
    >
      <Sparkles size={10} />
      {label} · {value}
    </motion.button>
  );
}

/** The one-line "why" that sits under a control, shown when the athlete asks. */
function Reason({ text }: { text: string }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>;
}

/**
 * The step-level card. `onApplyAll` fills every answer this step owns, which is
 * the escape hatch for the athlete who does not know what any of it means.
 */
export function AdvicePanel({
  step,
  advice,
  onApplyAll,
  onApplyField,
  applied,
}: {
  step: 1 | 2 | 3;
  advice: SetupAdvice;
  onApplyAll: () => void;
  onApplyField: (field: keyof SetupAdvice) => void;
  /** Which of this step's fields already match the recommendation. */
  applied: Partial<Record<keyof SetupAdvice, boolean>>;
}) {
  const [showWhy, setShowWhy] = useState(false);

  // The fields each step is responsible for, with the label the athlete sees.
  const fields: { field: keyof SetupAdvice; value: string; reason: keyof SetupAdvice["reasons"] }[] =
    step === 1
      ? [{ field: "durationWeeks", value: `${advice.durationWeeks} weeks`, reason: "duration" }]
      : step === 2
      ? [
          { field: "daysPerWeek", value: `${advice.daysPerWeek} days`, reason: "daysPerWeek" },
          { field: "restDays", value: `${advice.restDays} full rest`, reason: "restDays" },
          { field: "sessionLengthPref", value: advice.sessionLengthPref, reason: "sessionLength" },
          { field: "hoursPerWeek", value: `~${advice.hoursPerWeek}h/wk`, reason: "hoursPerWeek" },
        ]
      : [
          { field: "intensityPref", value: advice.intensityPref, reason: "intensity" },
          { field: "environment", value: advice.environment, reason: "environment" },
          { field: "focusAreas", value: "focus areas", reason: "focusAreas" },
        ];

  return (
    <div className="rounded-2xl border border-electric-purple/25 bg-electric-purple/[0.06] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-electric-purple">
            <Wand2 size={12} /> Recommended
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground">
            {advice.athleteKnowsBest
              ? "You train at an advanced level, so these are defaults you can ignore — but they are a sensible starting point."
              : "Not sure what to pick? These are built for your level and age, and you can change any of them."}
          </p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onApplyAll}
          className="press shrink-0 rounded-xl bg-gradient-electric px-3 py-2 text-[12px] font-semibold text-primary-foreground shadow-electric"
        >
          Use these
        </motion.button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {fields.map(({ field, value }) => (
          <button
            key={field}
            type="button"
            onClick={() => onApplyField(field)}
            className={`rounded-full border px-2 py-1 text-[11px] font-semibold capitalize transition-colors ${
              applied[field]
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:border-electric-purple/40"
            }`}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
          className="inline-flex min-h-0 items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground"
        >
          Why? <ChevronDown size={11} className={`transition-transform ${showWhy ? "rotate-180" : ""}`} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showWhy && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1.5 border-t border-electric-purple/20 pt-2">
              {fields.map(({ field, reason }) => (
                <Reason key={field} text={advice.reasons[reason]} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The two fields this module deliberately does not recommend get their
          honest note here, so "no suggestion" never looks like an oversight:
          equipment is an inventory question, time of day is a life question. */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
        {step === 2 ? advice.reasons.timeOfDay : advice.reasons.equipment}
      </p>
    </div>
  );
}

/**
 * Shown once the athlete says they are advanced. The product rule is that an
 * advanced athlete gets to set their own week; this is the app saying so out
 * loud rather than leaving them to wonder whether the badges are compulsory.
 */
export function AdvancedFreedomNote() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-energy" />
      You picked <span className="font-semibold text-foreground">advanced</span>, so nothing here is
      pre-filled for you — set the week the way you actually train. The recommendations are still there
      if you want them.
    </p>
  );
}
