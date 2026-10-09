import { getSportWeights, metricToIndex, type MetricRow } from "@/lib/performance";

export const LIMITER_QUESTIONS = [
  { id: "sprint_ability", question: "How reliably can you accelerate and sustain short bursts in your sport?", category: "speed" },
  { id: "long_effort", question: "How well can you sustain hard efforts for the duration your sport demands?", category: "endurance" },
  { id: "strength", question: "How well does your strength support the movements your sport demands?", category: "strength" },
  { id: "power", question: "How quickly can you produce force for jumps, throws, or decisive movements?", category: "power" },
  { id: "mobility", question: "How comfortably can you reach the positions and ranges your sport requires?", category: "mobility" },
  { id: "agility", question: "How confidently can you react, brake, and change direction under control?", category: "agility" },
  { id: "technique", question: "How repeatable is your sport-specific technique when you are tired?", category: "technique" },
  { id: "recovery", question: "How ready do you usually feel before your next planned session?", category: "recovery" },
] as const;

export type LimiterCategory = (typeof LIMITER_QUESTIONS)[number]["category"];
export type LimiterAnswer = Record<string, number>;
export type LimiterDataEvidence = "self-rating only" | "self-rating + logged metric" | "logged metric + self-rating";
export interface LimiterScore {
  name: LimiterCategory;
  score: number;
  priority: number;
  evidence: LimiterDataEvidence;
}
export interface LimiterAnalysis {
  limiters: LimiterScore[];
  answered: number;
  objectiveCategories: number;
  confidence: string;
}

const METRIC_CATEGORY: Record<string, LimiterCategory> = {
  sprint_40m: "speed", sprint_100m: "speed",
  beep_test: "endurance", vo2_max: "endurance", ftp: "endurance",
  bench_press: "strength", squat: "strength",
  vertical_jump: "power", broad_jump: "power",
  reaction_time: "agility",
  shooting_accuracy: "technique", passing_accuracy: "technique", serve_consistency: "technique", first_touch: "technique",
};

const SPORT_WEIGHT: Record<LimiterCategory, keyof ReturnType<typeof getSportWeights>> = {
  speed: "speed_index",
  endurance: "endurance_capacity",
  strength: "power_index",
  power: "power_index",
  mobility: "repeatability",
  agility: "reaction_efficiency",
  technique: "skill_consistency",
  recovery: "repeatability",
};

const isRating = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10;

/**
 * Ranks only categories the athlete actually answered. Available logged tests
 * contribute as stronger evidence, but a missing test is never coerced to zero
 * or a made-up mid-point. Self ratings remain visible as self ratings.
 */
export function analyzeLimiterTest(
  answers: LimiterAnswer,
  metrics: MetricRow[],
  sport: string,
  readiness: { readiness_score: number | null }[] = [],
): LimiterAnalysis {
  const validAnswers = new Map<LimiterCategory, number[]>();
  for (const question of LIMITER_QUESTIONS) {
    const value = answers[question.id];
    if (!isRating(value)) continue;
    const rows = validAnswers.get(question.category) ?? [];
    rows.push(value * 10);
    validAnswers.set(question.category, rows);
  }

  const objective = new Map<LimiterCategory, number[]>();
  for (const metric of metrics) {
    const category = METRIC_CATEGORY[metric.metric_type];
    if (!category || !Number.isFinite(metric.value)) continue;
    const rows = objective.get(category) ?? [];
    rows.push(metricToIndex(metric.metric_type, metric.value));
    objective.set(category, rows);
  }
  for (const log of readiness) {
    if (log.readiness_score == null || !Number.isFinite(log.readiness_score)) continue;
    const rows = objective.get("recovery") ?? [];
    rows.push(Math.max(0, Math.min(100, log.readiness_score)));
    objective.set("recovery", rows);
  }

  const weights = getSportWeights(sport);
  const ranked = [...validAnswers.entries()].map(([name, selfRatings]) => {
    const selfScore = selfRatings.reduce((sum, value) => sum + value, 0) / selfRatings.length;
    const objectiveScores = objective.get(name);
    const hasObjective = !!objectiveScores?.length;
    const objectiveScore = hasObjective
      ? objectiveScores.reduce((sum, value) => sum + value, 0) / objectiveScores.length
      : null;
    const score = objectiveScore == null ? selfScore : objectiveScore * 0.7 + selfScore * 0.3;
    const weight = weights[SPORT_WEIGHT[name]] ?? 0;
    return {
      name,
      score: Math.round((score / 10) * 10) / 10,
      priority: (100 - score) * weight,
      evidence: (hasObjective ? "logged metric + self-rating" : "self-rating only") as LimiterDataEvidence,
    };
  }).sort((a, b) => b.priority - a.priority || a.score - b.score);

  const objectiveCategories = ranked.filter((item) => objective.has(item.name)).length;
  return {
    limiters: ranked.slice(0, 3),
    answered: [...validAnswers.values()].reduce((sum, ratings) => sum + ratings.length, 0),
    objectiveCategories,
    confidence: objectiveCategories
      ? `Includes logged performance data in ${objectiveCategories} category${objectiveCategories === 1 ? "" : "ies"}; other ratings are self-reported.`
      : "Based on self-ratings only; log performance tests for an objective comparison.",
  };
}
