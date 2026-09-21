// Athlete dossier — single source for personalization across all AI surfaces.
// Client-side: gathers local PBs + Supabase state into a compact userData
// payload. Server-side edge functions have a mirror in supabase/functions/_shared/athleteDossier.ts
// that fetches the same dossier authoritatively.

import { supabase } from "@/integrations/supabase/client";
import { lsGet } from "./localStore";
import { calculateVPR, detectArchetype, type MetricRow } from "./performance";

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

/**
 * Builds a compact dossier to send as `userData` to any AI endpoint.
 * Call this before every AI invocation so every model sees the same athlete truth.
 * Keeps payload under the 12k userDataJson limit by truncating lists.
 */
export async function buildClientDossier(): Promise<Record<string, unknown>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { pbs: formatPBsForAI(getLocalPBs()) };

  const pbs = getLocalPBs();

  // Fire all Supabase reads in parallel; tolerate failures
  const [profileRes, metricsRes, injuryRes, recoveryRes, goalsRes, loadsRes, positionRes] = await Promise.all([
    supabase.from("profiles").select("sport, experience_level, date_of_birth, weight_kg, height_cm, goals, full_name").eq("user_id", user.id).maybeSingle(),
    supabase.from("performance_metrics").select("metric_type, value, unit, log_date, fatigue_level, sport").eq("user_id", user.id).order("log_date", { ascending: false }).limit(40),
    supabase.from("injury_logs").select("body_part, severity, status, log_date, notes").eq("user_id", user.id).order("log_date", { ascending: false }).limit(10),
    supabase.from("recovery_logs").select("readiness_score, log_date").eq("user_id", user.id).order("log_date", { ascending: false }).limit(7),
    supabase.from("outcome_goals").select("title, category, target_value, current_value, metric_unit, deadline, status").eq("user_id", user.id).limit(10),
    supabase.from("training_loads").select("log_date, sprint_load, endurance_load, strength_load, skill_load, total_rpe").eq("user_id", user.id).order("log_date", { ascending: false }).limit(14),
    supabase.from("athlete_position").select("position, primary_sport").eq("user_id", user.id).maybeSingle(),
  ]);

  const profile: any = profileRes.data || {};
  const metrics = (metricsRes.data as MetricRow[] | null) || [];
  const age = ageFromDOB(profile.date_of_birth ?? null);
  const caps = getAgeCaps(age);

  // Compute VPR if we have metrics
  let vpr: unknown = null;
  let archetype: unknown = null;
  try {
    if (metrics.length) {
      const sport = (profile.sport || "").split(",")[0]?.trim() || "Running";
      const position = (positionRes.data as any)?.position || undefined;
      const scores = calculateVPR(metrics, sport, position);
      vpr = scores;
      archetype = detectArchetype(scores);
    }
  } catch { /* ignore */ }

  const dossier: Record<string, unknown> = {
    profile: {
      sport: profile.sport || null,
      experience_level: profile.experience_level || null,
      age,
      ageCaps: caps,
      weight_kg: profile.weight_kg ?? null,
      height_cm: profile.height_cm ?? null,
      goals: profile.goals ?? null,
      position: (positionRes.data as any)?.position ?? null,
    },
    pbs: pbs.slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })),
    pbs_text: formatPBsForAI(pbs),
    vpr,
    archetype,
    recentMetrics: metrics.slice(0, 20),
    injuries: (injuryRes.data || []).slice(0, 5),
    recovery: recoveryRes.data || [],
    outcomeGoals: goalsRes.data || [],
    recentLoads: loadsRes.data || [],
  };

  return dossier;
}

/** Small helper to get a one-line summary for non-AI UI (e.g. Cross-Training header) */
export function dossierSummary(dossier: Record<string, unknown>): string {
  const p = dossier.profile as any;
  const vpr: any = dossier.vpr;
  const parts: string[] = [];
  if (p?.sport) parts.push(String(p.sport).split(",")[0]);
  if (p?.age) parts.push(`${p.age}yo`);
  if (vpr?.overall_vpr) parts.push(`VPR ${vpr.overall_vpr}`);
  const pbs: any[] = (dossier.pbs as any[]) || [];
  if (pbs.length) parts.push(`${pbs.length} PBs`);
  return parts.join(" · ") || "Athlete dossier";
}
