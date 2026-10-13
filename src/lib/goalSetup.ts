// ============================================================================
// GOAL SETUP — the questions a goal needs, and the rows the answers become
// ----------------------------------------------------------------------------
// Why this module exists. The Goals screen could already do both halves of a
// goal — a TARGET (outcome_goals: "sub-18 5K by June") and a weekly HABIT
// (process_goals: "4 runs a week") — but only one of them was reachable on its
// own. A habit could be added from inside a target's card and nowhere else, so
// an athlete who wanted to build the habit first, with no target attached, had
// no door: the schema has always allowed `outcome_goal_id IS NULL`, the UI never
// offered it. And neither half asked the athlete what they actually wanted; it
// asked for numbers they were supposed to already know.
//
// So the setup became a quiz, the way a training plan and a nutrition plan are
// already built: pick what you want, answer a few questions, and the app works
// out the shape of the goal. This file is everything in that quiz that is not
// pixels — the catalogue of categories and habits, what the app suggests for
// the daily work, what makes an answer unusable, and exactly which rows the
// answers become.
//
// It is deliberately pure and has no Supabase import: the screen makes the
// request (see Goals.tsx), so the quiz can be reasoned about — and tested —
// without a database.
//
// Nothing here invents a value. `weekly_target` is clamped to the 1–14 the
// progress arithmetic divides by (see lib/goals.ts), the category comes from
// the catalogue below, and an inverted target (target below current) is refused
// here for the same reason the manual dialog refuses it: it renders as a
// negative progress bar.
// ============================================================================

export type GoalIntent = "target" | "habit" | "both";

// ---------------------------------------------------------------------------
// The quiz's shape. Steps are derived from the intent rather than fixed, so
// "a habit, no target" is a three-step quiz and never walks through a target
// form it will not use.
// ---------------------------------------------------------------------------
export type StepKey = "intent" | "target" | "progress" | "habit" | "daily" | "review";

export const STEP_TITLES: Record<StepKey, string> = {
  intent: "What you want",
  target: "The target",
  progress: "Where you are now",
  habit: "The weekly habit",
  daily: "The daily work",
  review: "Check it",
};

/** The steps for one intent, in order. */
export function stepsFor(intent: GoalIntent): StepKey[] {
  const steps: StepKey[] = ["intent"];
  if (intent === "target" || intent === "both") steps.push("target", "progress");
  if (intent === "habit" || intent === "both") steps.push("habit", "daily");
  steps.push("review");
  return steps;
}

export const INTENT_CHOICES: Array<{ id: GoalIntent; label: string; blurb: string }> = [
  {
    id: "target",
    label: "A target I'm chasing",
    blurb: "Something to hit — a time, a distance, a weight, a date.",
  },
  {
    id: "habit",
    label: "A habit I'll do every week",
    blurb: "The work rather than the result — 4 runs, 3 lifts, lights out by 22:30.",
  },
  {
    id: "both",
    label: "Both — the habit that gets me there",
    blurb: "Set the target, then set the weekly work that closes the gap.",
  },
];

// ---------------------------------------------------------------------------
// Categories. Free text in the database (outcome_goals.category has a default
// of 'performance' and no constraint), but a closed list on screen: the manual
// dialog hard-coded 'performance' for every goal, so the badge on every card
// said the same word.
// ---------------------------------------------------------------------------
export interface GoalCategorySpec {
  id: string;
  label: string;
  examples: string;
}

export const GOAL_CATEGORIES: GoalCategorySpec[] = [
  { id: "performance", label: "Performance", examples: "a time, a distance, a load" },
  { id: "skill", label: "Skill", examples: "a technique you want to own" },
  { id: "competition", label: "Competition", examples: "a race, a match, a season" },
  { id: "physique", label: "Physique", examples: "weight, body composition" },
  { id: "recovery", label: "Staying available", examples: "unbroken, no missed weeks" },
  { id: "consistency", label: "Consistency", examples: "showing up for the work" },
];

export const DEFAULT_CATEGORY = "performance";

export const isKnownCategory = (id: string): boolean =>
  GOAL_CATEGORIES.some((category) => category.id === id);

// ---------------------------------------------------------------------------
// Habit templates — the answer to "what should my weekly habit even be?".
//
// Each one carries the daily actions that make it up, because a weekly target
// with nothing under it is a number the athlete has to translate into work
// themselves, and the checklist on the Goals screen is built from daily_actions.
// ---------------------------------------------------------------------------
export interface HabitTemplate {
  id: string;
  /** Chip label. */
  label: string;
  title: string;
  weeklyTarget: number;
  dailyActions: string[];
}

export const HABIT_TEMPLATES: HabitTemplate[] = [
  {
    id: "run",
    label: "Run 4× a week",
    title: "Run 4 times a week",
    weeklyTarget: 4,
    dailyActions: ["Easy run", "Session from the plan"],
  },
  {
    id: "gym",
    label: "Lift 3× a week",
    title: "Lift 3 times a week",
    weeklyTarget: 3,
    dailyActions: ["Strength session", "10 min mobility"],
  },
  {
    id: "skill",
    label: "Skill 3× a week",
    title: "Skill work 3 times a week",
    weeklyTarget: 3,
    dailyActions: ["Skill practice, 15 min", "Technique drills"],
  },
  {
    id: "mobility",
    label: "Mobility daily",
    title: "Mobility every day",
    weeklyTarget: 7,
    dailyActions: ["Mobility routine", "Stretch after training"],
  },
  {
    id: "sleep",
    label: "Lights out by 22:30",
    title: "In bed by 22:30",
    weeklyTarget: 7,
    dailyActions: ["Lights out by 22:30", "No screens 30 min before bed"],
  },
  {
    id: "fuel",
    label: "Fuel the training",
    title: "Fuel the training",
    weeklyTarget: 7,
    dailyActions: ["Protein at every meal", "3 L water"],
  },
];

/**
 * Daily actions suggested from the athlete's own words.
 *
 * The quiz's whole premise is that an athlete can describe what they want
 * instead of filling in a form they do not have the numbers for — so the
 * suggestions are read out of their sentence, keyword by keyword, and a
 * sentence with nothing recognisable in it keeps the habit itself as the one
 * action rather than producing an empty checklist. Deterministic and offline:
 * no provider call belongs in front of a checklist an athlete is about to edit.
 */
export function suggestDailyActions(words: string): string[] {
  const text = words.toLowerCase();
  const rules: Array<[RegExp, string[]]> = [
    [/\b(run|jog|5k|10k|parkrun|marathon|mile|tempo|fartlek)\b/, ["Easy run", "Session from the plan"]],
    [/\b(cycl|bike|ride|spin|watt|turbo)\b/, ["Ride", "Long ride"]],
    [/\b(swim|pool|stroke)\b/, ["Pool session", "Technique drills"]],
    [/\b(gym|lift|strength|squat|deadlift|bench|powerlift|weights?)\b/, ["Strength session", "Mobility 10 min"]],
    [/\b(mobil|stretch|yoga|flexib)\b/, ["Mobility routine", "Stretch after training"]],
    [/\b(sleep|asleep|bed|bedtime|rest|nap)\b/, ["Lights out by 22:30", "No screens before bed"]],
    [/\b(water|hydrat|drink)\b/, ["3 L water"]],
    [/\b(eat|nutrition|protein|fuel|diet|macro|calorie)\b/, ["Protein at every meal", "Log what I ate"]],
    [/\b(skill|technique|drill|touch|serve|practice)\b/, ["Skill practice, 15 min"]],
    [/\b(recover|ice|massage|physio|foam)\b/, ["Recovery session", "Full rest day"]],
    [/\b(study|video|review|analyse|analyze)\b/, ["Review the session"]],
  ];

  const found: string[] = [];
  for (const [pattern, actions] of rules) {
    if (!pattern.test(text)) continue;
    for (const action of actions) {
      if (found.length < 4 && !found.includes(action)) found.push(action);
    }
  }
  return found.length ? found : [words.trim()].filter(Boolean);
}

// ---------------------------------------------------------------------------
// The draft — the answers as they are typed, before they are rows.
// ---------------------------------------------------------------------------
export interface TargetDraft {
  title: string;
  category: string;
  /** Kept as typed: an empty string means "not stated", not zero. */
  currentValue: string;
  targetValue: string;
  unit: string;
  deadline: string;
}

export interface HabitDraft {
  title: string;
  weeklyTarget: number;
  dailyActions: string[];
}

export interface GoalDraft {
  intent: GoalIntent;
  target: TargetDraft;
  habits: HabitDraft[];
}

export const emptyTargetDraft = (): TargetDraft => ({
  title: "",
  category: DEFAULT_CATEGORY,
  currentValue: "0",
  targetValue: "",
  unit: "",
  deadline: "",
});

export const emptyHabitDraft = (): HabitDraft => ({
  title: "",
  weeklyTarget: 3,
  dailyActions: [],
});

export const emptyDraft = (intent: GoalIntent = "both"): GoalDraft => ({
  intent,
  target: emptyTargetDraft(),
  habits: [emptyHabitDraft()],
});

/** The habit target has to divide into the progress maths: 1–14, never 0. */
export const clampWeeklyTarget = (value: number): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(14, n));
};

/** Blank is "not stated"; anything else has to be a finite, non-negative number. */
const parseAmount = (value: string): number | null | "invalid" => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
};

const MAX_TITLE = 120;
const MAX_UNIT = 20;
const MAX_ACTION = 120;
/** Enough for a daily checklist; past this it stops being daily work. */
export const MAX_DAILY_ACTIONS = 8;

export interface DraftProblem {
  /** Which answer to blame, so the screen can point at it. */
  field: string;
  message: string;
}

export interface DraftReview {
  ok: boolean;
  problems: DraftProblem[];
  /** One line for the confirmation step, in the athlete's own terms. */
  summary: string;
  /** What the athlete is about to be charged — always nothing here. */
  cost: number;
}

/**
 * The single review the quiz's last step shows and the screen obeys.
 *
 * Deliberately one function rather than per-field validators scattered through
 * the component: the last step is the only place an athlete is told their
 * answers are unusable, and it must give the same answer as the submit path.
 */
export function reviewDraft(draft: GoalDraft): DraftReview {
  const problems: DraftProblem[] = [];
  const wantsTarget = draft.intent === "target" || draft.intent === "both";
  const wantsHabit = draft.intent === "habit" || draft.intent === "both";

  if (wantsTarget) {
    const title = draft.target.title.trim();
    if (!title) problems.push({ field: "title", message: "Give the target a name." });
    if (title.length > MAX_TITLE) {
      problems.push({ field: "title", message: `Keep the name to ${MAX_TITLE} characters.` });
    }
    if (draft.target.unit.trim().length > MAX_UNIT) {
      problems.push({ field: "unit", message: `Keep the unit to ${MAX_UNIT} characters.` });
    }

    const target = parseAmount(draft.target.targetValue);
    const current = parseAmount(draft.target.currentValue);
    if (target === "invalid") {
      problems.push({ field: "targetValue", message: "The target has to be a number." });
    }
    if (current === "invalid") {
      problems.push({ field: "currentValue", message: "Where you are now has to be a number." });
    }
    // Only EQUALITY is refused — not "below where you are now".
    //
    // The manual dialog refuses target < current, which assumes a bigger number
    // is always better. For the goal most athletes in this app actually set
    // that is exactly backwards: a 19:30 5K runner's goal is sub-18, a lower
    // number, and the old rule refused to save it. Neither direction can be
    // wrong, because a target can be a time, a weight or a body-composition
    // figure as easily as a distance or a load — so the rule is the one thing
    // that is true either way: a goal you have already reached is not a goal.
    //
    // `start_value` is written as the current value, so lib/goals.ts's
    // outcomeProgress() measures the gap in whichever direction it runs.
    if (typeof target === "number" && typeof current === "number" && current === target) {
      problems.push({
        field: "targetValue",
        message: "Set a target that differs from where you are now.",
      });
    }
    if (draft.target.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(draft.target.deadline)) {
      problems.push({ field: "deadline", message: "That deadline is not a date." });
    }
    if (!isKnownCategory(draft.target.category)) {
      problems.push({ field: "category", message: "Pick what kind of goal this is." });
    }
  }

  if (wantsHabit) {
    const named = draft.habits.filter((habit) => habit.title.trim() !== "");
    if (named.length === 0) {
      problems.push({ field: "habits", message: "Name the weekly habit you are taking on." });
    }
    if (draft.habits.length > 4) {
      problems.push({ field: "habits", message: "Four habits is already a lot to keep — start there." });
    }
    for (const habit of draft.habits) {
      if (habit.title.trim().length > MAX_TITLE) {
        problems.push({ field: "habits", message: `Keep each habit to ${MAX_TITLE} characters.` });
      }
      const actions = habit.dailyActions.map((action) => action.trim()).filter(Boolean);
      if (actions.length > MAX_DAILY_ACTIONS) {
        problems.push({
          field: "daily",
          message: `A habit can carry ${MAX_DAILY_ACTIONS} daily actions at most.`,
        });
      }
      if (actions.some((action) => action.length > MAX_ACTION)) {
        problems.push({ field: "daily", message: `Keep each daily action to ${MAX_ACTION} characters.` });
      }
    }
  }

  const target = draft.target.title.trim();
  const habitCount = draft.habits.filter((habit) => habit.title.trim() !== "").length;
  const parts: string[] = [];
  if (wantsTarget && target) parts.push(`the target “${target}”`);
  if (wantsHabit && habitCount > 0) {
    parts.push(habitCount === 1 ? "1 weekly habit" : `${habitCount} weekly habits`);
  }
  const summary = parts.length
    ? `Creates ${parts.join(" and ")}.`
    : "Nothing to create yet.";

  return { ok: problems.length === 0, problems, summary, cost: 0 };
}

// ---------------------------------------------------------------------------
// The rows. Built here, written by the screen.
// ---------------------------------------------------------------------------
export type OutcomeGoalInsert = {
  user_id: string;
  title: string;
  category: string;
  metric_unit: string | null;
  start_value: number;
  current_value: number;
  target_value: number | null;
  deadline: string | null;
};

export type ProcessGoalInsert = {
  user_id: string;
  outcome_goal_id: string | null;
  title: string;
  weekly_target: number;
};

export type DailyActionInsert = {
  user_id: string;
  title: string;
};

export interface GoalWritePlan {
  /** null for a habit-only goal — the schema has always allowed it, and this is
   *  the door that did not exist before. */
  goal: OutcomeGoalInsert | null;
  /** The habits to create, with the daily actions that belong under each one. */
  habits: Array<{ habit: HabitDraft; actions: string[] }>;
}

/**
 * The inserts the answers become, in dependency order.
 *
 * The habit rows are returned as drafts rather than as finished rows: each one
 * needs the id of the goal that was just created — on a "both" goal the habits
 * hang off the target, and on a habit-only goal there is nothing to hang off.
 * The id only exists after the screen's insert, so the screen passes it back
 * through `processGoalRow` and `dailyActionRows` below. No sentinel ids.
 */
export function planWrites(userId: string, draft: GoalDraft): GoalWritePlan {
  const wantsTarget = draft.intent === "target" || draft.intent === "both";
  const wantsHabit = draft.intent === "habit" || draft.intent === "both";

  const amount = (value: string): number | null => {
    const parsed = parseAmount(value);
    return typeof parsed === "number" ? parsed : null;
  };

  const goal: OutcomeGoalInsert | null = wantsTarget
    ? {
        user_id: userId,
        title: draft.target.title.trim(),
        category: isKnownCategory(draft.target.category) ? draft.target.category : DEFAULT_CATEGORY,
        metric_unit: draft.target.unit.trim() || null,
        start_value: amount(draft.target.currentValue) ?? 0,
        current_value: amount(draft.target.currentValue) ?? 0,
        target_value: amount(draft.target.targetValue),
        deadline: draft.target.deadline || null,
      }
    : null;

  const habits = wantsHabit
    ? draft.habits
        .filter((habit) => habit.title.trim() !== "")
        .map((habit) => ({
          habit,
          actions: habit.dailyActions
            .map((action) => action.trim())
            .filter(Boolean)
            .slice(0, MAX_DAILY_ACTIONS),
        }))
    : [];

  return { goal, habits };
}

/** The process_goals row for one habit, attached to the goal it was made for. */
export const processGoalRow = (
  userId: string,
  habit: HabitDraft,
  outcomeGoalId: string | null,
): ProcessGoalInsert => ({
  user_id: userId,
  outcome_goal_id: outcomeGoalId,
  title: habit.title.trim(),
  weekly_target: clampWeeklyTarget(habit.weeklyTarget),
});

/** The daily_actions rows under one habit. */
export const dailyActionRows = (
  userId: string,
  actions: string[],
): DailyActionInsert[] =>
  actions.map((title) => ({ user_id: userId, title }));
