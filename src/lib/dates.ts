/**
 * Local calendar-day helpers.
 *
 * NEVER derive a day key with `toISOString().slice(0, 10)` — that returns the
 * *UTC* day. West of UTC an evening session lands on tomorrow; east of UTC a
 * morning session lands on yesterday. Streaks, daily water/meal/recovery logs
 * and "today's session" all depend on the athlete's own calendar day.
 */

/** Local calendar day as `YYYY-MM-DD`. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local day key N days before today (for "last 7 days" windows). */
export function localDateKeyDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateKey(d);
}

/** Full ISO timestamp — correct for `created_at`-style fields, wrong for day keys. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Whole days from `a` to `b` across two `YYYY-MM-DD` day keys, signed
 * (positive when `b` is later); null when either key is unreadable.
 *
 * The canonical day-delta. Before 2026-10-06 three modules each re-derived a
 * variant of this by hand — with two different null contracts — which is how
 * day arithmetic drifts: a second copy is a second chance to get the parsing
 * wrong. Import it from here instead of writing a fourth.
 *
 * Arithmetic runs in UTC on purpose: a day key is a calendar day, not an
 * instant, so the local-timezone slip this module's header warns about cannot
 * enter the subtraction.
 */
export function daysBetween(a: string, b: string): number | null {
  const parse = (key: string): number | null => {
    const [y, m, d] = key.split("-").map(Number);
    if (!y || !m || !d) return null;
    return Date.UTC(y, m - 1, d);
  };
  const from = parse(a);
  const to = parse(b);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86_400_000);
}
