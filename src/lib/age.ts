// ============================================================================
// AGE
// ----------------------------------------------------------------------------
// One place for age maths, so the app and the onboarding form agree with the
// database. `public.viewer_is_adult()` in Postgres is the authority for what an
// athlete is *allowed to see* — these helpers only decide what to render and
// what to validate, and they must be kept in step with it:
//
//   adult  ⇔  date_of_birth is at least 18 years before today
//   unknown date of birth  ⇒  NOT an adult
//
// Keep ADULT_AGE at 18. Every sponsored surface in the database is constrained
// to 18+ (`brand_placements.min_age` has a CHECK for it), so lowering this
// value alone would not unlock anything — it would only mislabel the UI.
// ============================================================================

export const ADULT_AGE = 18;

/** Oldest age we accept as plausible input. */
export const MAX_AGE = 100;

/** Whole years between a date of birth and `at` (defaults to now). */
export function ageFromDob(dob: string | null | undefined, at: Date = new Date()): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const month = at.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && at.getDate() < birth.getDate())) age -= 1;
  return age < 0 ? null : age;
}

/** Mirrors public.is_adult_birthdate(). Unknown date of birth is not an adult. */
export function isAdultDob(dob: string | null | undefined, at: Date = new Date()): boolean {
  const age = ageFromDob(dob, at);
  return age !== null && age >= ADULT_AGE;
}

/** Earliest date of birth we accept — guards against typos like 1901. */
export function earliestDob(at: Date = new Date()): string {
  const d = new Date(at);
  d.setFullYear(d.getFullYear() - MAX_AGE);
  return d.toISOString().slice(0, 10);
}

/** Human-readable problem with an entered date of birth, or null when it's fine. */
export function validateDob(dob: string, at: Date = new Date()): string | null {
  if (!dob) return null; // optional field
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return "That date doesn't look right.";
  if (parsed.getTime() > at.getTime()) return "Your date of birth can't be in the future.";
  if (parsed.toISOString().slice(0, 10) < earliestDob(at)) return "Please check that year.";
  return null;
}

/**
 * Age band for UI copy. Under-18s never receive sponsored content, so screens
 * that sell or promote sponsors can use this to explain why they are hidden.
 */
export const ageBand = (dob: string | null | undefined, at: Date = new Date()): "unknown" | "minor" | "adult" => {
  const age = ageFromDob(dob, at);
  if (age === null) return "unknown";
  return age >= ADULT_AGE ? "adult" : "minor";
};
