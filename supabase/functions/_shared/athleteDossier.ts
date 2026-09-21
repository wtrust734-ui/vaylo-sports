// Shared edge-function dossier — authoritative server-side athlete context.
// Mirrors src/lib/athleteDossier.ts but fetches via service-role / user JWT
// so the AI never trusts client-supplied PBs alone.

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

/**
 * Fetches a compact dossier for the given user. `supabase` should be an
 * authenticated client scoped to that user (or service-role with user id).
 * `clientPBs` are optional PBs forwarded from the client for convenience.
 */
export async function fetchAthleteDossier(
  supabase: any,
  userId: string,
  clientPBs?: EdgePB[] | null,
): Promise<Record<string, unknown>> {
  const [profileRes, metricsRes, injuryRes, recoveryRes, goalsRes, loadsRes, positionRes, memoriesRes] =
    await Promise.all([
      supabase.from("profiles").select("sport, experience_level, date_of_birth, weight_kg, height_cm, goals, full_name").eq("user_id", userId).maybeSingle(),
      supabase.from("performance_metrics").select("metric_type, value, unit, log_date, fatigue_level, sport").eq("user_id", userId).order("log_date", { ascending: false }).limit(40),
      supabase.from("injury_logs").select("body_part, severity, status, log_date, notes").eq("user_id", userId).order("log_date", { ascending: false }).limit(10),
      supabase.from("recovery_logs").select("readiness_score, log_date").eq("user_id", userId).order("log_date", { ascending: false }).limit(7),
      supabase.from("outcome_goals").select("title, category, target_value, current_value, metric_unit, deadline, status").eq("user_id", userId).limit(10),
      supabase.from("training_loads").select("log_date, sprint_load, endurance_load, strength_load, skill_load, total_rpe").eq("user_id", userId).order("log_date", { ascending: false }).limit(14),
      supabase.from("athlete_position").select("position, primary_sport").eq("user_id", userId).maybeSingle(),
      supabase.from("coach_memories").select("category, key, value").eq("user_id", userId).limit(30).then((r: any) => r).catch(() => ({ data: [] as any[] })),
    ]);

  const profile: any = profileRes.data || {};
  const metrics: any[] = metricsRes.data || [];
  const age = ageFromDOB(profile.date_of_birth ?? null);
  const caps = getAgeCaps(age);

  // Prefer client PBs if the DB has no PB table (PBs are localStorage-only today)
  const pbs: EdgePB[] = Array.isArray(clientPBs) && clientPBs.length ? clientPBs.slice(0, 20) : [];

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
      full_name: profile.full_name ?? null,
    },
    pbs,
    pbs_text: pbs.length ? pbs.map((p) => `${p.metric}: ${p.value}${p.unit ? " " + p.unit : ""} (${p.date})`).join("; ") : "No PBs logged yet.",
    recentMetrics: metrics.slice(0, 20),
    injuries: (injuryRes.data || []).slice(0, 5),
    recovery: recoveryRes.data || [],
    outcomeGoals: goalsRes.data || [],
    recentLoads: loadsRes.data || [],
    coachMemories: (memoriesRes?.data as any[]) || [],
  };

  return dossier;
}

export function formatDossierForPrompt(dossier: Record<string, unknown>): string {
  const p: any = dossier.profile || {};
  const lines: string[] = [];
  lines.push(`ATHLETE DOSSIER (authoritative):`);
  lines.push(`- Sport: ${p.sport || "Unknown"}${p.position ? ` · Position: ${p.position}` : ""}`);
  lines.push(`- Level: ${p.experience_level || "Unknown"}${p.age ? ` · Age: ${p.age}` : ""}`);
  if (p.ageCaps) lines.push(`- Age caps: ${p.ageCaps.maxSessionsPerWeek} sessions/wk max, ${p.ageCaps.maxMinutesPerSession} min/session max, RPE ≤${p.ageCaps.maxRPE}, ≥${p.ageCaps.minRestDays} rest days/wk`);
  if (p.weight_kg || p.height_cm) lines.push(`- Physique: ${p.weight_kg ? p.weight_kg + "kg" : "?"} ${p.height_cm ? p.height_cm + "cm" : ""}`.trim());
  if (p.goals?.length) lines.push(`- Goals: ${p.goals.join(", ")}`);
  const pbsText = dossier.pbs_text as string;
  if (pbsText) lines.push(`- Personal Bests: ${pbsText}`);
  const injuries: any[] = (dossier.injuries as any[]) || [];
  if (injuries.length) lines.push(`- Active injuries: ${injuries.filter((i) => i.status !== "resolved").map((i) => `${i.body_part} (sev ${i.severity}, ${i.status})`).join("; ") || "none active"}`);
  const recovery: any[] = (dossier.recovery as any[]) || [];
  if (recovery.length) lines.push(`- Recovery (last ${recovery.length}): ${recovery.map((r) => `${r.log_date}:${r.readiness_score}`).join(", ")}`);
  const goals: any[] = (dossier.outcomeGoals as any[]) || [];
  if (goals.length) lines.push(`- Outcome goals: ${goals.map((g) => `${g.title} (${g.current_value ?? 0}/${g.target_value ?? "?"} ${g.metric_unit ?? ""})`).join("; ")}`);
  const metrics: any[] = (dossier.recentMetrics as any[]) || [];
  if (metrics.length) lines.push(`- Recent metrics: ${metrics.slice(0, 8).map((m) => `${m.metric_type}=${m.value}${m.unit ? m.unit : ""}`).join(", ")}`);
  const memories: any[] = (dossier.coachMemories as any[]) || [];
  if (memories.length) lines.push(`- Coach memories: ${memories.map((m) => `[${m.category}] ${m.key}: ${m.value}`).join("; ")}`);
  return lines.join("\n");
}
