// Client-side notification triggers for events the app itself can observe.
//
// DELIVERY HONESTY: a trigger fires only while the app is open (nothing here
// runs in the background), and what it creates goes two places: the in-app
// inbox, and — unless it is the athlete's quiet hours — the device's own
// notification shade through lib/localNotifications.ts. The shade copy is what
// survives closing the app, so the athlete still sees it later.
//
// Server-sent push (a message arriving while the app has not run at all) still
// needs the Firebase project in android/app/src/main/res/values/vaylo_fcm.xml.
// A check only running while the app is open is also what makes these
// trustworthy: everything sent reflects real logged data.
//
// No schema changes: dedup keys reuse the existing `link` column as
// `vaylo:<kind>:<yyyy-mm-dd>`. Each kind fires at most once per day.

import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "./dates";
import { showDeviceNotification } from "./localNotifications";

const PREF_KEY = "vaylo_trigger_prefs_v1";

export type TriggerPref = { last_daily_check?: string; last_streak_alert?: string };

export function getTriggerPref(): TriggerPref {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") as TriggerPref;
  } catch {
    return {};
  }
}

export function setTriggerPref(patch: TriggerPref): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...getTriggerPref(), ...patch }));
  } catch { /* private mode etc. — dedup degrades, nothing breaks */ }
}

async function insertOncePerDay(
  userId: string,
  kind: string,
  type: string,
  title: string,
  body: string,
  link?: string,
): Promise<boolean> {
  const today = localDateKey();
  const dedupKey = `vaylo:${kind}:${today}`;
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("link", dedupKey)
    .maybeSingle();
  if (existing) return false;
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
    link: dedupKey,
  });
  if (error) {
    console.error("notification trigger failed:", error.message);
    return false;
  }

  // Also put it on the device's own shade, which is what makes it reachable
  // after the app is closed. Quiet hours are honoured here rather than in the
  // notification module: the prefs are one small read, this is the only place
  // that speaks unprompted, and an athlete who set 22:00-06:30 means it.
  try {
    const prefs = await prefsFor(userId);
    if (!isWithinQuietHours(prefs)) {
      void showDeviceNotification({ title, body, link: link ?? null });
    }
  } catch {
    // A prefs read that fails must not lose the in-app notification, which is
    // already written.
  }
  return true;
}

async function prefsFor(userId: string): Promise<Record<string, boolean>> {
  const { data } = await supabase
    .from("notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  // Missing row = user never opened settings = everything on (app default).
  // Cast via unknown: the row mixes booleans with quiet_start/end strings.
  return (data as unknown as Record<string, boolean>) || {};
}

/** True when the user's day boundary has rolled over since the last check. */
export function shouldRunDailyCheck(): boolean {
  const p = getTriggerPref();
  return p.last_daily_check !== localDateKey();
}

export function markDailyCheckDone(): void {
  setTriggerPref({ last_daily_check: localDateKey() });
}

/**
 * Streak-at-risk alert: fires when every action was completed yesterday but
 * at least one is still open today. Real numbers only — a fabricated streak
 * is never quoted.
 */
export async function checkStreakAlert(
  userId: string,
  actions: { id: string; active: boolean }[],
  logs: { action_id: string; log_date: string; completed: boolean }[],
  streak: number,
): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.streak_alerts === false) return;
  const active = actions.filter((a) => a.active);
  if (!active.length || streak <= 0) return;
  const today = localDateKey();
  const yest = localDateKey(new Date(Date.now() - 86400000));
  const idx = new Map<string, boolean>();
  for (const l of logs) if (l.completed) idx.set(`${l.action_id}|${l.log_date}`, true);
  const allDoneYesterday = active.every((a) => idx.get(`${a.id}|${yest}`) === true);
  const anyOpenToday = active.some((a) => idx.get(`${a.id}|${today}`) !== true);
  if (allDoneYesterday && anyOpenToday) {
    await insertOncePerDay(
      userId,
      "streak",
      "streak_alert",
      `${streak}-day streak at risk`,
      `Complete ${active.length} action${active.length === 1 ? "" : "s"} today to keep it alive.`,
      "/goals",
    );
  }
}

/** Nudge when today's training-plan session is still untouched in the evening. */
export async function checkWorkoutReminder(
  userId: string,
  plan: { id: string; title: string; week_current: number; duration_weeks: number; plan_data: unknown } | null,
): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.workout_reminders === false) return;
  if (!plan) return;
  const h = new Date().getHours();
  if (h < 17) return;
  const week = (plan.plan_data as { week: number; sessions?: { skipped?: boolean; isRest?: boolean }[] }[] | null)?.find(
    (w) => w.week === plan.week_current,
  );
  const todaySessions = week?.sessions ?? [];
  const actionable = todaySessions.filter((s) => !s.skipped && !s.isRest);
  if (!actionable.length) return; // rest day — nothing to remind about
  await insertOncePerDay(
    userId,
    "workout",
    "workout_reminder",
    "Today's session is waiting",
    `Week ${plan.week_current} of ${plan.title} has ${actionable.length} session${actionable.length === 1 ? "" : "s"} waiting.`,
    // Deep-linked to the plan, not to /workouts. The workout log screen was
    // removed; the plan is where those sessions are still listed and can be
    // ticked off, so "left to log" also went — there is nothing to log.
    "/training",
  );
}

/** Warn when a joined challenge ends within 3 days and the athlete is behind. */
export async function checkChallengeDeadlines(
  userId: string,
  challenges: { id: string; title: string; end_date: string; target_value: number }[],
  participants: { challenge_id: string; progress: number; status: string }[],
): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.challenge_deadlines === false) return;
  const in3 = localDateKey(new Date(Date.now() + 3 * 86400000));
  const today = localDateKey();
  for (const c of challenges) {
    const p = participants.find((x) => x.challenge_id === c.id);
    if (!p || p.status !== "active") continue;
    if (localDateKey(new Date(c.end_date)) !== in3) continue;
    const pct = c.target_value > 0 ? Math.round((p.progress / c.target_value) * 100) : 0;
    if (pct >= 100) continue;
    await insertOncePerDay(
      userId,
      `chal-${c.id}`,
      "challenge_deadline",
      `"${c.title}" ends soon`,
      pct > 0
        ? `${pct}% complete with 3 days left — finish strong.`
        : "You haven't logged progress yet — 3 days left.",
      "/challenges",
    );
  }
}

/**
 * Quiet-hours gate (notification_prefs.quiet_start/end) for any client-side
 * surfacing. The columns are `time without time zone` — "HH:MM:SS" strings —
 * compared against the athlete's LOCAL clock (new Date().getHours()), which is
 * the documented quiet-hours policy: no timezone conversion, the athlete's own
 * night stays quiet wherever they are.
 */
export function isWithinQuietHours(pref: { quiet_start?: string | null; quiet_end?: string | null }): boolean {
  const toMinutes = (t: string | null | undefined): number | null => {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return null;
    const h = Number(m[1]);
    const mins = Number(m[2]);
    if (h > 23 || mins > 59) return null;
    return h * 60 + mins;
  };
  const s = toMinutes(pref.quiet_start);
  const e = toMinutes(pref.quiet_end);
  if (s == null || e == null) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e; // window may span midnight
}
