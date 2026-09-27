// ============================================================================
// SPORT PROFILES — one row per sport the app supports
// ----------------------------------------------------------------------------
// Drives every personalisation decision: which nav items a runner sees, which
// hub tiles exist for a weightlifter, what "your sport's skills" means.
// Names match Onboarding.SPORTS and the keys of SPORT_WEIGHTS in
// lib/performance.ts so the engine lines up with the rest of the app.
// ============================================================================

export type SportFamily = "endurance" | "team" | "skill" | "strength" | "combat" | "multi";

export type Discipline = {
  /** Sport name as stored in profiles.sport and used across the app. */
  name: string;
  family: SportFamily;
};

export const SPORT_DISCIPLINES: Discipline[] = [
  { name: "Running", family: "endurance" },
  { name: "Cycling", family: "endurance" },
  { name: "Swimming", family: "endurance" },
  { name: "Triathlon", family: "endurance" },
  { name: "Football", family: "team" },
  { name: "Basketball", family: "team" },
  { name: "Rugby", family: "team" },
  { name: "Tennis", family: "skill" },
  { name: "Weightlifting", family: "strength" },
  { name: "Climbing", family: "strength" },
  { name: "MMA / Boxing", family: "combat" },
  { name: "Other", family: "multi" },
];

export function familyForSport(sport: string): SportFamily | null {
  const s = sport.trim().toLowerCase();
  if (!s) return null;
  const hit = SPORT_DISCIPLINES.find((d) => d.name.toLowerCase() === s);
  return hit ? hit.family : null;
}

export function familyForSports(sports: string[]): SportFamily | null {
  for (const s of sports) {
    const f = familyForSport(s);
    if (f) return f;
  }
  return null;
}
