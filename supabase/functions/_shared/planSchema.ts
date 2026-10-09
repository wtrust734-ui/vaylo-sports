// ============================================================================
// PLAN SCHEMA VALIDATION — one implementation, two functions
// ----------------------------------------------------------------------------
// `generate-plan` writes a plan from nothing; `edit-plan` rewrites weeks of one
// that already exists. Both receive model output that the client is about to
// splice into `training_plans.plan_data` and render as training, so both need
// the same answer to "is this actually a plan?" — and two copies of that answer
// is how one of them ends up accepting a week the other rejects.
//
// The rules are unchanged from what generate-plan has always enforced:
//
//   * a week is an OBJECT carrying a `sessions` array — not a bare array of
//     days. (Treating each week as a bare array once dropped every week and
//     refunded every plan as "malformed": the model answered in the documented
//     shape and the check was wrong.)
//   * exactly 7 day objects per week, each with bounded, control-character-free
//     strings for the fields the UI renders.
//   * durations clamped to a non-negative, sane range rather than trusted.
//
// Malformed weeks are DROPPED, not thrown on. The caller decides whether what
// survived is enough — for a plan that the athlete paid for, it is not, and the
// caller refunds.
// ============================================================================

/** A string the UI can safely render: bounded length, no control characters. */
export function isSafePlanString(v: unknown, max: number): boolean {
  return typeof v === "string" && v.length <= max && !/\p{C}/u.test(v);
}

/**
 * Keeps the structurally valid weeks (exactly 7 valid days each) and returns
 * them in order. `duration` is deliberately NOT applied here: the caller knows
 * how many weeks it asked for and can tell a short answer from a complete one.
 */
export function cleanPlanWeeks(weeks: unknown[]): Record<string, unknown>[] {
  const clean: Record<string, unknown>[] = [];
  for (const week of weeks) {
    if (!week || typeof week !== "object" || Array.isArray(week)) continue;
    const w = week as Record<string, unknown>;
    const sessions = Array.isArray(w.sessions) ? w.sessions : null;
    if (!sessions) continue;
    const days = sessions
      .filter(
        (d): d is Record<string, unknown> =>
          !!d && typeof d === "object" &&
          isSafePlanString((d as Record<string, unknown>).dayName, 20) &&
          isSafePlanString((d as Record<string, unknown>).title, 120) &&
          isSafePlanString((d as Record<string, unknown>).type, 30),
      )
      .map((d) => ({
        ...d,
        duration_minutes: Math.max(0, Math.min(600, Number(d.duration_minutes) || 0)),
      }));
    if (days.length !== 7) continue;
    clean.push({ ...w, sessions: days });
  }
  return clean;
}

/**
 * The session types the app's own UI knows how to label. Anything else is still
 * accepted (the type is descriptive text, not a control), but an edit is told to
 * stay inside this list so a rewritten week does not invent a category the
 * colour map has never seen.
 */
export const PLAN_SESSION_TYPES = [
  "strength",
  "endurance",
  "speed",
  "intervals",
  "recovery",
  "rest",
  "sport_specific",
  "power",
  "cross_training",
  "conditioning",
] as const;

/** An edit must preserve unique week and day identities, even if the model reorders them. */
export function validEditedWeeks(edited: Record<string, unknown>[], requested: Record<string, unknown>[]): boolean {
  const weekIds = (weeks: Record<string, unknown>[]) => weeks.map(w => Number(w.week));
  const expected = weekIds(requested);
  const actual = weekIds(edited);
  if (expected.length !== actual.length || new Set(expected).size !== expected.length || new Set(actual).size !== actual.length) return false;
  if (actual.some(n => !Number.isInteger(n) || n < 1 || !expected.includes(n))) return false;
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return edited.every(w => {
    const days = w.sessions as Record<string, unknown>[];
    return Array.isArray(days) && days.length === 7 && new Set(days.map(d => d.day)).size === 7 &&
      days.every(d => Number.isInteger(d.day) && Number(d.day) >= 1 && Number(d.day) <= 7 && d.dayName === names[Number(d.day) - 1]);
  });
}
