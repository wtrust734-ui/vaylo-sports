// ============================================================================
// Shared edge-function dossier — authoritative server-side athlete context.
// ----------------------------------------------------------------------------
// Mirrors src/lib/athleteDossier.ts: the same thirteen sections, assembled the
// same way, but fetched with the service role (or the caller's JWT) so the AI
// never trusts client-supplied values. A feature served by this path and a
// feature served by the client's version must see ONE athlete.
//
// This file is duplicated at supabase/functions/wearable-oauth/_shared/
// athleteDossier.ts and the two copies must stay identical (that function
// bundles its own _shared directory). Change both.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

/** Caps on every list. Mirrors DOSSIER_LIMITS in src/lib/athleteMemory.ts. */
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
  /** Sessions printed from the current plan week (the panel shows them all). */
  planSessions: 10,
} as const;

/** Shape of the rows this module reads; kept loose where the DB schema is loose. */
interface ProfileRow {
  sport?: string | null;
  experience_level?: string | null;
  date_of_birth?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  goals?: string[] | string | null;
  full_name?: string | null;
  sex?: string | null;
}

interface MetricRow {
  metric_type: string;
  value: number;
  unit?: string | null;
  log_date: string;
  fatigue_level?: number | null;
  sport?: string | null;
}

interface InjuryRow {
  body_part: string;
  severity: number | string | null;
  status: string;
  log_date: string;
  notes?: string | null;
  recovery_protocol?: string | null;
}

interface RecoveryRow {
  log_date: string;
  readiness_score: number | null;
  sleep_quality?: number | null;
  fatigue?: number | null;
  soreness?: number | null;
  mood?: number | null;
  stress?: number | null;
  energy?: number | null;
  rest_hours?: number | null;
}

interface OutcomeGoalRow {
  title: string;
  current_value?: number | null;
  target_value?: number | null;
  metric_unit?: string | null;
}

interface CoachMemoryRow {
  category: string;
  key: string;
  value: string;
}

export interface EdgePB {
  metric: string;
  value: number;
  unit: string;
  date: string;
}

function ageFromDOB(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 31557600000);
}

export function getAgeCaps(age: number | null) {
  if (age === null) return { maxSessionsPerWeek: 6, maxMinutesPerSession: 90, maxRPE: 9, minRestDays: 1, deloadEvery: 4, youth: false };
  if (age < 13) return { maxSessionsPerWeek: 3, maxMinutesPerSession: 45, maxRPE: 7, minRestDays: 2, deloadEvery: 3, youth: true };
  if (age < 16) return { maxSessionsPerWeek: 4, maxMinutesPerSession: 60, maxRPE: 8, minRestDays: 2, deloadEvery: 4, youth: true };
  if (age < 18) return { maxSessionsPerWeek: 5, maxMinutesPerSession: 75, maxRPE: 9, minRestDays: 1, deloadEvery: 4, youth: true };
  if (age >= 60) return { maxSessionsPerWeek: 4, maxMinutesPerSession: 60, maxRPE: 8, minRestDays: 2, deloadEvery: 3, youth: false };
  if (age >= 45) return { maxSessionsPerWeek: 5, maxMinutesPerSession: 75, maxRPE: 8, minRestDays: 1, deloadEvery: 4, youth: false };
  return { maxSessionsPerWeek: 6, maxMinutesPerSession: 90, maxRPE: 9, minRestDays: 1, deloadEvery: 4, youth: false };
}

// ---------------------------------------------------------------------------
// Tolerant readers — a missing table or column costs one section, never the
// whole dossier, and never a fabricated value.
// ---------------------------------------------------------------------------

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const str = (v: unknown, max = 200): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** `YYYY-MM-DD` for a date N days ago, used to window the meal log. */
const daysAgoKey = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Runs a query and treats any failure as "no rows" rather than an error. */
async function safe(run: () => PromiseLike<{ data: unknown }>): Promise<{ data: unknown }> {
  try {
    return await run();
  } catch {
    return { data: null };
  }
}

const readWorkouts = (rows: unknown) =>
  asArray<Record<string, unknown>>(rows)
    .map((r) => {
      const date = String(r.completed_at ?? r.started_at ?? r.created_at ?? "").slice(0, 10);
      const title = str(r.title, 120);
      const sport = str(r.sport, 40) || str(r.type, 40) || "session";
      if (!date || !title) return null;
      return { date, sport, title, minutes: num(r.duration_minutes) };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null)
    .slice(0, DOSSIER_LIMITS.workouts);

const readLifeEvents = (rows: unknown) =>
  asArray<Record<string, unknown>>(rows)
    .map((r) => {
      const type = str(r.event_type, 40);
      const from = String(r.start_date ?? "").slice(0, 10);
      const to = String(r.end_date ?? "").slice(0, 10) || from;
      if (!type || !from) return null;
      return {
        type,
        from,
        to,
        allowTraining: str(r.allow_training, 20) || "unknown",
        current: to >= new Date().toISOString().slice(0, 10),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .slice(0, DOSSIER_LIMITS.lifeEvents);

const readCheckIns = (rows: unknown) =>
  asArray<Record<string, unknown>>(rows)
    .map((r) => {
      const date = String(r.created_at ?? "").slice(0, 10);
      if (!date) return null;
      return {
        date,
        readiness_score: num(r.readiness_score),
        stress: num(r.stress),
        focus: num(r.focus),
        fatigue: num(r.fatigue),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .slice(0, DOSSIER_LIMITS.checkIns);

/** Per-day food totals, capped. Mirrors mealDayTotals in src/lib/athleteMemory.ts. */
function mealDayTotals(rows: unknown) {
  const byDay = new Map<string, { date: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; meals: number }>();
  for (const row of asArray<Record<string, unknown>>(rows)) {
    const date = String(row.log_date ?? "").slice(0, 10);
    if (!date) continue;
    const day = byDay.get(date) ?? { date, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals: 0 };
    day.kcal += num(row.calories) ?? 0;
    day.protein_g += num(row.protein_g) ?? 0;
    day.carbs_g += num(row.carbs_g) ?? 0;
    day.fat_g += num(row.fat_g) ?? 0;
    day.meals += 1;
    byDay.set(date, day);
  }
  return [...byDay.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, DOSSIER_LIMITS.mealDays)
    .map((d) => ({ ...d, kcal: Math.round(d.kcal), protein_g: Math.round(d.protein_g), carbs_g: Math.round(d.carbs_g), fat_g: Math.round(d.fat_g) }));
}

/** The active plan, reduced to the week the athlete is in. Mirrors activePlanSummary. */
function activePlanSummary(plan: Record<string, unknown> | null) {
  if (!plan) return null;
  const title = str(plan.title, 120);
  if (!title) return null;
  const weeks = asArray<Record<string, unknown>>(plan.plan_data);
  const weekCurrent = num(plan.week_current) ?? 1;
  const week = weeks.find((w) => num(w.week) === weekCurrent) ?? weeks[0] ?? null;
  const sessions = asArray<Record<string, unknown>>(week?.sessions);
  const thisWeek = sessions.slice(0, DOSSIER_LIMITS.planSessions).map((s) => {
    const type = str(s.type, 30) || "session";
    const isRest = s.isRest === true || type.toLowerCase() === "rest";
    return {
      day: num(s.day),
      title: str(s.title, 120) || (isRest ? "Rest" : "Session"),
      type,
      minutes: num(s.duration_min) ?? num(s.duration),
      isRest,
    };
  });
  return {
    title,
    sport: str(plan.sport, 40) || "Unknown",
    week: weekCurrent,
    weeks: num(plan.duration_weeks) ?? weeks.length,
    focus: str(week?.focus, 60),
    sessionsThisWeek: thisWeek.filter((s) => !s.isRest).length,
    thisWeek,
  };
}

/**
 * Fetches the athlete's memory for the given user. `supabase` should be an
 * authenticated client scoped to that user (or service-role with a user id).
 * `clientPBs` are optional PBs forwarded from the client for convenience.
 */
export async function fetchAthleteDossier(
  supabase: SupabaseClient,
  userId: string,
  clientPBs?: EdgePB[] | null,
): Promise<Record<string, unknown>> {
  const [
    profileRes,
    metricsRes,
    injuryRes,
    recoveryRes,
    goalsRes,
    loadsRes,
    positionRes,
    sessionLoadRes,
    planRes,
    workoutsRes,
    mealsRes,
    plansRes,
    lifeEventsRes,
    checkInsRes,
    settingsRes,
    memoriesRes,
  ] = await Promise.all([
    supabase.from("profiles").select("sport, experience_level, date_of_birth, weight_kg, height_cm, goals, full_name, sex").eq("user_id", userId).maybeSingle(),
    supabase.from("performance_metrics").select("metric_type, value, unit, log_date, fatigue_level, sport").eq("user_id", userId).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.metrics),
    supabase.from("injury_logs").select("body_part, severity, status, log_date, notes, recovery_protocol").eq("user_id", userId).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.injuries),
    supabase.from("recovery_logs").select("readiness_score, log_date, sleep_quality, fatigue, soreness, mood, stress, energy, rest_hours").eq("user_id", userId).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.recovery),
    supabase.from("outcome_goals").select("title, category, target_value, current_value, metric_unit, deadline, status").eq("user_id", userId).limit(DOSSIER_LIMITS.goals),
    supabase.from("training_loads").select("log_date, sprint_load, endurance_load, strength_load, skill_load, total_rpe").eq("user_id", userId).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.loads),
    supabase.from("athlete_position").select("position, primary_sport").eq("user_id", userId).maybeSingle(),
    // Cross-sport load. Without it a football match the athlete did not log as
    // running reads as a missed week, and the model explains the wrong thing.
    supabase.from("performance_logs").select("log_date, sport, title, session_load").eq("user_id", userId).not("session_load", "is", null).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.sessionLoads),
    // The plan the athlete is on, and the week they are in.
    supabase.from("training_plans").select("title, sport, week_current, duration_weeks, plan_data").eq("user_id", userId).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("workouts").select("completed_at, started_at, created_at, sport, type, title, duration_minutes").eq("user_id", userId).order("created_at", { ascending: false }).limit(DOSSIER_LIMITS.workouts),
    supabase.from("meal_logs").select("log_date, calories, protein_g, carbs_g, fat_g").eq("user_id", userId).gte("log_date", daysAgoKey(DOSSIER_LIMITS.mealDays - 1)).limit(200),
    supabase.from("nutrition_plans").select("title, goal, weeks, calories_target, protein_target, carbs_target, fat_target, plan_data").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    // Breaks, illness and unavailability, so a holiday is not read as a failure.
    supabase.from("life_events").select("event_type, start_date, end_date, allow_training").eq("user_id", userId).order("start_date", { ascending: false }).limit(DOSSIER_LIMITS.lifeEvents),
    supabase.from("mental_checkins").select("created_at, readiness_score, stress, focus, fatigue").eq("user_id", userId).order("created_at", { ascending: false }).limit(DOSSIER_LIMITS.checkIns),
    // The nutrition questionnaire. These columns are newer than some
    // deployments, so the read is tolerant: a missing column costs this section
    // and nothing else.
    safe(() => supabase.from("user_settings").select("dietary_pattern, food_dislikes, meals_per_day, training_days_per_week, typical_session_minutes, activity_level").eq("user_id", userId).maybeSingle()),
    // Older deployed builds lack the coach_memories table; tolerate that.
    safe(() => supabase.from("coach_memories").select("category, key, value").eq("user_id", userId).limit(DOSSIER_LIMITS.memories)),
  ]);

  const profile: ProfileRow = (profileRes.data as ProfileRow | null) ?? {};
  const metrics: MetricRow[] = asArray<MetricRow>(metricsRes.data);
  const injuries: InjuryRow[] = asArray<InjuryRow>(injuryRes.data);
  const recoveryLogs: RecoveryRow[] = asArray<RecoveryRow>(recoveryRes.data);
  const age = ageFromDOB(profile.date_of_birth ?? null);
  const caps = getAgeCaps(age);

  // Prefer client PBs if the DB has no PB table (PBs are localStorage-only today)
  const pbs: EdgePB[] = Array.isArray(clientPBs) && clientPBs.length ? clientPBs.slice(0, 20) : [];

  const settings = (settingsRes.data ?? {}) as Record<string, unknown>;
  const planRow = (planRes.data ?? null) as Record<string, unknown> | null;
  const nutritionPlanRow = (plansRes.data ?? null) as Record<string, unknown> | null;
  const mealDays = mealDayTotals(mealsRes.data);

  const dossier: Record<string, unknown> = {
    builtAt: new Date().toISOString(),
    profile: {
      sport: profile.sport || null,
      experience_level: profile.experience_level || null,
      age,
      ageCaps: caps,
      sex: profile.sex ?? null,
      weight_kg: profile.weight_kg ?? null,
      height_cm: profile.height_cm ?? null,
      goals: profile.goals ?? null,
      position: (positionRes.data as { position?: string | null } | null)?.position ?? null,
      full_name: profile.full_name ?? null,
    },
    pbs,
    pbs_text: pbs.length ? pbs.map((p) => `${p.metric}: ${p.value}${p.unit ? " " + p.unit : ""} (${p.date})`).join("; ") : "No PBs logged yet.",
    recentMetrics: metrics.slice(0, DOSSIER_LIMITS.metrics),
    injuries: injuries.slice(0, DOSSIER_LIMITS.injuries),
    recovery: { logs: recoveryLogs, latest: recoveryLogs[0] ?? null },
    outcomeGoals: asArray<OutcomeGoalRow>(goalsRes.data),
    load: {
      dailyLoads: asArray<Record<string, unknown>>(loadsRes.data),
      sessionLoads: asArray<Record<string, unknown>>(sessionLoadRes.data),
    },
    activePlan: activePlanSummary(planRow),
    recentWorkouts: readWorkouts(workoutsRes.data),
    nutrition: {
      plan: nutritionPlanRow && str(nutritionPlanRow.title)
        ? {
            title: str(nutritionPlanRow.title, 120),
            goal: str(nutritionPlanRow.goal, 40) || "unspecified",
            weeks: num(nutritionPlanRow.weeks) ?? 0,
            calories: num(nutritionPlanRow.calories_target),
            protein_g: num(nutritionPlanRow.protein_target),
            carbs_g: num(nutritionPlanRow.carbs_target),
            fat_g: num(nutritionPlanRow.fat_target),
            hasMeals: asArray<unknown>(nutritionPlanRow.plan_data).length > 0,
          }
        : null,
      days: mealDays,
      loggedDays: mealDays.length,
      dietaryPattern: str(settings.dietary_pattern, 60),
      foodDislikes: str(settings.food_dislikes, 200),
      mealsPerDay: num(settings.meals_per_day),
    },
    trainingPreferences: {
      daysPerWeek: num(settings.training_days_per_week),
      typicalSessionMinutes: num(settings.typical_session_minutes),
      activityLevel: str(settings.activity_level, 40) || null,
    },
    lifeEvents: readLifeEvents(lifeEventsRes.data),
    mentalCheckins: readCheckIns(checkInsRes.data),
    coachMemories: asArray<CoachMemoryRow>(memoriesRes.data).slice(0, DOSSIER_LIMITS.memories),
  };

  return dossier;
}

/**
 * Renders the dossier as the prompt block every AI feature reads.
 *
 * THE SECTION ORDER HERE IS A CONTRACT with src/lib/athleteMemory.ts:
 * DOSSIER_SECTION_ORDER lists the same thirteen sections in the same order, and
 * its test asserts the order of the marker strings below by reading this file.
 * Add a section in both places or the suite fails — the point is that a feature
 * served by the client path and one served here describe the same athlete.
 */
export function formatDossierForPrompt(dossier: Record<string, unknown>): string {
  const p = (dossier.profile as ProfileRow & {
    position?: string | null;
    age?: number | null;
    ageCaps?: ReturnType<typeof getAgeCaps> | null;
  }) ?? {};
  const lines: string[] = [];
  lines.push(`ATHLETE DOSSIER (authoritative):`);

  const prefs = (dossier.trainingPreferences ?? {}) as Record<string, unknown>;
  const hasProfile = !!(p.sport || p.experience_level || p.age || p.ageCaps || prefs.daysPerWeek);
  if (hasProfile) {
    lines.push("# PROFILE");
    lines.push(`- Sport: ${p.sport || "Unknown"}${p.position ? ` · Position: ${p.position}` : ""}`);
    lines.push(`- Level: ${p.experience_level || "Unknown"}${p.age ? ` · Age: ${p.age}` : ""}`);
    if (p.sex) lines.push(`- Sex: ${p.sex}`);
    if (p.ageCaps) lines.push(`- Age caps: ${p.ageCaps.maxSessionsPerWeek} sessions/wk max, ${p.ageCaps.maxMinutesPerSession} min/session max, RPE ≤${p.ageCaps.maxRPE}, ≥${p.ageCaps.minRestDays} rest days/wk`);
    if (p.weight_kg || p.height_cm) lines.push(`- Physique: ${p.weight_kg ? p.weight_kg + "kg" : "?"} ${p.height_cm ? p.height_cm + "cm" : ""}`.trim());
    if (Array.isArray(p.goals) && p.goals.length) lines.push(`- Goals: ${p.goals.join(", ")}`);
    const prefBits: string[] = [];
    if (num(prefs.daysPerWeek) !== null) prefBits.push(`${num(prefs.daysPerWeek)} training days/wk`);
    if (num(prefs.typicalSessionMinutes) !== null) prefBits.push(`~${num(prefs.typicalSessionMinutes)} min a session`);
    if (str(prefs.activityLevel)) prefBits.push(`day job activity: ${str(prefs.activityLevel)}`);
    if (prefBits.length) lines.push(`- Training preferences: ${prefBits.join(", ")}`);
  }

  const pbsText = dossier.pbs_text as string;
  if (pbsText && !/^No PBs/.test(pbsText)) {
    lines.push("# PERSONAL BESTS");
    lines.push(`- Personal Bests: ${pbsText}`);
  }

  const metrics = asArray<MetricRow>(dossier.recentMetrics);
  const vpr = dossier.vpr as { overall_vpr?: number } | undefined;
  if (metrics.length || vpr?.overall_vpr) {
    lines.push("# PERFORMANCE");
    if (vpr?.overall_vpr) lines.push(`- VPR: ${Math.round(vpr.overall_vpr)}/100`);
    const archetype = dossier.archetype as { name?: string } | string | undefined;
    const archetypeName = typeof archetype === "string" ? archetype : archetype?.name;
    if (archetypeName) lines.push(`- Archetype: ${archetypeName}`);
    if (metrics.length) lines.push(`- Recent metrics: ${metrics.slice(0, 8).map((m) => `${m.metric_type}=${m.value}${m.unit ? m.unit : ""}`).join(", ")}`);
  }

  const injuries = asArray<InjuryRow>(dossier.injuries);
  if (injuries.length) {
    lines.push("# INJURIES");
    const active = injuries.filter((i) => i.status !== "resolved");
    lines.push(`- Active injuries: ${active.length ? active.map((i) => `${i.body_part} (sev ${i.severity}, ${i.status})`).join("; ") : "none active"}`);
    const withNotes = injuries.filter((i) => str(i.notes));
    for (const injury of withNotes.slice(0, 3)) {
      lines.push(`- ${injury.body_part} note (${str(injury.log_date).slice(0, 10)}): ${str(injury.notes, 160)}`);
    }
    const withProtocol = injuries.filter((i) => str(i.recovery_protocol));
    if (withProtocol.length) {
      lines.push(`- A rehabilitation plan is on file for: ${withProtocol.map((i) => i.body_part).join(", ")} (do not contradict it; ask before changing it)`);
    }
  }

  const recovery = (dossier.recovery ?? {}) as { logs?: RecoveryRow[]; latest?: RecoveryRow | null };
  const recoveryLogs = asArray<RecoveryRow>(recovery.logs);
  if (recoveryLogs.length) {
    lines.push("# RECOVERY");
    lines.push(`- Recovery (last ${recoveryLogs.length}): ${recoveryLogs.map((r) => `${r.log_date}:${r.readiness_score}`).join(", ")}`);
    const latest = recovery.latest ?? recoveryLogs[0];
    const sliders: string[] = [];
    if (num(latest?.sleep_quality) !== null) sliders.push(`sleep ${latest!.sleep_quality}/10`);
    if (num(latest?.fatigue) !== null) sliders.push(`fatigue ${latest!.fatigue}/10`);
    if (num(latest?.soreness) !== null) sliders.push(`soreness ${latest!.soreness}/10`);
    if (num(latest?.mood) !== null) sliders.push(`mood ${latest!.mood}/10`);
    if (num(latest?.stress) !== null) sliders.push(`stress ${latest!.stress}/10`);
    if (num(latest?.rest_hours) !== null) sliders.push(`${latest!.rest_hours}h sleep`);
    if (sliders.length) lines.push(`- Latest self-report: ${sliders.join(", ")}`);
  }

  const goals = asArray<OutcomeGoalRow>(dossier.outcomeGoals);
  if (goals.length) {
    lines.push("# OUTCOME GOALS");
    lines.push(`- Outcome goals: ${goals.map((g) => `${g.title} (${g.current_value ?? 0}/${g.target_value ?? "?"} ${g.metric_unit ?? ""})`).join("; ")}`);
  }

  const load = (dossier.load ?? {}) as { dailyLoads?: Record<string, unknown>[]; sessionLoads?: Record<string, unknown>[] };
  const daily = asArray<Record<string, unknown>>(load.dailyLoads);
  const sessionLoads = asArray<Record<string, unknown>>(load.sessionLoads);
  if (daily.length || sessionLoads.length) {
    lines.push("# TRAINING LOAD");
    if (daily.length) {
      lines.push(`- Daily load (${daily.length} days, newest first): ${daily.slice(0, 7).map((d) => `${str(d.log_date).slice(0, 10)}:${num(d.total_rpe) ?? "?"}`).join(", ")}`);
    }
    if (sessionLoads.length) {
      lines.push(`- sessionLoads (sport-specific units, newest first): ${sessionLoads.slice(0, 10).map((s) => `${str(s.log_date).slice(0, 10)} ${str(s.sport, 30)} ${num(s.session_load) ?? "?"}`).join("; ")}`);
    }
  }

  const plan = dossier.activePlan as {
    title: string; sport: string; week: number; weeks: number; focus: string; sessionsThisWeek: number;
    thisWeek: { day: number | null; title: string; type: string; minutes: number | null; isRest: boolean }[];
  } | undefined;
  if (plan) {
    lines.push("# CURRENT PLAN");
    lines.push(`- Plan: ${plan.title} (${plan.sport}) — week ${plan.week} of ${plan.weeks}${plan.focus ? `, focus: ${plan.focus}` : ""}`);
    lines.push(`- ${plan.sessionsThisWeek} sessions scheduled this week${plan.thisWeek.length ? `: ${plan.thisWeek.map((s) => `${s.day ? `day ${s.day} ` : ""}${s.title}${s.minutes ? ` (${s.minutes}min)` : ""}`).join("; ")}` : ""}`);
  }

  const workouts = asArray<{ date: string; sport: string; title: string; minutes: number | null }>(dossier.recentWorkouts);
  if (workouts.length) {
    lines.push("# RECENT SESSIONS");
    lines.push(`- Last ${workouts.length} logged: ${workouts.map((w) => `${w.date} ${w.sport} — ${w.title}${w.minutes ? ` ${w.minutes}min` : ""}`).join("; ")}`);
  }

  const nutrition = (dossier.nutrition ?? {}) as Record<string, unknown>;
  const savedPlan = nutrition.plan as {
    title?: string; goal?: string; weeks?: number; calories?: number | null; protein_g?: number | null;
    carbs_g?: number | null; fat_g?: number | null; hasMeals?: boolean;
  } | null | undefined;
  const foodDays = asArray<{ date: string; kcal: number; protein_g: number; meals: number }>(nutrition.days);
  if (savedPlan || foodDays.length || str(nutrition.dietaryPattern) || num(nutrition.mealsPerDay) !== null) {
    lines.push("# NUTRITION");
    if (savedPlan?.title) {
      lines.push(`- Saved plan: ${savedPlan.title} (${savedPlan.goal}, ${savedPlan.weeks} weeks) — targets ${savedPlan.calories ?? "?"} kcal, ${savedPlan.protein_g ?? "?"}g protein, ${savedPlan.carbs_g ?? "?"}g carbs, ${savedPlan.fat_g ?? "?"}g fat${savedPlan.hasMeals ? ", meals written" : ""}`);
    }
    const dislikes = str(nutrition.foodDislikes, 200);
    if (str(nutrition.dietaryPattern) || dislikes || num(nutrition.mealsPerDay) !== null) {
      const bits: string[] = [];
      if (str(nutrition.dietaryPattern)) bits.push(`dietary pattern: ${str(nutrition.dietaryPattern)}`);
      if (num(nutrition.mealsPerDay) !== null) bits.push(`${num(nutrition.mealsPerDay)} meals a day`);
      if (dislikes) bits.push(`foods to avoid or that do not suit them: ${dislikes}`);
      lines.push(`- What they told us about eating: ${bits.join("; ")}`);
    }
    if (foodDays.length) {
      lines.push(`- Logged food (${foodDays.length} days, newest first, per-day totals): ${foodDays.map((d) => `${d.date}: ${d.kcal} kcal, ${d.protein_g}g protein, ${d.meals} meals`).join("; ")}`);
    }
  }

  const lifeEvents = asArray<{ type: string; from: string; to: string; allowTraining: string; current: boolean }>(dossier.lifeEvents);
  if (lifeEvents.length) {
    lines.push("# BREAKS AND AVAILABILITY");
    lines.push(`- Breaks recorded: ${lifeEvents.map((e) => `${e.type} ${e.from}→${e.to} (training ${e.allowTraining}${e.current ? ", still running" : ""})`).join("; ")}`);
    lines.push(`- A break is not a failure: do not count these days as missed training and do not cram sessions into the days after them.`);
  }

  const checkIns = asArray<{ date: string; readiness_score: number | null; stress: number | null }>(dossier.mentalCheckins);
  if (checkIns.length) {
    lines.push("# MENTAL CHECK-INS");
    lines.push(`- Mental check-ins (newest first): ${checkIns.map((c) => `${c.date} readiness ${c.readiness_score ?? "?"}${c.stress !== null ? `, stress ${c.stress}/10` : ""}`).join("; ")}`);
  }

  const memories = asArray<CoachMemoryRow>(dossier.coachMemories);
  if (memories.length) {
    lines.push("# COACH MEMORIES");
    lines.push(`- Coach memories: ${memories.map((m) => `[${m.category}] ${m.key}: ${m.value}`).join("; ")}`);
  }

  return lines.join("\n");
}
