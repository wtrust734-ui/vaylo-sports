// Unit conversion + display helpers driven by the profile.preferred_units field
export type UnitSystem = "metric" | "imperial";

export const getUnits = (profile?: { preferred_units?: string | null } | null): UnitSystem =>
  profile?.preferred_units === "imperial" ? "imperial" : "metric";

// ── Distance ──
export const kmToMiles = (km: number) => km * 0.621371;
export const milesToKm = (mi: number) => mi / 0.621371;
export const distanceUnit = (u: UnitSystem) => (u === "imperial" ? "mi" : "km");
export const formatDistance = (km: number | null | undefined, u: UnitSystem, digits = 2) => {
  if (km == null) return "—";
  const v = u === "imperial" ? kmToMiles(km) : km;
  return `${v.toFixed(digits)} ${distanceUnit(u)}`;
};

// ── Weight ──
export const kgToLb = (kg: number) => kg * 2.20462;
export const lbToKg = (lb: number) => lb / 2.20462;
export const weightUnit = (u: UnitSystem) => (u === "imperial" ? "lb" : "kg");
export const formatWeight = (kg: number | null | undefined, u: UnitSystem, digits = 1) => {
  if (kg == null) return "—";
  const v = u === "imperial" ? kgToLb(kg) : kg;
  return `${v.toFixed(digits)} ${weightUnit(u)}`;
};

// ── Height ──
export const cmToFtIn = (cm: number) => {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return { ft, in: inch };
};
export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * 2.54;
export const formatHeight = (cm: number | null | undefined, u: UnitSystem) => {
  if (cm == null) return "—";
  if (u === "imperial") {
    const { ft, in: inch } = cmToFtIn(cm);
    return `${ft}'${inch}"`;
  }
  return `${Math.round(cm)} cm`;
};

// ── Temperature (useful for environment / heat-adapted plans) ──
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const tempUnit = (u: UnitSystem) => (u === "imperial" ? "°F" : "°C");
