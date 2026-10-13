// ============================================================================
// NUTRITION PLAN WIZARD — the questions a plan actually needs, asked in order
// ----------------------------------------------------------------------------
// The form this replaces asked four things: name, goal, length, and the calorie
// and macro targets the athlete was supposed to already know. The last part was
// the problem. An athlete who has never counted a macro cannot answer it, so the
// app was asking them to supply the one thing it was for.
//
// So the questions changed direction. It now asks what actually decides a daily
// intake — body size, how much they train, how they eat, what they avoid — and
// ANSWERS the target question itself, in a panel with its working shown. The
// athlete can accept it, or change any of it deliberately.
//
// Three steps rather than one wall of inputs, because thirteen fields in a
// single card on a phone is a form nobody finishes. Each step states what it is
// for. The recommendation updates as the answers do, and the reason it moved is
// visible rather than hidden behind the result.
//
// Presentation only: the arithmetic is in src/lib/nutritionTargets.ts, which is
// pure and tested, and the request itself belongs to the screen.
// ============================================================================

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Sparkles, X } from "lucide-react";

import { DISCLAIMERS, disclaimerShort } from "@/config/disclaimers";
import { earliestDob } from "@/lib/age";
import {
  ACTIVITY_LEVELS,
  BIOLOGICAL_SEXES,
  DIETARY_PATTERNS,
  NUTRITION_GOALS,
  RECOMMENDATION_BOUNDS,
  recommendTargets,
  type NutritionIntake,
} from "@/lib/nutritionTargets";

/** What the screen needs in order to make the request. */
export type PlanDraft = {
  intake: NutritionIntake;
  title: string;
  targets: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  /** True when the targets are the app's recommendation, untouched. */
  usedRecommended: boolean;
};

type Props = {
  initial: NutritionIntake;
  /**
   * Null when the profile has no date of birth. Calorie and macro targets are
   * only written for an adult, and an unknown date of birth is NOT an adult —
   * the same rule `public.viewer_is_adult()` applies server-side.
   *
   * Null is not a refusal any more, it is a question this form asks. It used to
   * dead-end here: the panel said "add your date of birth in Profile", the
   * button still said "Write my plan", and tapping it produced a toast. Almost
   * nobody has a date of birth on file, so almost nobody could build a plan.
   */
  age: number | null;
  /**
   * Persists a date of birth and resolves to null, or to the reason it cannot
   * be used. Owned by the screen: the wizard must not write to the database.
   */
  onSaveDob: (dob: string) => Promise<string | null>;
  savingDob: boolean;
  /** What one week costs, for the price on the button. */
  costPerWeek: number;
  busy: boolean;
  onSubmit: (draft: PlanDraft) => void;
  onClose: () => void;
};

const inputClass =
  "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-electric-purple/50 transition-all duration-300";

const labelClass = "text-[12px] text-muted-foreground";

const ACTIVITY_LABELS: Record<(typeof ACTIVITY_LEVELS)[number], string> = {
  desk: "Mostly seated",
  on_feet: "On my feet",
  manual: "Physical work",
};

const PATTERN_LABELS: Record<(typeof DIETARY_PATTERNS)[number], string> = {
  omnivore: "No restrictions",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  halal: "Halal",
  kosher: "Kosher",
};

const SEX_LABELS: Record<(typeof BIOLOGICAL_SEXES)[number], string> = {
  male: "Male",
  female: "Female",
  unspecified: "Prefer not to say",
};

const STEPS = ["About you", "Your training", "Food & detail"] as const;

const clampInt = (value: number, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** One tappable choice, used by every enum in the flow. */
function Choice<T extends string>({
  value,
  current,
  label,
  onSelect,
  disabled,
}: {
  value: T;
  current: T;
  label: string;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      disabled={disabled}
      className={`flex-1 min-w-[30%] px-3 py-2 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
        active
          ? "bg-electric-purple/15 border-electric-purple text-electric-purple"
          : "bg-card border-border text-foreground hover:border-electric-purple/30"
      }`}
    >
      {label}
    </button>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  options,
  value,
  labels,
  onSelect,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Choice
            key={option}
            value={option}
            current={value}
            label={labels[option]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default function NutritionPlanWizard({ initial, age, onSaveDob, savingDob, costPerWeek, busy, onSubmit, onClose }: Props) {
  const [intake, setIntake] = useState<NutritionIntake>(initial);
  const [title, setTitle] = useState("");
  const [step, setStep] = useState(0);
  const [usingRecommended, setUsingRecommended] = useState(true);
  const [edited, setEdited] = useState({ calories: "", protein_g: "", carbs_g: "", fat_g: "" });
  // The date of birth, when the profile has none. The upper bound is today: a
  // date in the future is not a birthday, and `validateDob` rejects it again
  // server-side of the field.
  const [dob, setDob] = useState("");
  const [dobError, setDobError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  // The recommendation is recomputed from the answers on screen, so the effect
  // of changing "4 days a week" to "6" is visible immediately rather than at the
  // end of a form.
  const recommendation = useMemo(
    () => recommendTargets(intake, age ?? 30),
    [intake, age],
  );

  const patch = (change: Partial<NutritionIntake>) => setIntake((current) => ({ ...current, ...change }));

  const targets = usingRecommended
    ? {
        calories: recommendation.calories,
        protein_g: recommendation.protein_g,
        carbs_g: recommendation.carbs_g,
        fat_g: recommendation.fat_g,
      }
    : {
        calories: clampInt(Number(edited.calories), RECOMMENDATION_BOUNDS.calories.min, RECOMMENDATION_BOUNDS.calories.max, recommendation.calories),
        protein_g: clampInt(Number(edited.protein_g), RECOMMENDATION_BOUNDS.protein.min, RECOMMENDATION_BOUNDS.protein.max, recommendation.protein_g),
        carbs_g: clampInt(Number(edited.carbs_g), RECOMMENDATION_BOUNDS.carbs.min, RECOMMENDATION_BOUNDS.carbs.max, recommendation.carbs_g),
        fat_g: clampInt(Number(edited.fat_g), RECOMMENDATION_BOUNDS.fat.min, RECOMMENDATION_BOUNDS.fat.max, recommendation.fat_g),
      };

  const cost = costPerWeek * intake.weeks;
  const last = step === STEPS.length - 1;

  const startEditing = () => {
    setEdited({
      calories: String(targets.calories),
      protein_g: String(targets.protein_g),
      carbs_g: String(targets.carbs_g),
      fat_g: String(targets.fat_g),
    });
    setUsingRecommended(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-2xl p-4 space-y-4 mb-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-bold text-sm">Build my nutrition plan</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {STEPS[step]} · step {step + 1} of {STEPS.length}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground" aria-label="Close plan questionnaire">
          <X size={16} aria-hidden />
        </button>
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-1">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
        <span>{disclaimerShort("minor")}</span>
      </p>

      {step === 0 && (
        <div className="space-y-4">
          <ChoiceGroup
            legend="What are you training for?"
            options={NUTRITION_GOALS}
            value={intake.goal}
            labels={{ Cut: "Cut (lose fat)", Maintain: "Maintain", Bulk: "Bulk (gain)" }}
            onSelect={(goal) => patch({ goal })}
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="np-weeks">How many weeks</label>
              <input
                id="np-weeks"
                type="number"
                min={1}
                max={12}
                value={intake.weeks}
                onChange={(e) => patch({ weeks: clampInt(Number(e.target.value), 1, 12, 4) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="np-title">Plan name (optional)</label>
              <input
                id="np-title"
                type="text"
                placeholder="Pre-season, Cut 1…"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="np-weight">Weight (kg)</label>
              <input
                id="np-weight"
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={intake.weightKg ?? ""}
                onChange={(e) => patch({ weightKg: e.target.value === "" ? null : Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="np-height">Height (cm)</label>
              <input
                id="np-height"
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={intake.heightCm ?? ""}
                onChange={(e) => patch({ heightCm: e.target.value === "" ? null : Number(e.target.value) })}
                className={inputClass}
              />
            </div>
          </div>

          <ChoiceGroup
            legend="Biological sex — it changes the equation, nothing else"
            options={BIOLOGICAL_SEXES}
            value={intake.sex}
            labels={SEX_LABELS}
            onSelect={(sex) => patch({ sex })}
          />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="np-days">Training days a week</label>
              <input
                id="np-days"
                type="number"
                min={0}
                max={7}
                value={intake.trainingDaysPerWeek}
                onChange={(e) => patch({ trainingDaysPerWeek: clampInt(Number(e.target.value), RECOMMENDATION_BOUNDS.days.min, RECOMMENDATION_BOUNDS.days.max, 4) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="np-minutes">Typical session (minutes)</label>
              <input
                id="np-minutes"
                type="number"
                min={15}
                max={240}
                step={5}
                value={intake.sessionMinutes}
                onChange={(e) => patch({ sessionMinutes: clampInt(Number(e.target.value), RECOMMENDATION_BOUNDS.minutes.min, RECOMMENDATION_BOUNDS.minutes.max, 60) })}
                className={inputClass}
              />
            </div>
          </div>

          <ChoiceGroup
            legend="The rest of your day"
            options={ACTIVITY_LEVELS}
            value={intake.activityLevel}
            labels={ACTIVITY_LABELS}
            onSelect={(activityLevel) => patch({ activityLevel })}
          />

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            These two answers decide most of the number below: your training week and how much you move outside it.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <ChoiceGroup
            legend="How you eat"
            options={DIETARY_PATTERNS}
            value={intake.dietaryPattern}
            labels={PATTERN_LABELS}
            onSelect={(dietaryPattern) => patch({ dietaryPattern })}
          />

          <div>
            <label className={labelClass} htmlFor="np-meals">Meals a day you can actually fit in</label>
            <input
              id="np-meals"
              type="number"
              min={RECOMMENDATION_BOUNDS.mealsPerDay.min}
              max={RECOMMENDATION_BOUNDS.mealsPerDay.max}
              value={intake.mealsPerDay}
              onChange={(e) => patch({ mealsPerDay: clampInt(Number(e.target.value), RECOMMENDATION_BOUNDS.mealsPerDay.min, RECOMMENDATION_BOUNDS.mealsPerDay.max, 4) })}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="np-dislikes">Foods you avoid or react to</label>
            <input
              id="np-dislikes"
              type="text"
              placeholder="Peanuts, dairy, anything with mushrooms…"
              value={intake.foodDislikes}
              onChange={(e) => patch({ foodDislikes: e.target.value.slice(0, 300) })}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="np-notes">Anything else for the coach (optional)</label>
            <textarea
              id="np-notes"
              rows={2}
              maxLength={400}
              placeholder="Shift work, eating out three nights a week, no kitchen at lunch…"
              value={intake.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>
      )}

      {/* The recommendation. Shown from the first step, because it is the answer
          to the question the old form used to ask the athlete. */}
      <div className="rounded-xl border border-electric-purple/25 bg-gradient-card p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Sparkles size={13} className="text-electric-purple" aria-hidden />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-electric-purple">
            Recommended for you
          </span>
        </div>

        {age === null ? (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              We need your date of birth before this plan can be written. Calorie and macro targets are not
              built for anyone under 18, and an account with no date of birth counts as one we cannot
              write for — so this is the one question standing between you and the plan.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="np-dob">Date of birth</label>
              <input
                id="np-dob"
                type="date"
                value={dob}
                min={earliestDob()}
                max={today}
                onChange={(e) => { setDob(e.target.value); setDobError(null); }}
                className={`${inputClass} sm:flex-1`}
              />
              <button
                type="button"
                disabled={savingDob || !dob}
                onClick={async () => {
                  const problem = await onSaveDob(dob);
                  setDobError(problem);
                }}
                className="min-h-[44px] rounded-xl bg-electric-purple/10 px-4 text-sm font-semibold text-electric-purple disabled:opacity-50"
              >
                {savingDob ? "Saving…" : "Save"}
              </button>
            </div>
            {dobError && <p className="text-[11px] text-destructive">{dobError}</p>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {[
                { label: "Cal", value: targets.calories },
                { label: "Protein", value: targets.protein_g },
                { label: "Carbs", value: targets.carbs_g },
                { label: "Fat", value: targets.fat_g },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-background/40 px-2 py-1.5 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-display font-bold tabular-nums">{item.value}</p>
                </div>
              ))}
            </div>

            {usingRecommended ? (
              <ul className="space-y-1">
                {recommendation.basis.map((line) => (
                  <li key={line} className="text-[11px] leading-relaxed text-muted-foreground">• {line}</li>
                ))}
              </ul>
            ) : (
              <div className="grid grid-cols-2 gap-2 mt-1">
                {([
                  ["calories", "Daily calories", RECOMMENDATION_BOUNDS.calories],
                  ["protein_g", "Protein (g)", RECOMMENDATION_BOUNDS.protein],
                  ["carbs_g", "Carbs (g)", RECOMMENDATION_BOUNDS.carbs],
                  ["fat_g", "Fat (g)", RECOMMENDATION_BOUNDS.fat],
                ] as const).map(([key, label, bounds]) => (
                  <div key={key}>
                    <label className={labelClass} htmlFor={`np-target-${key}`}>{label}</label>
                    <input
                      id={`np-target-${key}`}
                      type="number"
                      min={bounds.min}
                      max={bounds.max}
                      value={edited[key]}
                      onChange={(e) => setEdited((current) => ({ ...current, [key]: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-2">
              <button
                type="button"
                onClick={() => (usingRecommended ? startEditing() : setUsingRecommended(true))}
                className="text-xs font-semibold text-electric-purple"
              >
                {usingRecommended ? "I'll set my own numbers" : "Use the recommended numbers"}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {usingRecommended ? "Estimates, not a prescription" : "Edited by you"}
              </span>
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{DISCLAIMERS.nutrition.full}</p>

      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground disabled:opacity-50"
          >
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
        )}

        {!last ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            className="flex-1 flex items-center justify-center gap-1.5 bg-electric-purple/10 text-electric-purple font-semibold py-2.5 rounded-xl text-sm"
          >
            Next <ArrowRight size={14} aria-hidden />
          </button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            // Blocked, not refused after the fact: with no date of birth the
            // request cannot be made at all, so the button says what is missing
            // rather than accepting a tap that ends in a toast.
            disabled={busy || age === null}
            onClick={() =>
              onSubmit({
                intake,
                title: title.trim(),
                targets,
                usedRecommended: usingRecommended,
              })
            }
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
            {busy
              ? "Writing your plan…"
              : age === null
              ? "Add your date of birth to continue"
              : `Write my plan (${cost} credits)`}
          </motion.button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Charged per week ({costPerWeek} credits × {intake.weeks} weeks). Refunded automatically if the plan cannot be written.
      </p>
    </motion.div>
  );
}
