// ============================================================================
// SAVED NUTRITION PLAN — the plan, readable, after the week it was bought in
// ----------------------------------------------------------------------------
// A plan is bought per week and written as weeks of real days of real meals.
// Before this component the Nutrition tab listed the row and nothing else: the
// athlete had paid for a meal plan and could see "Maintain · 4w · 2200 kcal",
// which is a receipt, not a plan.
//
// The parsing is not re-implemented here. `parseGeneratedPlan` is the same
// defensive reader that a fresh response goes through, and it accepts the
// stored `plan_data` array AND the `{ summary, weeks }` a live call returns —
// which is exactly why an old plan and a new one render through this one path.
// A plan whose meals cannot be read says so; it never renders as an empty
// card over a charge.
// ============================================================================

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, UtensilsCrossed } from "lucide-react";

import { dayTotals, parseGeneratedPlan, planTotals } from "@/lib/nutritionPlan";
import type { Tables } from "@/integrations/supabase/types";

export default function SavedNutritionPlan({
  plan,
}: {
  /** The `nutrition_plans` row as it is stored. */
  plan: Pick<Tables<"nutrition_plans">, "plan_data" | "goal" | "weeks">;
}) {
  const parsed = parseGeneratedPlan(plan.plan_data);
  const weeks = parsed.plan?.weeks ?? [];
  const [weekIndex, setWeekIndex] = useState(0);

  // A plan can be shorter than its `weeks` column claims (the model answers
  // what it answers). Keep the selection inside the weeks that actually exist
  // rather than rendering nothing.
  useEffect(() => {
    if (weekIndex > weeks.length - 1) setWeekIndex(0);
  }, [weekIndex, weeks.length]);

  if (!parsed.plan || weeks.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {parsed.error || "This plan has no readable meals."} Nothing from your food log was affected — this is
            only the meal plan, and the targets above are still yours.
          </span>
        </p>
      </div>
    );
  }

  const week = weeks[Math.min(weekIndex, weeks.length - 1)];
  const weekTotals = planTotals(week);

  return (
    <div className="mt-3 space-y-3">
      {parsed.plan.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{parsed.plan.summary}</p>
      )}

      {parsed.droppedWeeks > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {parsed.droppedWeeks} week{parsed.droppedWeeks === 1 ? "" : "s"} could not be read and {parsed.droppedWeeks === 1 ? "is" : "are"} not shown.
        </p>
      )}

      {/* Week selector — a 12-week plan is 84 days of meals; one week at a time. */}
      {weeks.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {weeks.map((w, i) => (
            <button
              key={w.week}
              onClick={() => setWeekIndex(i)}
              aria-pressed={i === weekIndex}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                i === weekIndex
                  ? "bg-electric-purple/15 border-electric-purple text-electric-purple"
                  : "bg-card border-border text-muted-foreground hover:border-electric-purple/30"
              }`}
            >
              Week {w.week}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-electric-purple/20 bg-gradient-card p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Week {week.week} · {week.focus}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {weekTotals.calories} kcal/day
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
          Aiming at {week.calories} kcal · {week.protein_g}g P · {week.carbs_g}g C · {week.fat_g}g F a day
        </p>
        {/* The meals, averaged. When these disagree with the line above, the
            athlete is looking at the truth and not at the target. */}
        <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
          These days average {weekTotals.calories} kcal · {weekTotals.protein_g}g P · {weekTotals.carbs_g}g C · {weekTotals.fat_g}g F
        </p>
      </div>

      <div className="space-y-2">
        {week.days.map((day, i) => {
          const totals = dayTotals(day);
          return (
            <motion.div
              key={day.day}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-xl border border-border bg-background/40 p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-electric-purple">{day.dayName}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">{totals.calories} kcal</p>
              </div>

              {day.meals.length === 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1">No meals were written for this day.</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {day.meals.map((meal, mi) => (
                    <li key={`${meal.slot}-${mi}`} className="flex items-start gap-2">
                      <UtensilsCrossed size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">
                          {meal.slot ? `${meal.slot} — ` : ""}
                          {meal.name}
                        </p>
                        {meal.description && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{meal.description}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {meal.calories} kcal · {meal.protein_g}g P · {meal.carbs_g}g C · {meal.fat_g}g F
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {day.notes && <p className="text-[11px] text-muted-foreground mt-1.5 italic">{day.notes}</p>}

              <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                Day total: {totals.calories} kcal · {totals.protein_g}g P · {totals.carbs_g}g C · {totals.fat_g}g F
              </p>
            </motion.div>
          );
        })}
      </div>

      {week.days.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This week has no days written for it. Generate the plan again only if you want to pay for it again — the
          other weeks are still here.
        </p>
      )}
    </div>
  );
}
