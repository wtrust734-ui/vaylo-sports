// ============================================================================
// UNITS — metric / imperial presentation layer, conversion at display only
// ----------------------------------------------------------------------------
// Prompt 9, section 3. The rules that make this safe:
//
//   1. Stored values are NEVER converted. `performance_logs.distance_km`,
//      `profiles.weight_kg`, plan targets — they stay in the base metric the
//      database and the training maths use. Every function here is a *view*.
//   2. Conversions happen with enough precision that re-presenting them never
//      materially changes the athlete's reading of a number (distance rounds
//      to 2 decimals of a mile, mass to 1 decimal of a pound — both standard).
//   3. Regions pick their units from REGION_CONVENTIONS in region.ts, so the
//      setting's one source of truth is the athlete's selected country.
//   4. Undefined / unsupported region falls back to metric, never to a guess.
// ============================================================================

import { getRegionCountry, REGION_CONVENTIONS } from "./region";

export type DistanceUnit = "km" | "mi";
export type WeightUnit = "kg" | "lb";

const KM_PER_MI = 1.609344;
const LB_PER_KG = 2.20462;

/** Which distance unit the selected region displays. Default: kilometres. */
export function distanceUnitFor(country?: string | null): DistanceUnit {
  const key = (country ?? getRegionCountry() ?? "").toUpperCase();
  return REGION_CONVENTIONS[key]?.distance ?? "km";
}

/** Which weight unit the selected region displays. Default: kilograms. */
export function weightUnitFor(country?: string | null): WeightUnit {
  const key = (country ?? getRegionCountry() ?? "").toUpperCase();
  return REGION_CONVENTIONS[key]?.weight ?? "kg";
}

/**
 * Kilometres → miles. Returns null for non-finite input so callers can keep
 * their "no value yet" states instead of showing a converted zero.
 */
export function kmToMiles(km: number | null | undefined): number | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  return km / KM_PER_MI;
}

/** Miles → kilometres — the only direction recorded data ever goes back in. */
export function milesToKm(mi: number | null | undefined): number | null {
  if (mi === null || mi === undefined || !Number.isFinite(mi)) return null;
  return mi * KM_PER_MI;
}

/** Kilograms → pounds; null-safe like the rest. */
export function kgToLbs(kg: number | null | undefined): number | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return null;
  return kg * LB_PER_KG;
}

/** Pounds → kilograms. */
export function lbsToKg(lb: number | null | undefined): number | null {
  if (lb === null || lb === undefined || !Number.isFinite(lb)) return null;
  return lb / LB_PER_KG;
}

/** Round-trip accuracy guard: what gets stored if a user's imperial reading is converted back. */
export function kmToMilesRounded(km: number | null | undefined, decimals = 2): number | null {
  const mi = kmToMiles(km);
  if (mi === null) return null;
  const f = 10 ** decimals;
  return Math.round(mi * f) / f;
}

export interface DisplayValue {
  /** The converted number, rounded to display precision. */
  value: number;
  unit: DistanceUnit | WeightUnit;
  /** e.g. "3.11 mi" / "5 km" — a ready-to-render string. */
  label: string;
}

/**
 * Display a stored kilometre distance in the region's unit.
 * Tolerances: rounding is display-only (2dp of a mile) and never feeds back
 * into stored values or training calculations.
 */
export function displayDistance(km: number | null | undefined, country?: string | null): DisplayValue | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  const unit = distanceUnitFor(country);
  if (unit === "km") {
    return { value: km, unit, label: `${km} km` };
  }
  const miles = kmToMilesRounded(km) ?? 0;
  return { value: miles, unit, label: `${miles} mi` };
}

/** Display a stored kilogram weight in the region's unit (1dp for pounds). */
export function displayWeight(kg: number | null | undefined, country?: string | null): DisplayValue | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return null;
  const unit = weightUnitFor(country);
  if (unit === "kg") {
    return { value: kg, unit, label: `${kg} kg` };
  }
  const lbs = kgToLbs(kg);
  const rounded = Math.round((lbs ?? 0) * 10) / 10;
  return { value: rounded, unit, label: `${rounded} lb` };
}

/**
 * Region-appropriate label for a paces/headline like a plan target.
 * The caller owns the number: this only picks the per-unit suffix text.
 */
export function paceUnitLabel(country?: string | null): string {
  return distanceUnitFor(country) === "mi" ? "min / mile" : "min / km";
}

/**
 * Convert a pace stored as seconds-per-km into the region's seconds-per-unit.
 * Pure arithmetic; no rounding beyond what the caller chooses for display.
 */
export function paceSecondsPerUnit(secondsPerKm: number, country?: string | null): number {
  return distanceUnitFor(country) === "mi" ? secondsPerKm * KM_PER_MI : secondsPerKm;
}
