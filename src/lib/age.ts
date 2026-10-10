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
//
// TARGET MARKET (2026-10-08): Vaylo Sports is built for athletes aged 18–30,
// from developing athletes through serious and competitive athletes. That is a
// positioning statement, NOT an enforced gate — the app performs no age
// verification, and TARGET_AGE_MAX is deliberately not a ceiling: the product
// does not refuse a 31-year-old, and inventing one would be neither useful nor
// lawful. The enforced floor for adult-only features stays ADULT_AGE, and the
// under-18 safety limits below stay switched on for any account whose date of
// birth shows they are under 18.
// ============================================================================

export const ADULT_AGE = 18;

/** Lower bound of the market this app is built for. Matches ADULT_AGE. */
export const TARGET_AGE_MIN = 18;

/**
 * Upper bound of the target market. Advisory only — this is the age range the
 * product is designed around, never a limit on who may hold an account.
 */
export const TARGET_AGE_MAX = 30;

/** The one sentence the app uses to describe who it is for. */
export const AUDIENCE_COPY =
  "Vaylo Sports is for 18–30-year-old athletes, from developing athletes through serious and competitive athletes.";

/**
 * The honest half of the same statement: the range is a target, not a check.
 * Used wherever the app has to explain itself to an account that is not in it.
 */
export const AUDIENCE_NOT_ENFORCED_COPY =
  "We don't verify age, so if your date of birth shows you're under 18, Vaylo keeps the age-based safety limits switched on.";

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
 * Why a diet/nutrition plan was refused, or null when it may be created.
 *
 * One function so the four screens that can create a plan cannot disagree.
 * An UNKNOWN date of birth is refused, not allowed: `profiles.date_of_birth` is
 * optional and the safe default for a nutrition restriction has to be "we do
 * not know, so we do not do it", not "we do not know, so we assume an adult".
 *
 * This is a product restriction, not merely a disclaimer. It mirrors
 * `public.viewer_is_adult()` in the database (unknown DOB ⇒ not an adult), so
 * the client and the server answer the same way.
 */
export function dietPlanRefusalReason(dob: string | null | undefined): string | null {
  if (!dob) return "We need your date of birth before we can build a nutrition plan.";
  const age = ageFromDob(dob);
  if (age === null) return "That date of birth doesn't look right — please check it in Profile.";
  if (age < ADULT_AGE) {
    return `Nutrition and diet plans aren't offered under ${ADULT_AGE}. Fuelling for an athlete who is still developing needs a dietitian or doctor, not an app.`;
  }
  return null;
}

/**
 * Age band for UI copy. Under-18s never receive sponsored content, so screens
 * that sell or promote sponsors can use this to explain why they are hidden.
 * The band is about what the app is allowed to do, not who it is aimed at.
 */
export const ageBand = (dob: string | null | undefined, at: Date = new Date()): "unknown" | "minor" | "adult" => {
  const age = ageFromDob(dob, at);
  if (age === null) return "unknown";
  return age >= ADULT_AGE ? "adult" : "minor";
};
