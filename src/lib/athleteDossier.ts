// ============================================================================
// ATHLETE DOSSIER — the client half of the athlete's memory
// ----------------------------------------------------------------------------
// "The AI knows everything about me" is only true if one object is assembled
// once and every AI surface reads the SAME object. That object is this dossier:
// aiService attaches it to every call, the edge functions fetch the identical
// thing authoritatively with the service role (supabase/functions/_shared/
// athleteDossier.ts), and src/components/coach/AthleteKnowledgePanel.tsx shows
// the athlete what it holds.
//
// What it covers: profile and age caps, PBs, VPR and archetype, recent metrics,
// injuries, recovery and sleep, outcome goals, training load (daily and per
// sport), the active plan and the week the athlete is in, recent sessions, the
// nutrition plan and the last week of logged food, breaks and unavailable
// periods, mental check-ins, and the notes the coach has saved.
//
// Two rules this file holds to:
//
//   1. Nothing is invented. Every section is either fetched or absent, and an
//      absent section arrives as absent (null / empty), never as a plausible
//      default — a model told "weight: 0kg" will reason from it.
//   2. Nothing is unbounded. Every list is capped through DOSSIER_LIMITS, so a
//      three-year account produces the same size of prompt as a new one. The
//      caps live in athleteMemory.ts with the shapes they bound.
//
// Shape and helpers are in ./athleteMemory.ts (pure, unit-tested); this file is
// the fetching and the assembly.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { lsGet } from "./localStore";
import { calculateVPR, detectArchetype, type MetricRow } from "./performance";
import {
  DOSSIER_LIMITS,
  activePlanSummary,
  mealDayTotals,
  nutritionSummary,
  type MealLogLite,
  type PlanRowLite,
  type NutritionPlanLite,
} from "./athleteMemory";

export interface LocalPB {
  id: string;
  metric: string;
  value: number;
  unit: string;
  date: string;
  history: { date: string; value: number }[];
}

const PB_KEY = "vaylo_pbs_v1";

export function getLocalPBs(): LocalPB[] {
  try {
    return lsGet<LocalPB[]>(PB_KEY, []);
  } catch {
    return [];
  }
}

export function formatPBsForAI(pbs: LocalPB[]): string {
  if (!pbs.length) return "No PBs logged yet.";
  return pbs
    .slice(0, 20)
    .map((p) => `${p.metric}: ${p.value}${p.unit ? " " + p.unit : ""} (${p.date})`)
    .join("; ");
}

// Lightweight age helper
export function ageFromDOB(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 31557600000);
}

// Caps by chronological age — prevents overtraining via prescription, not just prompting
export function getAgeCaps(age: number | null) {
  if (age === null) return { maxSessionsPerWeek: 6, maxMinutesPerSession: 90, maxRPE: 9, minRestDays: 1, deloadEvery: 4, youth: false };
  if (age < 13) return { maxSessionsPerWeek: 3, maxMinutesPerSession: 45, maxRPE: 7, minRestDays: 2, deloadEvery: 3, youth: true };
  if (age < 16) return { maxSessionsPerWeek: 4, maxMinutesPerSession: 60, maxRPE: 8, minRestDays: 2, deloadEvery: 4, youth: true };
  if (age < 18) return { maxSessionsPerWeek: 5, maxMinutesPerSession: 75, maxRPE: 9, minRestDays: 1, deloadEvery: 4, youth: true };
  if (age >= 60) return { maxSessionsPerWeek: 4, maxMinutesPerSession: 60, maxRPE: 8, minRestDays: 2, deloadEvery: 3, youth: false };
  if (age >= 45) return { maxSessionsPerWeek: 5, maxMinutesPerSession: 75, maxRPE: 8, minRestDays: 1, deloadEvery: 4, youth: false };
  return { maxSessionsPerWeek: 6, maxMinutesPerSession: 90, maxRPE: 9, minRestDays: 1, deloadEvery: 4, youth: false };
}

/** Local date key `YYYY-MM-DD`, used to window the meal log. */
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

const daysAgoKey = (days: number) => dayKey(new Date(Date.now() - days * 86_400_000));

/** One recent session, reduced to what a coach would ask about. */
type WorkoutSummary = {
  date: string;
  sport: string;
  title: string;
  minutes: number | null;
};

const readWorkouts = (rows: unknown): WorkoutSummary[] =>
  (Array.isArray(rows) ? rows : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const date = String(r.completed_at ?? r.started_at ?? r.created_at ?? "").slice(0, 10);
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const sport = typeof r.sport === "string" && r.sport.trim() ? r.sport.trim() : String(r.type ?? "session");
      const minutes = typeof r.duration_minutes === "number" ? r.duration_minutes : null;
      if (!date || !title) return null;
      return { date, sport, title, minutes };
    })
    .filter((w): w is WorkoutSummary => w !== null)
    .slice(0, DOSSIER_LIMITS.workouts);

const readLifeEvents = (rows: unknown) =>
  (Array.isArray(rows) ? rows : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const type = typeof r.event_type === "string" ? r.event_type : "";
      const from = String(r.start_date ?? "").slice(0, 10);
      const to = String(r.end_date ?? "").slice(0, 10);
      if (!type || !from) return null;
      return {
        type,
        from,
        to: to || from,
        allowTraining: typeof r.allow_training === "string" ? r.allow_training : "unknown",
        /** True when the break is still running, so the model does not treat it as history. */
        current: (to || from) >= dayKey(new Date()),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .slice(0, DOSSIER_LIMITS.lifeEvents);

const readCheckIns = (rows: unknown) =>
  (Array.isArray(rows) ? rows : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const date = String(r.created_at ?? "").slice(0, 10);
      if (!date) return null;
      return {
        date,
        readiness_score: typeof r.readiness_score === "number" ? r.readiness_score : null,
        stress: typeof r.stress === "number" ? r.stress : null,
        focus: typeof r.focus === "number" ? r.focus : null,
        fatigue: typeof r.fatigue === "number" ? r.fatigue : null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .slice(0, DOSSIER_LIMITS.checkIns);

/**
 * Builds the athlete's memory as one object, to send as `userData` to any AI
 * endpoint and to show in the knowledge panel.
 *
 * Reads are issued in parallel and every one tolerates failure: a section the
 * database refused to return is absent from the dossier, and an absent section
 * is a thing the model can see, unlike a fabricated zero.
 */
export async function buildClientDossier(): Promise<Record<string, unknown>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { pbs: formatPBsForAI(getLocalPBs()), builtAt: new Date().toISOString() };

  const pbs = getLocalPBs();

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
    regionRes,
    memoriesRes,
  ] = await Promise.all([
    supabase.from("profiles").select("sport, experience_level, date_of_birth, weight_kg, height_cm, goals, full_name, sex").eq("user_id", user.id).maybeSingle(),
    supabase.from("performance_metrics").select("metric_type, value, unit, log_date, fatigue_level, sport").eq("user_id", user.id).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.metrics),
    supabase.from("injury_logs").select("body_part, severity, status, log_date, notes, recovery_protocol").eq("user_id", user.id).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.injuries),
    // Phase 3: the subjective sliders, not just the composite readiness score.
    // A model told "readiness 42" can speculate about why; a model told
    // "readiness 42, sleep 3/10, fatigue 9/10, 5 hours" can only describe what
    // the athlete actually reported.
    supabase.from("recovery_logs").select("readiness_score, log_date, sleep_quality, fatigue, soreness, mood, stress, energy, rest_hours").eq("user_id", user.id).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.recovery),
    supabase.from("outcome_goals").select("title, category, target_value, current_value, metric_unit, deadline, status").eq("user_id", user.id).limit(DOSSIER_LIMITS.goals),
    supabase.from("training_loads").select("log_date, sprint_load, endurance_load, strength_load, skill_load, total_rpe").eq("user_id", user.id).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.loads),
    supabase.from("athlete_position").select("position, primary_sport").eq("user_id", user.id).maybeSingle(),
    // Phase 3: the cross-sport load the coach must be able to see. Without it a
    // football match the athlete forgot to mention looks like a week of missed
    // running, and the model will confidently explain the wrong thing.
    supabase.from("performance_logs").select("log_date, sport, title, session_load").eq("user_id", user.id).not("session_load", "is", null).order("log_date", { ascending: false }).limit(DOSSIER_LIMITS.sessionLoads),
    // The plan the athlete is actually on, and the week they are in. A coach
    // asked "should I train today" without this is guessing at the programme.
    supabase.from("training_plans").select("title, sport, week_current, duration_weeks, plan_data").eq("user_id", user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("workouts").select("completed_at, started_at, created_at, sport, type, title, duration_minutes").eq("user_id", user.id).order("created_at", { ascending: false }).limit(DOSSIER_LIMITS.workouts),
    // The last week of logged food, as per-day totals rather than every meal.
    supabase.from("meal_logs").select("log_date, calories, protein_g, carbs_g, fat_g").eq("user_id", user.id).gte("log_date", daysAgoKey(DOSSIER_LIMITS.mealDays - 1)).limit(200),
    supabase.from("nutrition_plans").select("title, goal, weeks, calories_target, protein_target, carbs_target, fat_target, plan_data").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    // Breaks, illness and unavailability. Without these a two-week holiday
    // reads as a training failure and the coach explains the wrong thing.
    supabase.from("life_events").select("event_type, start_date, end_date, allow_training").eq("user_id", user.id).order("start_date", { ascending: false }).limit(DOSSIER_LIMITS.lifeEvents),
    supabase.from("mental_checkins").select("created_at, readiness_score, stress, focus, fatigue").eq("user_id", user.id).order("created_at", { ascending: false }).limit(DOSSIER_LIMITS.checkIns),
    // The nutrition questionnaire (the intake the plan wizard asks for). These
    // columns are newer than some deployments: naming a column the database does
    // not have returns an error rather than throwing, so a missing column costs
    // this section alone and the rest of the memory still builds.
    supabase.from("user_settings").select("dietary_pattern, food_dislikes, meals_per_day, training_days_per_week, typical_session_minutes, activity_level").eq("user_id", user.id).maybeSingle(),
    // The regional terminology layer needs the athlete's country (Prompt 9):
    // plans and coaching must use the sports language of where they train.
    supabase.from("user_region").select("country").eq("user_id", user.id).maybeSingle(),
    // Notes the coach saved while talking to the athlete (server-written).
    supabase.from("coach_memories").select("category, key, value").eq("user_id", user.id).limit(DOSSIER_LIMITS.memories),
  ]);

  const profile = (profileRes.data ?? {}) as {
    sport?: string | null;
    experience_level?: string | null;
    date_of_birth?: string | null;
    weight_kg?: number | null;
    height_cm?: number | null;
    goals?: string | string[] | null;
    full_name?: string | null;
    sex?: string | null;
  };
  const metrics = (metricsRes.data as MetricRow[] | null) || [];
  const age = ageFromDOB(profile.date_of_birth ?? null);
  const caps = getAgeCaps(age);

  // Compute VPR if we have metrics
  let vpr: unknown = null;
  let archetype: unknown = null;
  try {
    if (metrics.length) {
      const sport = (profile.sport || "").split(",")[0]?.trim() || "Running";
      const position = positionRes.data?.position || undefined;
      const scores = calculateVPR(metrics, sport, position);
      vpr = scores;
      archetype = detectArchetype(scores);
    }
  } catch { /* ignore */ }

  const recoveryLogs = (recoveryRes.data as Record<string, unknown>[] | null) ?? [];
  const settings = (settingsRes.data ?? {}) as Record<string, unknown>;
  const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const dossier: Record<string, unknown> = {
    /** When this memory was assembled. The panel shows it; a stale dossier must not read as current. */
    builtAt: new Date().toISOString(),
    /** Prompt 9: the athlete's region, for regional terminology in generated content. */
    region: regionRes.data?.country ?? null,
    profile: {
      sport: profile.sport || null,
      experience_level: profile.experience_level || null,
      age,
      ageCaps: caps,
      sex: profile.sex ?? null,
      weight_kg: profile.weight_kg ?? null,
      height_cm: profile.height_cm ?? null,
      goals: profile.goals ?? null,
      position: positionRes.data?.position ?? null,
    },
    pbs: pbs.slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })),
    pbs_text: formatPBsForAI(pbs),
    vpr,
    archetype,
    recentMetrics: metrics.slice(0, DOSSIER_LIMITS.metrics),
    injuries: (injuryRes.data ?? []).slice(0, DOSSIER_LIMITS.injuries),
    recovery: {
      logs: recoveryLogs,
      latest: recoveryLogs[0] ?? null,
    },
    outcomeGoals: goalsRes.data || [],
    load: {
      dailyLoads: loadsRes.data || [],
      // Cross-sport session load, newest first. `session_load` units are the
      // model's own and are documented in `src/lib/sessionLoad.ts`; the field
      // name is carried through rather than paraphrased so the model can be
      // told what it is looking at instead of guessing.
      sessionLoads: sessionLoadRes.data || [],
    },
    activePlan: activePlanSummary((planRes.data ?? null) as PlanRowLite | null),
    recentWorkouts: readWorkouts(workoutsRes.data),
    nutrition: nutritionSummary({
      plan: (plansRes.data ?? null) as NutritionPlanLite | null,
      mealRows: (mealsRes.data ?? []) as MealLogLite[],
      dietaryPattern: settings.dietary_pattern as string | null,
      foodDislikes: settings.food_dislikes as string | null,
      mealsPerDay: settings.meals_per_day as number | null,
    }),
    trainingPreferences: {
      daysPerWeek: numberOrNull(settings.training_days_per_week),
      typicalSessionMinutes: numberOrNull(settings.typical_session_minutes),
      activityLevel: typeof settings.activity_level === "string" ? settings.activity_level : null,
    },
    lifeEvents: readLifeEvents(lifeEventsRes.data),
    mentalCheckins: readCheckIns(checkInsRes.data),
    coachMemories: (memoriesRes.data ?? []).slice(0, DOSSIER_LIMITS.memories),
  };

  return dossier;
}

/** Small helper to get a one-line summary for non-AI UI (e.g. Cross-Training header) */
export function dossierSummary(dossier: Record<string, unknown>): string {
  const p = dossier.profile as { sport?: string; age?: number } | undefined;
  const vpr = dossier.vpr as { overall_vpr?: number } | undefined;
  const parts: string[] = [];
  if (p?.sport) parts.push(String(p.sport).split(",")[0]);
  if (p?.age) parts.push(`${p.age}yo`);
  if (vpr?.overall_vpr) parts.push(`VPR ${vpr.overall_vpr}`);
  const pbs = (dossier.pbs as { metric: string }[] | undefined) || [];
  if (pbs.length) parts.push(`${pbs.length} PBs`);
  return parts.join(" · ") || "Athlete dossier";
}

/** Re-exported so callers can show the same day totals the AI is given. */
export { mealDayTotals };
