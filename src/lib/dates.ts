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
