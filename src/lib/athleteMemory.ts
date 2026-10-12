// ============================================================================
// ATHLETE MEMORY — the one shape of "everything the AI knows about you"
// ----------------------------------------------------------------------------
// The dossier (src/lib/athleteDossier.ts, mirrored server-side in
// supabase/functions/_shared/athleteDossier.ts) is what every AI surface reads:
// aiService attaches it, and each edge function fetches it authoritatively. It
// used to cover training and injuries but not the rest of the athlete, so a
// coach asked about food, a break from training or last night's sleep was
// reading a partial person and filling the gaps itself.
//
// This module is the memory's SHAPE, held in one place:
//
//   * the caps — every list has one, because the dossier is prompt input and an
//     unbounded prompt is a cost and quality problem at the same time,
//   * the section order — the same thirteen sections, in the same order, in the
//     panel, in the server's formatted prompt block and in the tests below,
//   * the summaries — the one-line "Injuries — 2 recorded, knee 3/10" strings
//     the panel shows, computed from the same object the AI receives rather
//     than from a hand-written second list that can drift,
//   * and the pure builders (meal-day totals, this week's sessions) that both
//     the client and the server call, so a week of meals is totalled once, the
//     same way, whichever path built the dossier.
//
// Pure: no React, no Supabase, no network. Fetching lives in athleteDossier.ts.
// ============================================================================

/**
 * Every dossier list is capped here. These are prompt-input caps, not display
 * caps: the AI gets the most recent N of each, oldest dropped first, and the
 * panel reports the cap it applied rather than silently hiding rows.
 */
export const DOSSIER_LIMITS = {
  metrics: 20,
  injuries: 5,
  recovery: 7,
  goals: 10,
  loads: 14,
  sessionLoads: 14,
  workouts: 10,
  mealDays: 7,
  lifeEvents: 5,
  checkIns: 5,
  memories: 30,
} as const;

/**
 * The sections, in the order they appear everywhere. This array is the
 * contract: `athleteMemory.test.ts` fails if the server formatter writes its
 * section markers in any other order, which is what keeps one athlete's
 * context identical on both paths.
 */
export type DossierSectionKey =
  | "profile"
  | "pbs"
  | "performance"
  | "injuries"
  | "recovery"
  | "goals"
  | "load"
  | "plan"
  | "workouts"
  | "nutrition"
  | "lifeEvents"
  | "mental"
  | "memories";

export const DOSSIER_SECTION_ORDER: readonly DossierSectionKey[] = [
  "profile",
  "pbs",
  "performance",
  "injuries",
  "recovery",
  "goals",
  "load",
  "plan",
  "workouts",
  "nutrition",
  "lifeEvents",
  "mental",
  "memories",
];

export const DOSSIER_SECTION_LABELS: Record<DossierSectionKey, string> = {
  profile: "Profile & age caps",
  pbs: "Personal bests",
  performance: "Performance & VPR",
  injuries: "Injuries",
  recovery: "Recovery & sleep",
  goals: "Outcome goals",
  load: "Training load",
  plan: "Current training plan",
  workouts: "Recent sessions",
  nutrition: "Nutrition",
  lifeEvents: "Breaks & availability",
  mental: "Mental check-ins",
  memories: "Coach memories",
};

/**
 * The marker the server's `formatDossierForPrompt` writes at the head of each
 * section. The panel does not need them; they exist so a test can assert the
 * two paths agree on the order (see athleteMemory.test.ts) without importing
 * the Deno module.
 */
export const DOSSIER_SECTION_MARKERS: Record<DossierSectionKey, string> = {
  profile: "# PROFILE",
  pbs: "# PERSONAL BESTS",
  performance: "# PERFORMANCE",
  injuries: "# INJURIES",
  recovery: "# RECOVERY",
  goals: "# OUTCOME GOALS",
  load: "# TRAINING LOAD",
  plan: "# CURRENT PLAN",
  workouts: "# RECENT SESSIONS",
  nutrition: "# NUTRITION",
  lifeEvents: "# BREAKS AND AVAILABILITY",
  mental: "# MENTAL CHECK-INS",
  memories: "# COACH MEMORIES",
};

// ---------------------------------------------------------------------------
// Small readers — the dossier is `Record<string, unknown>` by design
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------
// Meal logging — per-day totals, not every meal
// ---------------------------------------------------------------------------

export type MealLogLite = {
  log_date?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  meal_type?: string | null;
};

export type MealDaySummary = {
  date: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meals: number;
};

/**
 * The most recent `limit` logged days, each as one set of totals.
 *
 * A day's totals rather than every meal: the model needs to see whether the
 * week fuelled the training, and 20 meals of prose costs tokens without adding
 * a fact. Days are returned most-recent-first, and a day with no date is
 * dropped rather than bucketed under "".
 */
export function mealDayTotals(
  rows: MealLogLite[],
  limit: number = DOSSIER_LIMITS.mealDays,
): MealDaySummary[] {
  const byDay = new Map<string, MealDaySummary>();
  for (const row of rows) {
    const date = text(row?.log_date).slice(0, 10);
    if (!date) continue;
    const day = byDay.get(date) ?? { date, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals: 0 };
    day.kcal += num(row?.calories) ?? 0;
    day.protein_g += num(row?.protein_g) ?? 0;
    day.carbs_g += num(row?.carbs_g) ?? 0;
    day.fat_g += num(row?.fat_g) ?? 0;
    day.meals += 1;
    byDay.set(date, day);
  }
  return [...byDay.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, Math.max(0, limit))
    .map((d) => ({
      date: d.date,
      kcal: Math.round(d.kcal),
      protein_g: Math.round(d.protein_g),
      carbs_g: Math.round(d.carbs_g),
      fat_g: Math.round(d.fat_g),
      meals: d.meals,
    }));
}

// ---------------------------------------------------------------------------
// The plan and the week the athlete is actually in
// ---------------------------------------------------------------------------

export type PlanSessionLite = {
  day?: number | string | null;
  title?: string | null;
  type?: string | null;
  duration_min?: number | null;
  duration?: number | null;
  isRest?: boolean | null;
};

export type PlanWeekLite = {
  week?: number | null;
  focus?: string | null;
  sessions?: PlanSessionLite[] | null;
};

export type PlanRowLite = {
  title?: string | null;
  sport?: string | null;
  week_current?: number | null;
  duration_weeks?: number | null;
  plan_data?: unknown;
};

export type ActivePlanSummary = {
  title: string;
  sport: string;
  week: number;
  weeks: number;
  focus: string;
  sessionsThisWeek: number;
  thisWeek: { day: number | null; title: string; type: string; minutes: number | null; isRest: boolean }[];
};

const MAX_WEEK_SESSIONS = 10;

/**
 * The active plan, reduced to the week the athlete is in.
 *
 * `plan_data` is an array of weeks of sessions; sending all twelve to a coach
 * answering a question about Tuesday is noise. The current week is the one
 * whose `week` matches `week_current`, falling back to the first week so an
 * out-of-range `week_current` still yields the athlete's plan rather than null.
 */
export function activePlanSummary(plan: PlanRowLite | null | undefined): ActivePlanSummary | null {
  if (!plan || !isObject(plan)) return null;
  const title = text(plan.title);
  if (!title) return null;
  const weeks = list(plan.plan_data).filter(isObject) as PlanWeekLite[];
  const weekCurrent = num(plan.week_current) ?? 1;
  const week = weeks.find((w) => num(w.week) === weekCurrent) ?? weeks[0] ?? null;

  const sessions = list(week?.sessions).filter(isObject) as PlanSessionLite[];
  const thisWeek = sessions.slice(0, MAX_WEEK_SESSIONS).map((s) => {
    const rest = s.isRest === true || text(s.type).toLowerCase() === "rest";
    return {
      day: num(s.day),
      title: text(s.title) || (rest ? "Rest" : "Session"),
      type: text(s.type) || (rest ? "rest" : "session"),
      minutes: num(s.duration_min) ?? num(s.duration),
      isRest: rest,
    };
  });

  return {
    title,
    sport: text(plan.sport) || "Unknown",
    week: weekCurrent,
    weeks: num(plan.duration_weeks) ?? weeks.length,
    focus: text(week?.focus),
    sessionsThisWeek: thisWeek.filter((s) => !s.isRest).length,
    thisWeek,
  };
}

// ---------------------------------------------------------------------------
// Nutrition — a saved plan's targets plus what was actually logged
// ---------------------------------------------------------------------------

export type NutritionPlanLite = {
  title?: string | null;
  goal?: string | null;
  weeks?: number | null;
  calories_target?: number | null;
  protein_target?: number | null;
  carbs_target?: number | null;
  fat_target?: number | null;
  plan_data?: unknown;
};

export type NutritionSummary = {
  plan: {
    title: string;
    goal: string;
    weeks: number;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    hasMeals: boolean;
  } | null;
  days: MealDaySummary[];
  loggedDays: number;
  dietaryPattern: string;
  foodDislikes: string;
  mealsPerDay: number | null;
};

export function nutritionSummary(input: {
  plan?: NutritionPlanLite | null;
  mealRows?: MealLogLite[];
  dietaryPattern?: string | null;
  foodDislikes?: string | null;
  mealsPerDay?: number | string | null;
}): NutritionSummary {
  const plan = input.plan && isObject(input.plan) && text(input.plan.title)
    ? {
        title: text(input.plan.title),
        goal: text(input.plan.goal) || "unspecified",
        weeks: num(input.plan.weeks) ?? 0,
        calories: num(input.plan.calories_target),
        protein_g: num(input.plan.protein_target),
        carbs_g: num(input.plan.carbs_target),
        fat_g: num(input.plan.fat_target),
        hasMeals: list(input.plan.plan_data).length > 0,
      }
    : null;

  const days = mealDayTotals(input.mealRows ?? []);
  return {
    plan,
    days,
    loggedDays: days.length,
    dietaryPattern: text(input.dietaryPattern),
    foodDislikes: text(input.foodDislikes),
    mealsPerDay: num(input.mealsPerDay),
  };
}

// ---------------------------------------------------------------------------
// What is in the dossier, as sentences the athlete can read
// ---------------------------------------------------------------------------

export type DossierSectionView = { key: DossierSectionKey; label: string; summary: string };

/** `true` when the section holds anything at all — an empty section is shown as empty, never invented. */
export function hasSectionContent(dossier: Record<string, unknown>, key: DossierSectionKey): boolean {
  switch (key) {
    case "profile": {
      const p = dossier.profile as Record<string, unknown> | undefined;
      return !!p && (!!text(p.sport) || !!text(p.experience_level) || num(p.age) !== null);
    }
    case "pbs":
      return list(dossier.pbs).length > 0;
    case "performance":
      return !!dossier.vpr || list(dossier.recentMetrics).length > 0;
    case "injuries":
      return list(dossier.injuries).length > 0;
    case "recovery": {
      const r = dossier.recovery as Record<string, unknown> | undefined;
      return list(r?.logs ?? dossier.recoveryLogs).length > 0 || !!dossier.sleep;
    }
    case "goals":
      return list(dossier.outcomeGoals).length > 0;
    case "load": {
      const l = dossier.load as Record<string, unknown> | undefined;
      return list(l?.dailyLoads).length > 0 || list(l?.sessionLoads).length > 0;
    }
    case "plan":
      return !!dossier.activePlan;
    case "workouts":
      return list(dossier.recentWorkouts).length > 0;
    case "nutrition": {
      const n = dossier.nutrition as Record<string, unknown> | undefined;
      return !!n && (!!n.plan || list(n.days).length > 0 || !!text(n.dietaryPattern));
    }
    case "lifeEvents":
      return list(dossier.lifeEvents).length > 0;
    case "mental":
      return list(dossier.mentalCheckins).length > 0;
    case "memories":
      return list(dossier.coachMemories).length > 0;
    default:
      return false;
  }
}

/**
 * One row per section, for the panel. The summary is derived from the same
 * object the AI receives, so a section cannot read "2 injuries" in the panel
 * and arrive at the model empty.
 */
export function dossierSections(dossier: Record<string, unknown>): DossierSectionView[] {
  const recoveryLogs = list((dossier.recovery as Record<string, unknown> | undefined)?.logs);
  const load = (dossier.load ?? {}) as { dailyLoads?: unknown; sessionLoads?: unknown };
  const nutrition = (dossier.nutrition ?? {}) as Record<string, unknown>;
  const plan = dossier.activePlan as ActivePlanSummary | undefined;

  const summaries: Record<DossierSectionKey, () => string> = {
    profile: () => {
      const p = (dossier.profile ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (text(p.sport)) parts.push(text(p.sport));
      if (text(p.experience_level)) parts.push(text(p.experience_level));
      if (num(p.age) !== null) parts.push(`${num(p.age)} years old`);
      const caps = p.ageCaps as { maxSessionsPerWeek?: number; maxRPE?: number } | undefined;
      if (caps?.maxSessionsPerWeek) parts.push(`age caps: ${caps.maxSessionsPerWeek}/week, RPE ≤${caps.maxRPE}`);
      const prefs = (dossier.trainingPreferences ?? {}) as Record<string, unknown>;
      if (num(prefs.daysPerWeek) !== null) parts.push(`trains ${num(prefs.daysPerWeek)} days/week`);
      return parts.join(" · ") || "Nothing recorded yet.";
    },
    pbs: () => {
      const pbs = list(dossier.pbs);
      if (!pbs.length) return "No personal bests logged yet.";
      const first = (pbs[0] ?? {}) as Record<string, unknown>;
      return `${pbs.length} recorded — newest ${text(first.metric)} ${num(first.value) ?? ""}${text(first.unit)}`.trim();
    },
    performance: () => {
      const vpr = dossier.vpr as { overall_vpr?: number } | undefined;
      const parts: string[] = [];
      if (vpr?.overall_vpr) parts.push(`VPR ${Math.round(vpr.overall_vpr)}`);
      const metrics = list(dossier.recentMetrics);
      if (metrics.length) parts.push(`${metrics.length} recent metrics`);
      return parts.join(" · ") || "No VPR or metrics yet.";
    },
    injuries: () => {
      const injuries = list(dossier.injuries) as Record<string, unknown>[];
      if (!injuries.length) return "No injuries recorded.";
      const active = injuries.filter((i) => text(i.status) !== "resolved");
      const first = active[0] ?? injuries[0];
      return `${injuries.length} recorded, ${active.length} active — ${text(first.body_part)} ${num(first.severity) ?? "?"}/10`;
    },
    recovery: () => {
      if (!recoveryLogs.length) return "No recovery check-ins yet.";
      const latest = (recoveryLogs[0] ?? {}) as Record<string, unknown>;
      const parts = [`${recoveryLogs.length} check-ins`];
      if (num(latest.readiness_score) !== null) parts.push(`latest readiness ${num(latest.readiness_score)}`);
      return parts.join(" · ");
    },
    goals: () => {
      const goals = list(dossier.outcomeGoals);
      return goals.length ? `${goals.length} outcome goals` : "No outcome goals set.";
    },
    load: () => {
      const daily = list(load.dailyLoads).length;
      const sessions = list(load.sessionLoads).length;
      const parts: string[] = [];
      if (daily) parts.push(`${daily} days of load`);
      if (sessions) parts.push(`${sessions} logged sessions by sport`);
      return parts.join(" · ") || "No load logged yet.";
    },
    plan: () => {
      if (!plan) return "No active training plan.";
      return `${plan.title} — week ${plan.week} of ${plan.weeks}${plan.focus ? `, ${plan.focus}` : ""}, ${plan.sessionsThisWeek} sessions this week`;
    },
    workouts: () => {
      const workouts = list(dossier.recentWorkouts);
      return workouts.length ? `${workouts.length} recent sessions` : "No sessions logged yet.";
    },
    nutrition: () => {
      if (!nutrition.plan && !list(nutrition.days).length) return "No nutrition plan or logged meals.";
      const parts: string[] = [];
      const saved = nutrition.plan as { title?: string } | undefined;
      if (saved?.title) parts.push(`plan: ${text(saved.title)}`);
      const days = list(nutrition.days).length;
      if (days) parts.push(`${days} days logged`);
      if (text(nutrition.dietaryPattern)) parts.push(`diet: ${text(nutrition.dietaryPattern)}`);
      if (text(nutrition.foodDislikes)) parts.push("foods to avoid noted");
      return parts.join(" · ") || "Nothing recorded yet.";
    },
    lifeEvents: () => {
      const events = list(dossier.lifeEvents);
      return events.length ? `${events.length} recorded breaks / unavailable periods` : "No breaks recorded.";
    },
    mental: () => {
      const checkins = list(dossier.mentalCheckins) as Record<string, unknown>[];
      if (!checkins.length) return "No mental check-ins yet.";
      const latest = checkins[0];
      const readiness = num(latest.readiness_score);
      return `${checkins.length} check-ins${readiness !== null ? `, latest ${readiness}/100` : ""}`;
    },
    memories: () => {
      const memories = list(dossier.coachMemories);
      return memories.length ? `${memories.length} notes the coach saved` : "Nothing saved by the coach yet.";
    },
  };

  return DOSSIER_SECTION_ORDER.map((key) => ({
    key,
    label: DOSSIER_SECTION_LABELS[key],
    summary: summaries[key](),
  }));
}

/** Sections that actually carry data, in order. */
export function nonEmptySections(dossier: Record<string, unknown>): DossierSectionView[] {
  return dossierSections(dossier).filter((s) => hasSectionContent(dossier, s.key));
}

/** Counts for the panel header: "9 of 13 sections hold something". */
export function sectionCounts(dossier: Record<string, unknown>): { filled: number; total: number } {
  const filled = DOSSIER_SECTION_ORDER.filter((k) => hasSectionContent(dossier, k)).length;
  return { filled, total: DOSSIER_SECTION_ORDER.length };
}

/**
 * "just now" / "12 minutes ago" / "3 days ago". Used to show when the panel's
 * copy of the memory was built, because a stale dossier shown as current is
 * exactly the kind of overclaim this app keeps out.
 */
export function buildAgeLabel(builtAt: unknown, now: number = Date.now()): string {
  const iso = text(builtAt);
  if (!iso) return "unknown";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * What is deliberately NOT in the memory. Stated where the athlete can read it
 * rather than only in a policy document, because the honest version of "the AI
 * knows everything about you" is a list of its limits.
 */
export const DOSSIER_EXCLUSIONS: readonly string[] = [
  "messages between you and anyone else",
  "payment details — the app never has your card, Google Play does",
  "device identifiers, advertising IDs or your location history",
  "anything you have not logged or entered in this app",
];
