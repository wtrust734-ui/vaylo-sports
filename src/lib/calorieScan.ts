// ============================================================================
// CALORIE SCAN — parse and reconcile the estimator's answer
// ----------------------------------------------------------------------------
// A calorie scan returns a headline number and (since 2026-10-24) the components
// that produced it. The components are the evidence: if the headline and the
// parts disagree, the parts win. A number an athlete cannot inspect is how a
// scan ends up "inaccurate" with no way to tell whether the portion, the food or
// the arithmetic was wrong.
//
// Pure: no React, no Supabase, so the reconciliation can be tested directly.
// ============================================================================

export interface CalorieScanItem {
  name: string;
  /** Cooked weight for cooked food; null when the model could not estimate it. */
  grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Energy density the component was measured against, kcal per 100 g. */
  kcalPer100g: number | null;
  reference?: string;
  confidence: "low" | "medium" | "high";
}

export interface CalorieScanResult {
  name: string;
  description?: string;
  items: CalorieScanItem[];
  calories: number;
  calories_low: number;
  calories_high: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  serving?: string;
  portion_basis?: string;
  uncertainty?: string;
  confidence: "low" | "medium" | "high";
  verdict?: "fuel" | "light" | "treat";
  verdict_reason?: string;
}

const num = (value: unknown, min = 0, max = 10_000): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const round = (n: number) => Math.round(n * 10) / 10;
const round5 = (n: number) => Math.round(n / 5) * 5;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().slice(0, max);
  return clean || undefined;
};

const confidenceOf = (value: unknown): "low" | "medium" | "high" =>
  value === "high" || value === "low" ? value : "medium";

const verdictOf = (value: unknown): "fuel" | "light" | "treat" | undefined =>
  value === "fuel" || value === "light" || value === "treat" ? value : undefined;

/** Read one component, or null when it carries no usable energy estimate. */
function readItem(raw: unknown): CalorieScanItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const name = text(item.name, 100);
  if (!name) return null;
  const protein = num(item.protein, 0, 500) ?? 0;
  const carbs = num(item.carbs, 0, 1_000) ?? 0;
  const fat = num(item.fat, 0, 500) ?? 0;
  const fiber = num(item.fiber, 0, 200) ?? 0;
  const stated = num(item.calories, 1, 5_000);
  // Atwater is the fallback when a component gives macros but no calories.
  const fromMacros = 4 * protein + 4 * carbs + 9 * fat + 2 * fiber;
  const grams = num(item.grams, 1, 5_000);
  const density = num(item.kcal_per_100g, 1, 1_000);
  // Quantity × density is the measurement; a separate calorie number is only a
  // summary of it. When both exist the measurement wins, so a model cannot
  // report a plausible-looking calorie count for a portion it also described
  // as twice that size.
  const fromDensity = grams !== null && density !== null ? (grams * density) / 100 : null;
  const calories = round5(fromDensity ?? stated ?? fromMacros);
  if (!calories) return null;
  return {
    name,
    grams: grams === null ? null : Math.round(grams),
    calories,
    protein: round(protein),
    carbs: round(carbs),
    fat: round(fat),
    fiber: round(fiber),
    kcalPer100g: density === null ? null : Math.round(density),
    reference: text(item.reference, 160),
    confidence: confidenceOf(item.confidence),
  };
}

/**
 * Parse a model answer into a consistent scan.
 *
 * Returns null for anything that cannot be logged as food — including a
 * "Not a meal" answer, which is honest but is not a meal row. The caller then
 * shows a failed scan rather than a confident 0 kcal entry.
 */
export function parseCalorieScan(raw: unknown): CalorieScanResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;

  const name = text(data.name, 80);
  const calories = num(data.calories, 1, 10_000);
  if (!name || calories === null || /^not a meal$/i.test(name)) return null;

  const items = (Array.isArray(data.items) ? data.items : [])
    .map(readItem)
    .filter((item): item is CalorieScanItem => item !== null)
    .slice(0, 16);

  const sum = (key: "calories" | "protein" | "carbs" | "fat" | "fiber") =>
    items.reduce((total, item) => total + item[key], 0);

  // The components are the evidence. When they exist they decide the total,
  // even if the model's headline disagrees with its own arithmetic.
  const totalCalories = items.length ? round5(sum("calories")) : round5(calories);
  if (!totalCalories) return null;

  const statedLow = num(data.calories_low, 1, 10_000);
  const statedHigh = num(data.calories_high, 1, 10_000);
  const confidence = confidenceOf(data.confidence);
  const spread = confidence === "high" ? 0.1 : confidence === "low" ? 0.25 : 0.16;
  const low = round5(Math.min(statedLow ?? totalCalories * (1 - spread), totalCalories));
  const high = round5(Math.max(statedHigh ?? totalCalories * (1 + spread), totalCalories));

  return {
    name,
    description: text(data.description, 400),
    items,
    calories: totalCalories,
    calories_low: low,
    calories_high: high,
    protein: items.length ? round(sum("protein")) : round(num(data.protein) ?? 0),
    carbs: items.length ? round(sum("carbs")) : round(num(data.carbs) ?? 0),
    fat: items.length ? round(sum("fat")) : round(num(data.fat) ?? 0),
    fiber: items.length ? round(sum("fiber")) : round(num(data.fiber) ?? 0),
    serving: text(data.serving, 60),
    portion_basis: text(data.portion_basis, 400),
    uncertainty: text(data.uncertainty, 300),
    confidence,
    verdict: verdictOf(data.verdict),
    verdict_reason: text(data.verdict_reason, 200),
  };
}

/** A copy-pasteable one-line reason for a range, when the model gave none. */
export function calorieRangeLabel(result: Pick<CalorieScanResult, "calories_low" | "calories" | "calories_high">): string {
  return `${result.calories_low}–${result.calories_high} kcal`;
}
