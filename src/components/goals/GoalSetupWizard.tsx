// ============================================================================
// GOAL SETUP — the quiz that replaced "fill in these numbers"
// ----------------------------------------------------------------------------
// The Goals screen used to open on a natural-language box with a manual dialog
// behind it, and the manual dialog asked for five things: a title, the value you
// are at now, the value you want, a unit, and a deadline. Which is the form an
// athlete who already knows their numbers would write for themselves.
//
// This is the same shift the nutrition plan already made. It asks what you
// WANT, in the words you would use, and works out the shape from there:
//
//   1. What you want            a target, a weekly habit, or both
//   2. The target               what kind of goal it is, and what it is called
//   3. Where you are now        where you are, where you want to be, by when
//   4. The weekly habit         pick one, or name your own
//   5. The daily work           tick the actions the habit is made of
//   6. Check it                 what is about to be created
//
// Steps 2–3 and 4–5 are skipped when the answer to step 1 does not need them, so
// "I just want a habit" is a three-step quiz. That is the door that did not
// exist: a weekly habit could only be added from inside a target's card, so an
// athlete building the habit first — with no target above it — had no way in,
// even though `process_goals.outcome_goal_id` has always been nullable.
//
// Presentation only. The catalogue, the suggestions, the rules and the rows are
// all in src/lib/goalSetup.ts, which is pure and tested; the request itself
// belongs to the screen (see Goals.tsx). Nothing here costs credits: goals are
// the athlete's own record, and the paid Weekly Coach Review is a separate,
// clearly-priced button on the screen behind this card.
// ============================================================================

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Sparkles, Target, Trash2, X } from "lucide-react";

import {
  GOAL_CATEGORIES,
  HABIT_TEMPLATES,
  INTENT_CHOICES,
  MAX_DAILY_ACTIONS,
  STEP_TITLES,
  clampWeeklyTarget,
  dailyActionRows,
  emptyHabitDraft,
  planWrites,
  processGoalRow,
  reviewDraft,
  stepsFor,
  suggestDailyActions,
  type GoalDraft,
  type GoalIntent,
  type HabitDraft,
  type StepKey,
} from "@/lib/goalSetup";

export interface GoalSetupWizardProps {
  draft: GoalDraft;
  onDraftChange: (draft: GoalDraft) => void;
  /** True while the rows are being written. */
  busy: boolean;
  onCreate: (draft: GoalDraft) => void;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const labelClass = "text-[12px] text-muted-foreground";

/** One tappable answer, used by every choice in the flow. */
const Chip = ({
  label,
  active,
  onSelect,
  title,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={active}
    title={title}
    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
      active
        ? "border-primary bg-primary/15 text-primary"
        : "border-border bg-card text-foreground hover:border-primary/30"
    }`}
  >
    {label}
  </button>
);

const GoalSetupWizard = ({ draft, onDraftChange, busy, onCreate, onClose }: GoalSetupWizardProps) => {
  const [step, setStep] = useState(0);

  const steps: StepKey[] = useMemo(() => stepsFor(draft.intent), [draft.intent]);
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step === steps.length - 1;
  const review = useMemo(() => reviewDraft(draft), [draft]);

  const patch = (change: Partial<GoalDraft>) => onDraftChange({ ...draft, ...change });
  const patchTarget = (change: Partial<GoalDraft["target"]>) =>
    onDraftChange({ ...draft, target: { ...draft.target, ...change } });

  const patchHabit = (index: number, change: Partial<HabitDraft>) =>
    onDraftChange({
      ...draft,
      habits: draft.habits.map((habit, i) => (i === index ? { ...habit, ...change } : habit)),
    });

  const chooseIntent = (intent: GoalIntent) => {
    patch({ intent });
    // The step list changes with the intent, and the athlete has just answered
    // the question that decided it — so the flow restarts from step 2 rather
    // than leaving them mid-way through a step that no longer exists.
    setStep(Math.min(1, stepsFor(intent).length - 1));
  };

  const addHabit = () => patch({ habits: [...draft.habits, emptyHabitDraft()] });

  const removeHabit = (index: number) =>
    patch({ habits: draft.habits.filter((_, i) => i !== index) });

  /** Ticking a suggested daily action on or off. */
  const toggleAction = (index: number, action: string) => {
    const habit = draft.habits[index];
    const has = habit.dailyActions.includes(action);
    patchHabit(index, {
      dailyActions: has
        ? habit.dailyActions.filter((a) => a !== action)
        : [...habit.dailyActions, action].slice(0, MAX_DAILY_ACTIONS),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-5 space-y-4 rounded-2xl border border-primary/30 bg-gradient-card p-4"
      aria-label="Set a goal"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold">Set a goal</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {STEP_TITLES[current]} · step {Math.min(step + 1, steps.length)} of {steps.length}
          </p>
        </div>
        {/* Same hit area as the app's bottom sheets. The global 44px floor only
            sets `min-height`, so a bare icon button passes it while being about
            a third of a thumb wide — the exact defect reported on the Health
            Connect sheet's header X. The icon stays where it was drawn; the
            target grows around it. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close goal setup"
          className="-me-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {current === "intent" && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold">What are you setting up?</legend>
          {INTENT_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => chooseIntent(choice.id)}
              aria-pressed={draft.intent === choice.id}
              className={`w-full rounded-xl border p-3 text-start transition ${
                draft.intent === choice.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {choice.id === "habit" ? <Check size={13} aria-hidden /> : <Target size={13} aria-hidden />}
                {choice.label}
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                {choice.blurb}
              </span>
            </button>
          ))}
        </fieldset>
      )}

      {current === "target" && (
        <div className="space-y-3">
          <div>
            <label className={labelClass} htmlFor="goal-title">
              What do you want to achieve?
            </label>
            <input
              id="goal-title"
              className={inputClass}
              placeholder="Sub-18 5K, first unassisted pull-up, 70 kg…"
              value={draft.target.title}
              maxLength={120}
              onChange={(e) => patchTarget({ title: e.target.value })}
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold">What kind of goal is it?</legend>
            <div className="flex flex-wrap gap-1.5">
              {GOAL_CATEGORIES.map((category) => (
                <Chip
                  key={category.id}
                  label={category.label}
                  title={category.examples}
                  active={draft.target.category === category.id}
                  onSelect={() => patchTarget({ category: category.id })}
                />
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {current === "progress" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="goal-current">
                Where you are now
              </label>
              <input
                id="goal-current"
                className={inputClass}
                inputMode="decimal"
                placeholder="19.5"
                value={draft.target.currentValue}
                onChange={(e) => patchTarget({ currentValue: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="goal-target">
                Where you want to be
              </label>
              <input
                id="goal-target"
                className={inputClass}
                inputMode="decimal"
                placeholder="18"
                value={draft.target.targetValue}
                onChange={(e) => patchTarget({ targetValue: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="goal-unit">
                Unit (optional)
              </label>
              <input
                id="goal-unit"
                className={inputClass}
                placeholder="minutes, kg, reps"
                value={draft.target.unit}
                maxLength={20}
                onChange={(e) => patchTarget({ unit: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="goal-deadline">
                By when (optional)
              </label>
              <input
                id="goal-deadline"
                type="date"
                className={inputClass}
                value={draft.target.deadline}
                onChange={(e) => patchTarget({ deadline: e.target.value })}
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            A number going down is fine — a faster 5K is a lower time. Only the deadline and the
            numbers are optional; the name is not.
          </p>
        </div>
      )}

      {current === "habit" && (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold">Pick one, or write your own</p>
            <div className="flex flex-wrap gap-1.5">
              {HABIT_TEMPLATES.map((template) => (
                <Chip
                  key={template.id}
                  label={template.label}
                  active={draft.habits.some((h) => h.title.trim() === template.title)}
                  onSelect={() =>
                    patchHabit(0, {
                      title: template.title,
                      weeklyTarget: template.weeklyTarget,
                      dailyActions: template.dailyActions,
                    })
                  }
                />
              ))}
            </div>
          </div>

          {draft.habits.map((habit, index) => (
            <div key={index} className="space-y-2 rounded-xl border border-border bg-card/60 p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className={labelClass} htmlFor={`habit-title-${index}`}>
                    {index === 0 ? "The habit" : `Habit ${index + 1}`}
                  </label>
                  <input
                    id={`habit-title-${index}`}
                    className={inputClass}
                    placeholder="Run 4 times a week"
                    value={habit.title}
                    maxLength={120}
                    onChange={(e) => patchHabit(index, { title: e.target.value })}
                  />
                </div>
                <div className="w-24 shrink-0">
                  <label className={labelClass} htmlFor={`habit-target-${index}`}>
                    Times a week
                  </label>
                  <input
                    id={`habit-target-${index}`}
                    type="number"
                    min={1}
                    max={14}
                    className={inputClass}
                    value={habit.weeklyTarget}
                    onChange={(e) => patchHabit(index, { weeklyTarget: clampWeeklyTarget(Number(e.target.value)) })}
                  />
                </div>
                {draft.habits.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove habit ${index + 1}`}
                    onClick={() => removeHabit(index)}
                    className="mb-1 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          ))}

          {draft.habits.length < 4 && (
            <button
              type="button"
              onClick={addHabit}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary"
            >
              <Plus size={13} aria-hidden /> Add another habit
            </button>
          )}
        </div>
      )}

      {current === "daily" && (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Ticked actions become today's checklist, and the streak counts them. Both are editable
            afterwards.
          </p>
          {draft.habits
            .map((habit, index) => ({ habit, index }))
            .filter(({ habit }) => habit.title.trim() !== "")
            .map(({ habit, index }) => {
              const suggestions = suggestDailyActions(habit.title);
              const extras = habit.dailyActions.filter((action) => !suggestions.includes(action));
              return (
                <div key={index} className="space-y-2 rounded-xl border border-border bg-card/60 p-3">
                  <p className="text-xs font-semibold">{habit.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...suggestions, ...extras].map((action) => (
                      <Chip
                        key={action}
                        label={action}
                        active={habit.dailyActions.includes(action)}
                        onSelect={() => toggleAction(index, action)}
                      />
                    ))}
                  </div>
                  <AddAction
                    onAdd={(title) => patchHabit(index, {
                      dailyActions: [...habit.dailyActions, title].slice(0, MAX_DAILY_ACTIONS),
                    })}
                  />
                </div>
              );
            })}
        </div>
      )}

      {current === "review" && (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            <span>{review.summary}</span>
          </p>
          {review.problems.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
              {review.problems.map((problem) => (
                <li key={`${problem.field}-${problem.message}`} className="text-xs text-destructive">
                  {problem.message}
                </li>
              ))}
            </ul>
          )}
          {review.ok && <Summary draft={draft} />}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Free — goals are your own record. The Weekly Coach Review on this screen is the only
            paid call here, and it is charged separately.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground disabled:opacity-50"
          >
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
        )}
        {!last ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary/10 py-2.5 text-sm font-semibold text-primary"
          >
            Next <ArrowRight size={14} aria-hidden />
          </button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            disabled={busy || !review.ok}
            onClick={() => onCreate(draft)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-2.5 font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Target size={16} aria-hidden />}
            {busy ? "Setting up…" : "Create my goal"}
          </motion.button>
        )}
      </div>
    </motion.div>
  );
};

/** A free-text row for a daily action the suggestions did not name. */
const AddAction = ({ onAdd }: { onAdd: (title: string) => void }) => {
  const [title, setTitle] = useState("");
  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed.slice(0, 120));
    setTitle("");
  };
  return (
    <div className="flex gap-2">
      <input
        aria-label="Add a daily action"
        // `min-w-0` beside the Add button: a flex item keeps the CSS default
        // `min-width: auto`, and an <input> has a default `size=20`, so without
        // this the row's floor is wider than a 320px screen and the Add button
        // is pushed off the right edge (the same fault overflowLayout.test.ts
        // documents for the natural-language "Parse" row).
        className={`${inputClass} min-w-0`}
        placeholder="Add your own daily action"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        onClick={submit}
        className="shrink-0 rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground"
      >
        Add
      </button>
    </div>
  );
};

/** What the review step shows, as the rows that are about to be written. */
const Summary = ({ draft }: { draft: GoalDraft }) => {
  const plan = planWrites("preview", draft);
  const actions = plan.habits.flatMap(({ habit, actions }) => dailyActionRows("preview", actions).map((row) => ({
    habit: habit.title,
    title: row.title,
  })));
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/60 p-3">
      {plan.goal && (
        <div className="text-xs">
          <p className="font-semibold">{plan.goal.title}</p>
          <p className="text-muted-foreground">
            {plan.goal.target_value ?? "—"} {plan.goal.metric_unit ?? ""}
            {plan.goal.deadline ? ` · by ${plan.goal.deadline}` : ""}
          </p>
        </div>
      )}
      {plan.habits.map(({ habit }) => (
        <div key={habit.title} className="text-xs">
          <p className="font-semibold">{processGoalRow("preview", habit, null).title}</p>
          <p className="text-muted-foreground">
            {clampWeeklyTarget(habit.weeklyTarget)} a week
          </p>
        </div>
      ))}
      {actions.length > 0 && (
        <ul className="space-y-0.5">
          {actions.map((action, i) => (
            <li key={`${action.habit}-${action.title}-${i}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Check size={10} className="shrink-0 text-success" aria-hidden />
              {action.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default GoalSetupWizard;
