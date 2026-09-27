// Vaylo Sports Performance Intelligence — pure calculation engines.
// All functions are deterministic and run client-side.

export type Sport = string;

export interface MetricRow {
  metric_type: string;
  value: number;
  unit?: string;
  log_date: string;
  fatigue_level?: number | null;
  sport?: string | null;
}

export interface VPRScores {
  speed_index: number;
  power_index: number;
  endurance_capacity: number;
  repeatability: number;
  skill_consistency: number;
  reaction_efficiency: number;
  overall_vpr: number;
}

// Sport weights — sum to 1.0
const SPORT_WEIGHTS: Record<string, Partial<Record<keyof Omit<VPRScores, "overall_vpr">, number>>> = {
  Running: { speed_index: 0.25, endurance_capacity: 0.35, repeatability: 0.2, power_index: 0.1, skill_consistency: 0.05, reaction_efficiency: 0.05 },
  Sprinting: { speed_index: 0.4, power_index: 0.3, reaction_efficiency: 0.15, repeatability: 0.1, skill_consistency: 0.03, endurance_capacity: 0.02 },
  Football: { speed_index: 0.2, power_index: 0.15, endurance_capacity: 0.2, repeatability: 0.15, skill_consistency: 0.2, reaction_efficiency: 0.1 },
  Basketball: { speed_index: 0.15, power_index: 0.2, endurance_capacity: 0.15, repeatability: 0.15, skill_consistency: 0.2, reaction_efficiency: 0.15 },
  Cycling: { endurance_capacity: 0.4, power_index: 0.3, repeatability: 0.15, speed_index: 0.1, skill_consistency: 0.03, reaction_efficiency: 0.02 },
  Swimming: { endurance_capacity: 0.35, power_index: 0.2, speed_index: 0.2, skill_consistency: 0.15, repeatability: 0.08, reaction_efficiency: 0.02 },
  Tennis: { reaction_efficiency: 0.2, skill_consistency: 0.25, speed_index: 0.15, power_index: 0.15, endurance_capacity: 0.15, repeatability: 0.1 },
  Rugby: { power_index: 0.25, speed_index: 0.2, repeatability: 0.2, endurance_capacity: 0.15, skill_consistency: 0.1, reaction_efficiency: 0.1 },
  default: { speed_index: 0.18, power_index: 0.18, endurance_capacity: 0.18, repeatability: 0.16, skill_consistency: 0.16, reaction_efficiency: 0.14 },
};

// Position multipliers (modify base sport weights slightly)
const POSITION_BIAS: Record<string, Partial<Record<keyof Omit<VPRScores, "overall_vpr">, number>>> = {
  Striker: { speed_index: 1.15, power_index: 1.1, skill_consistency: 1.05 },
  Defender: { power_index: 1.15, repeatability: 1.1, reaction_efficiency: 1.05 },
  Midfielder: { endurance_capacity: 1.2, repeatability: 1.1 },
  Goalkeeper: { reaction_efficiency: 1.3, skill_consistency: 1.1 },
  Sprinter: { speed_index: 1.2, power_index: 1.15 },
  Distance: { endurance_capacity: 1.25, repeatability: 1.1 },
  Guard: { reaction_efficiency: 1.15, skill_consistency: 1.1, speed_index: 1.05 },
  Forward: { power_index: 1.15, skill_consistency: 1.05 },
  Center: { power_index: 1.2 },
};

export function getSportWeights(sport: string, position?: string): Record<keyof Omit<VPRScores, "overall_vpr">, number> {
  const base = { ...(SPORT_WEIGHTS[sport] ?? SPORT_WEIGHTS.default) } as Record<string, number>;
  const bias = position ? POSITION_BIAS[position] : undefined;
  if (bias) for (const k of Object.keys(bias)) base[k] = (base[k] ?? 0.15) * (bias[k] ?? 1);
  // Normalize
  const sum = Object.values(base).reduce((a, b) => a + b, 0);
  const normalized: Record<string, number> = {};
  for (const k of Object.keys(base)) normalized[k] = base[k] / sum;
  // Ensure all 6 keys exist
  const keys = ["speed_index","power_index","endurance_capacity","repeatability","skill_consistency","reaction_efficiency"];
  for (const k of keys) if (!normalized[k]) normalized[k] = 0;
  return normalized;
}

// Convert a raw metric value to a 0-100 index.
// Uses calibrated reference ranges per metric type. The curve is intentionally
// steep so a perfect 100 requires elite-level numbers, not just "above good".
const METRIC_RANGES: Record<string, { good: number; elite: number; worldClass?: number; lowerIsBetter?: boolean }> = {
  sprint_40m: { good: 6.5, elite: 4.8, worldClass: 4.3, lowerIsBetter: true },
  sprint_100m: { good: 14, elite: 10.5, worldClass: 9.6, lowerIsBetter: true },
  vertical_jump: { good: 40, elite: 75, worldClass: 100 },
  broad_jump: { good: 200, elite: 320, worldClass: 380 },
  beep_test: { good: 8, elite: 14, worldClass: 17 },
  vo2_max: { good: 40, elite: 70, worldClass: 85 },
  reaction_time: { good: 350, elite: 180, worldClass: 130, lowerIsBetter: true },
  shooting_accuracy: { good: 60, elite: 90, worldClass: 97 },
  passing_accuracy: { good: 70, elite: 95, worldClass: 99 },
  serve_consistency: { good: 60, elite: 88, worldClass: 96 },
  first_touch: { good: 60, elite: 90, worldClass: 98 },
  bench_press: { good: 60, elite: 140, worldClass: 200 },
  squat: { good: 80, elite: 200, worldClass: 280 },
  plank: { good: 60, elite: 240, worldClass: 480 },
  ftp: { good: 200, elite: 400, worldClass: 480 },
};

export function metricToIndex(type: string, value: number): number {
  const r = METRIC_RANGES[type];
  if (!r) return Math.max(0, Math.min(100, value));
  const worldClass = r.worldClass ?? r.elite + (r.elite - r.good) * 0.4;
  // Piecewise: <good -> 0..60, good..elite -> 60..90, elite..worldClass -> 90..100
  let pct: number;
  const lower = r.lowerIsBetter === true;
  const between = (v: number, a: number, b: number) => (v - a) / (b - a || 1);
  if (lower) {
    if (value >= r.good) pct = Math.max(0, 60 - between(value, r.good, r.good * 1.5) * 60);
    else if (value >= r.elite) pct = 60 + between(value, r.good, r.elite) * 30;
    else pct = 90 + Math.min(1, between(value, r.elite, worldClass)) * 10;
  } else {
    if (value <= r.good) pct = Math.max(0, 60 * (value / Math.max(0.001, r.good)) ** 0.9);
    else if (value <= r.elite) pct = 60 + between(value, r.good, r.elite) * 30;
    else pct = 90 + Math.min(1, between(value, r.elite, worldClass)) * 10;
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// Group metrics into VPR buckets
const METRIC_TO_BUCKET: Record<string, keyof Omit<VPRScores, "overall_vpr">> = {
  sprint_40m: "speed_index", sprint_100m: "speed_index",
  vertical_jump: "power_index", broad_jump: "power_index", bench_press: "power_index", squat: "power_index",
  beep_test: "endurance_capacity", vo2_max: "endurance_capacity", ftp: "endurance_capacity", plank: "endurance_capacity",
  reaction_time: "reaction_efficiency",
  shooting_accuracy: "skill_consistency", passing_accuracy: "skill_consistency", serve_consistency: "skill_consistency", first_touch: "skill_consistency",
};

export function calculateVPR(metrics: MetricRow[], sport: string, position?: string): VPRScores {
  const buckets: Record<string, number[]> = {
    speed_index: [], power_index: [], endurance_capacity: [],
    repeatability: [], skill_consistency: [], reaction_efficiency: [],
  };
  for (const m of metrics) {
    const bucket = METRIC_TO_BUCKET[m.metric_type];
    if (bucket) buckets[bucket].push(metricToIndex(m.metric_type, m.value));
  }
  // Repeatability: low variance under fatigue = high repeatability
  const skillMetrics = metrics.filter((m) => METRIC_TO_BUCKET[m.metric_type] === "skill_consistency");
  if (skillMetrics.length >= 3) {
    const vals = skillMetrics.map((m) => metricToIndex(m.metric_type, m.value));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    buckets.repeatability.push(Math.max(0, 100 - Math.sqrt(variance) * 2));
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const scores = {} as VPRScores;
  for (const k of Object.keys(buckets)) scores[k] = Math.round(avg(buckets[k]));

  // Renormalize over buckets that have data — adding one bench press shouldn't
  // drag the score down just because endurance/skill buckets are still empty.
  const w = getSportWeights(sport, position);
  const presentKeys = Object.keys(buckets).filter((k) => buckets[k].length > 0);
  const weightSum = presentKeys.reduce((a, k) => a + (w[k] ?? 0), 0) || 1;
  const weighted = presentKeys.reduce(
    (a, k) => a + scores[k] * ((w[k] ?? 0) / weightSum),
    0,
  );

  // Data-completeness cap: a perfect 100 requires data in all 6 buckets.
  // 1 bucket → 70, 2 → 80, 3 → 88, 4 → 94, 5 → 98, 6 → 100.
  const completenessCap = [0, 70, 80, 88, 94, 98, 100][Math.min(6, presentKeys.length)];
  scores.overall_vpr = Math.min(completenessCap, Math.round(weighted));
  return scores;
}

/**
 * How much data is required before the archetype is meaningful.
 * PRODUCT RULE: "Your Archetype" stays UNDEFINED until the app has enough
 * reliable statistics — otherwise a premature label misleads the athlete.
 */
export const ARCHETYPE_MIN_METRICS = 6;       // total logged metrics
/** Minimum distinct VPR buckets that must have at least one metric. */
export const ARCHETYPE_MIN_BUCKETS = 4;

export function archetypeReadiness(metrics: MetricRow[]): { ready: boolean; filledBuckets: number; total: number } {
  const buckets = new Set<string>();
  for (const m of metrics) {
    const b = METRIC_TO_BUCKET[m.metric_type];
    if (b) buckets.add(b);
    // skill variance can populate repeatability, counts as a bucket too
    if (METRIC_TO_BUCKET[m.metric_type] === "skill_consistency") buckets.add("repeatability__probe");
  }
  // repeatability is derived, but counts if we have 3+ skill metrics
  const skillCount = metrics.filter((m) => METRIC_TO_BUCKET[m.metric_type] === "skill_consistency").length;
  const hasRepeatability = skillCount >= 3;
  // Distill to real VPR bucket count (excluding probe); add repeatability if derived
  const realBuckets = new Set<string>();
  for (const m of metrics) {
    const b = METRIC_TO_BUCKET[m.metric_type];
    if (b) realBuckets.add(b);
  }
  if (hasRepeatability) realBuckets.add("repeatability");
  const filledBuckets = realBuckets.size;
  const ready = metrics.length >= ARCHETYPE_MIN_METRICS && filledBuckets >= ARCHETYPE_MIN_BUCKETS;
  return { ready, filledBuckets, total: metrics.length };
}

// Identity archetypes — deep taxonomy driven by every logged bucket
export function detectArchetype(v: VPRScores): { name: string; description: string } {
  const { speed_index: s, power_index: p, endurance_capacity: e, repeatability: rep, skill_consistency: sk, reaction_efficiency: r } = v;
  const arr = [s, p, e, rep, sk, r];
  const maxVal = Math.max(...arr);
  const minVal = Math.min(...arr);
  const spread = maxVal - minVal;
  const avg = arr.reduce((a, b) => a + b, 0) / 6;

  if (avg >= 85 && spread < 20) return { name: "Complete Athlete", description: "Elite across every domain — the rare balanced apex profile." };
  if (avg >= 75 && spread < 15) return { name: "Balanced Elite", description: "No weaknesses. You compete on every axis." };

  if (s >= 80 && p >= 80 && r >= 70) return { name: "Explosive Finisher", description: "Fast, powerful, reactive. Built to end plays." };
  if (s >= 75 && p >= 70 && e < 55) return { name: "Explosive Dominant", description: "Power and speed are your weapons — short, decisive efforts." };
  if (s >= 80 && rep >= 70 && e < 60) return { name: "Repeat Sprinter", description: "You keep hitting top speed after everyone else fades." };
  if (p >= 80 && rep >= 70) return { name: "Power Grinder", description: "Heavy output, session after session." };

  if (e >= 85 && rep >= 75) return { name: "Diesel Engine", description: "Aerobic monster with bulletproof repeatability." };
  if (e >= 75 && p < 50 && s < 55) return { name: "Engine Dominant", description: "Aerobic machine — you outlast the field." };
  if (e >= 70 && p >= 65) return { name: "Hybrid Power-Endurance", description: "Rare two-way profile. Strong everywhere." };
  if (e >= 70 && sk >= 70) return { name: "Endurance Technician", description: "Long-duration efforts with clean execution." };

  if (sk >= 85 && r >= 75) return { name: "Cerebral Playmaker", description: "Reads faster than the game moves and executes cleanly." };
  if (sk >= 80 && rep >= 70) return { name: "Precision Craftsman", description: "Technical mastery under fatigue." };
  if (sk >= 75) return { name: "Skill-Dominant", description: "Technical mastery is your edge." };
  if (r >= 80 && s >= 65) return { name: "Reactive Sprinter", description: "First to move, first to arrive." };
  if (r >= 75 && sk >= 65) return { name: "Tactical Specialist", description: "You win moments before the ball does." };
  if (r >= 80) return { name: "Reaction Specialist", description: "Nervous-system speed defines your profile." };

  if (rep >= 80 && avg >= 60) return { name: "Iron Consistency", description: "Same output, every rep, every day." };

  if (p >= 80 && s < 60) return { name: "Strength Base", description: "Big raw output — direct it into sport-specific work." };
  if (s >= 80 && p < 60) return { name: "Pure Speed", description: "Top-end velocity — pair with strength to unlock power." };
  if (e >= 80 && rep < 55) return { name: "Aerobic Sponge", description: "High ceiling engine that needs load consistency to convert." };

  if (avg < 40) return { name: "Foundation Builder", description: "Log more sessions across sport-specific tests to sharpen the profile." };
  if (spread > 45) return { name: "Specialist In Progress", description: "Strong lead trait — close the gap on your weakest domain to raise the overall score." };
  if (avg >= 60) return { name: "Well-Rounded Contender", description: "Solid across the board — pick a lead axis to push into elite." };
  return { name: "Developing All-Rounder", description: "Balanced foundation — pick a direction to specialize." };
}

// ===== Training Load =====
export interface LoadRow { log_date: string; sprint_load: number; endurance_load: number; strength_load: number; skill_load: number; total_rpe: number; }
export interface LoadAnalysis {
  acute: number; chronic: number; ratio: number;
  sprintShare: number; enduranceShare: number; strengthShare: number;
  alerts: { type: "overtraining" | "undertraining" | "imbalance" | "spike" | "ok"; message: string }[];
  injuryRisk: "low" | "moderate" | "high";
}
export function analyzeLoads(loads: LoadRow[], age?: number): LoadAnalysis {
  const sorted = [...loads].sort((a, b) => a.log_date.localeCompare(b.log_date));
  const last7 = sorted.slice(-7);
  const last28 = sorted.slice(-28);
  const acute = last7.reduce((a, b) => a + b.total_rpe, 0) / Math.max(1, last7.length);
  const chronic = last28.reduce((a, b) => a + b.total_rpe, 0) / Math.max(1, last28.length);
  const ratio = chronic > 0 ? acute / chronic : 0;

  const sumAll = (k: keyof LoadRow) => last28.reduce((a, b) => a + (b[k] as number), 0);
  const total = sumAll("sprint_load") + sumAll("endurance_load") + sumAll("strength_load");
  const sprintShare = total > 0 ? sumAll("sprint_load") / total : 0;
  const enduranceShare = total > 0 ? sumAll("endurance_load") / total : 0;
  const strengthShare = total > 0 ? sumAll("strength_load") / total : 0;

  const alerts: LoadAnalysis["alerts"] = [];
  if (ratio > 1.5) alerts.push({ type: "overtraining", message: `Acute load ${(ratio).toFixed(2)}× chronic — high spike. Reduce intensity 20% for 3 days.` });
  else if (ratio > 1.3) alerts.push({ type: "spike", message: `Load ratio ${ratio.toFixed(2)} is above safe zone (0.8–1.3). Add a recovery session.` });
  else if (ratio < 0.7 && chronic > 0) alerts.push({ type: "undertraining", message: `Load dropped to ${ratio.toFixed(2)}× chronic. Detraining risk — add a quality session.` });
  else if (ratio >= 0.8 && ratio <= 1.3) alerts.push({ type: "ok", message: `Load ratio ${ratio.toFixed(2)} sits in the optimal sweet spot.` });

  if (sprintShare > 0.5) alerts.push({ type: "imbalance", message: `Sprint load is ${Math.round(sprintShare * 100)}% of total — tendon stress accumulating. Add aerobic volume.` });
  if (strengthShare < 0.1 && total > 0) alerts.push({ type: "imbalance", message: `Strength load is only ${Math.round(strengthShare * 100)}%. Add 1–2 strength sessions/week.` });

  if (age && age < 16 && acute > 800) alerts.push({ type: "overtraining", message: `Youth athlete (${age}yo) load above safe threshold. Cap at 800 RPE-min/week.` });

  let injuryRisk: LoadAnalysis["injuryRisk"] = "low";
  if (ratio > 1.5 || (sprintShare > 0.55 && acute > 600)) injuryRisk = "high";
  else if (ratio > 1.3 || ratio < 0.6) injuryRisk = "moderate";

  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio: +ratio.toFixed(2), sprintShare, enduranceShare, strengthShare, alerts, injuryRisk };
}

// ===== Skill fatigue impact =====
export function fatigueImpact(metrics: MetricRow[]): { score: number; dropoff: number } {
  const fresh = metrics.filter((m) => (m.fatigue_level ?? 5) <= 4);
  const tired = metrics.filter((m) => (m.fatigue_level ?? 5) >= 7);
  if (!fresh.length || !tired.length) return { score: 0, dropoff: 0 };
  const avg = (arr: MetricRow[]) => arr.reduce((a, b) => a + metricToIndex(b.metric_type, b.value), 0) / arr.length;
  const f = avg(fresh), t = avg(tired);
  const dropoff = f - t;
  return { score: Math.max(0, Math.round(100 - dropoff * 2)), dropoff: +dropoff.toFixed(1) };
}

// ===== Cross-sport transfer matrix =====
const TRANSFER_MATRIX: Record<string, Record<string, number>> = {
  Football: { Rugby: 0.85, Basketball: 0.7, Running: 0.6, Tennis: 0.5 },
  Basketball: { Football: 0.7, Rugby: 0.6, Tennis: 0.55, Running: 0.5 },
  Sprinting: { Football: 0.85, Rugby: 0.8, Basketball: 0.75, Cycling: 0.5 },
  Running: { Cycling: 0.75, Swimming: 0.6, Football: 0.5 },
  Cycling: { Running: 0.7, Swimming: 0.55 },
  Tennis: { Basketball: 0.5, Football: 0.45 },
  Rugby: { Football: 0.85, Basketball: 0.55 },
  Swimming: { Cycling: 0.55, Running: 0.5 },
};
export function crossSportFit(from: string, vpr: VPRScores): { sport: string; score: number; reason: string }[] {
  const candidates = Object.keys(SPORT_WEIGHTS).filter((s) => s !== "default" && s !== from);
  return candidates.map((sport) => {
    const transfer = TRANSFER_MATRIX[from]?.[sport] ?? 0.4;
    const w = getSportWeights(sport);
    const projected = (
      vpr.speed_index * w.speed_index + vpr.power_index * w.power_index +
      vpr.endurance_capacity * w.endurance_capacity + vpr.repeatability * w.repeatability +
      vpr.skill_consistency * w.skill_consistency + vpr.reaction_efficiency * w.reaction_efficiency
    );
    const score = Math.round(projected * 0.6 + transfer * 100 * 0.4);
    const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0]?.replace("_", " ") ?? "balance";
    return { sport, score, reason: `${sport} demands ${top} — your profile transfers ${Math.round(transfer * 100)}%.` };
  }).sort((a, b) => b.score - a.score);
}

// ===== Development trajectory =====
export function projectTrajectory(snapshots: { created_at: string; overall_vpr: number }[], ageNow?: number) {
  if (snapshots.length < 2) return { slope: 0, projected12mo: snapshots[0]?.overall_vpr ?? 0, peakProbability: 0 };
  const sorted = [...snapshots].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const months = Math.max(1, (new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30));
  const slope = (last.overall_vpr - first.overall_vpr) / months;
  const projected12mo = Math.min(100, Math.round(last.overall_vpr + slope * 12));
  let peakProbability = Math.min(95, Math.max(10, last.overall_vpr - 10 + slope * 6));
  if (ageNow && ageNow < 18) peakProbability += 10;
  if (ageNow && ageNow > 32) peakProbability -= 15;
  return { slope: +slope.toFixed(2), projected12mo, peakProbability: Math.max(5, Math.min(95, Math.round(peakProbability))) };
}

// ===== Tactical priority generator (multi-sport) =====
const SPORT_TACTICAL_PRIORITIES: Record<string, string[]> = {
  Football: ["Press triggers: shut wide passing lanes on second touch.", "Win second balls — sit on the 6 after every cross.", "Switch play to opposite winger when central is congested."],
  Basketball: ["Force ball-handler to weak hand on every pick-up.", "Crash boards — first to the ball at the rim.", "Counter the press with quick give-and-go through the middle."],
  Rugby: ["Dominate the gainline — first carrier sets the tempo.", "Compete at every ruck for 3 seconds, then disengage.", "Kick-chase organization — winger and 15 lock the box."],
  Tennis: ["Serve patterns 1-2-3: vary T, body, wide to break rhythm.", "Attack second serves into opponent's backhand corner.", "Approach short balls down the line, finish at net."],
  Running: ["Negative-split pacing — first half 2-3% slower than goal.", "Lock cadence at 178-184 spm. Don't chase early surges.", "Tuck behind a runner during the windy mid-section."],
  Cycling: ["Conserve in the pack — sit wheels 3-5 on flats.", "Attack the bottom 1/3 of the climb, not the top.", "Sprint setup: spin spin spin, then big gear at 200m."],
  Swimming: ["Front-half easier: build into the back-half.", "Hold stroke count under fatigue — technique > tempo.", "Turn execution: 5-stroke breakouts off every wall."],
  Boxing: ["Range control: 1-2 then circle out, never trade flat-footed.", "Body work in rounds 3-5 to slow them late.", "Reset stance after every exchange — no lazy returns."],
  MMA: ["Establish kicking range early, close to clinch when tired.", "Defensive grappling: hand-fight before takedowns commit.", "Pace: 70% in rounds 1-2, empty in round 3."],
  Cricket: ["First 10 balls — leave outside off, build rhythm.", "Bowling: top of off stump, hold length for 4 over spells.", "Rotate strike against spin, attack the loose ball."],
  CrossFit: ["Pace the first round 10% slower than gut feel.", "Break sets BEFORE failure, not at failure.", "Transition discipline — chalk, breathe, go. No wasted seconds."],
  Triathlon: ["Bike-to-run brick: hold cadence, shorten stride first km.", "Swim draft if pack is +/- 5sec/100m of your pace.", "Nutrition: 60-80g carbs/hr on the bike, gels every 25min on run."],
};

export function generateTacticalPriorities(input: {
  opponent_style?: string; environment?: string; competition_level?: string; position?: string; sport?: string;
}): string[] {
  const out: string[] = [];
  const o = (input.opponent_style ?? "").toLowerCase();
  const env = (input.environment ?? "").toLowerCase();
  const sport = (input.sport ?? "").split(",")[0].trim();

  // Sport-specific baseline
  const sportTips = SPORT_TACTICAL_PRIORITIES[sport];
  if (sportTips) out.push(...sportTips.slice(0, 2));

  // Opponent style modifiers (sport-agnostic phrasing)
  if (o.includes("aggressive") || o.includes("press") || o.includes("high")) out.push("Quick first-touch / first-move decisions — minimize dwell time.");
  if (o.includes("defensive") || o.includes("compact") || o.includes("counter-puncher")) out.push("Patience in build-up; create width or angles to break compact shapes.");
  if (o.includes("counter") || o.includes("transition")) out.push("Recovery work after every attack — never get caught flat.");
  if (o.includes("physical") || o.includes("aggressive")) out.push("Match physicality in the first 5 minutes — set the tone.");

  // Environment modifiers
  if (env.includes("hot") || env.includes("humid")) out.push("Front-load hydration 24h prior. Carry electrolytes for in-event sipping.");
  if (env.includes("cold") || env.includes("wet")) out.push("Extended warmup (15 min). Keep muscles warm during stoppages.");
  if (env.includes("altitude")) out.push("Pace 5–8% slower at high intensity. Prioritize breath rhythm.");
  if (env.includes("wind")) out.push("Use wind tactically — fight it early, ride it late.");

  // Competition level
  if (input.competition_level === "Elite" || input.competition_level === "Pro") {
    out.push("Mistakes get punished — high-percentage decisions only.");
  }

  if (!out.length) out.push("Execute your game plan. Trust the work.");
  return out.slice(0, 6);
}

