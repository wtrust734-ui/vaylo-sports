// Client-side notification triggers for events the app itself can observe.
//
// THE SCHEDULE (decided 2026-10-14 — every trigger below serves one of these):
//
//   1. Plan created (immediate, on save). "Your <Sport> plan is ready" + what
//      week 1 starts with. Also arms the next 7 morning briefings.
//   2. Morning briefing (07:10 local, pre-scheduled 7 days out so it fires
//      with the app closed). Personalised to today's session; rest days get a
//      recovery line instead of a nudge. Max one device ping per morning.
//   3. Evening nudge (~18:00, app-open check): today's session still untouched.
//   4. Streak alert (app-open check): everything done yesterday, something
//      open today. Real numbers only, never a fabricated streak. When exactly
//      one action is left, the final-push variant fires instead (own key).
//   5. Challenge deadlines (app-open check): 3 days out, 1 day out, ends today.
//   6. Reengagement: a single device ping armed 72h out on every app open (so
//      it fires only when the athlete never came back), plus an in-app note.
//   7. Low credits (app-open check): balance ≤ 15, at most every 3 days.
//      Unlimited accounts are never warned — there is nothing to warn about.
//   8. Poor recovery (app-open check): today's readiness ≤ 35. Gentle, once
//      a day, suggesting the easy option rather than scolding.
//   9. Streak reminder (pre-scheduled 08:00, next morning): the recovery
//      check-in that keeps the streak alive. Armed on every app open, with
//      the app-closed delivery the OS scheduler owns — it is the one nudge
//      aimed at someone who has NOT opened the app.
//
// ANTI-BOMBARDMENT: at most 2 shade pings per day across ALL kinds
// (MAX_DEVICE_PINGS_PER_DAY, this-device localStorage). The inbox row is
// always written; the shade stays silent past budget. Mornings and the
// plan-created moment bypass the budget — the morning is the anchor, the
// plan is once per plan — everything else competes for the spare slot.
//
// DELIVERY HONESTY: immediate triggers fire only while the app is open, and
// what they create goes two places: the in-app inbox, and — unless it is the
// athlete's quiet hours — the device's own notification shade through
// lib/localNotifications.ts. Pre-scheduled notifications (mornings,
// reengagement) are owned by the OS once scheduled, so they DO fire with the
// app closed — that is their entire reason to exist.
//
// Server-sent push (a message arriving while the app has not run at all AND
// nothing was pre-scheduled) still needs the Firebase project in
// android/app/src/main/res/values/vaylo_fcm.xml.
//
// No schema changes: dedup keys reuse the existing `link` column as
// `vaylo:<kind>:<yyyy-mm-dd>`. Each kind fires at most once per day.

import { supabase } from "@/integrations/supabase/client";
import { daysBetween, localDateKey } from "./dates";
import {
  cancelDeviceNotifications,
  morningIdForDate,
  pendingDeviceNotificationIds,
  REENGAGEMENT_NOTIFICATION_ID,
  scheduleDeviceNotificationAt,
  scheduleDeviceNotificationsBatch,
  showDeviceNotification,
  streakReminderIdForDate,
} from "./localNotifications";

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

  // Surface the device notification for this trigger. The inbox row is already
  // written, so a device-side failure still leaves the record, but we never
  // silently discard the device side: each trigger's device notification is
  // attempted once, sharing the day's shade budget (the first trigger to post
  // claims the slot; the rest stay silent). A failure is logged so the athlete
  // can tell something is wrong if a kind that should have reached the shade did
  // not.
  try {
    await postToDeviceForTrigger(userId, { title, body, link: link ?? null });
  } catch (err) {
    console.error("notification trigger device side failed:", err);
  }
  return true;
}

export interface TriggerPrefs {
  workout_reminders?: boolean;
  friend_activity?: boolean;
  streak_alerts?: boolean;
  challenge_deadlines?: boolean;
  reengagement?: boolean;
  low_balance?: boolean;
  recovery_alerts?: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
}

async function prefsFor(userId: string): Promise<TriggerPrefs> {
  const { data } = await supabase
    .from("notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  // Missing row = user never opened settings = everything on (app default).
  // Cast via unknown: the row mixes booleans with quiet_start/end strings.
  return (data as unknown as TriggerPrefs) || {};
}

// ============================================================================
// THE CATALOG — timing constants and copy builders. Pure (no I/O), so they
// are unit-tested in notificationSchedule.test.ts. Wording decisions:
// encouraging, specific (real session names, real numbers), never shaming,
// never a fabricated streak or session.
// ============================================================================

/** Morning briefing posts at 07:10 sharp in the athlete's own clock. */
export const MORNING_HOUR = 7;
export const MORNING_MINUTE = 10;
/**
 * The streak reminder posts at 08:00 — fifty minutes after the briefing, as its
 * own nudge rather than another line in the briefing. The briefing is about
 * today's SESSION; this one is about the recovery check-in that keeps the
 * streak alive, which is a different action on a different screen.
 */
export const STREAK_REMINDER_HOUR = 8;
export const STREAK_REMINDER_MINUTE = 0;
/** How many mornings are pre-scheduled on each app open. */
export const MORNING_SCHEDULE_DAYS = 7;
/** Reengagement ping is armed this far out on every app open. */
export const REENGAGEMENT_DELAY_MS = 72 * 3_600_000;
/** Inactivity before the "we miss you" copy admits it. */
export const REENGAGEMENT_DAYS_AWAY = 3;

const SCHEDULED_MORNINGS_KEY = "vaylo_scheduled_mornings_v1";
const LAST_OPEN_KEY = "vaylo_last_open_v1";
const LAST_MORNING_SCHEDULE_KEY = "vaylo_last_morning_schedule_v1";
const DEVICE_PINGS_KEY = "vaylo_device_pings_v1";

/**
 * Anti-bombardment budget: at most this many device-shade pings per calendar
 * day, across ALL trigger kinds. The in-app inbox row is always written —
 * nothing is ever lost — but the shade stays silent past the budget. Mornings
 * are the day's anchor; everything after them competes for one spare slot.
 */
export const MAX_DEVICE_PINGS_PER_DAY = 2;

function devicePingCountToday(): { date: string; count: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_PINGS_KEY) || "null") as {
      date: string;
      count: number;
    } | null;
    if (raw && raw.date === localDateKey()) return raw;
  } catch { /* corrupt entry — reset below */ }
  return { date: localDateKey(), count: 0 };
}

/** True while the day still has shade budget left (pure read, no side effect). */
export function devicePingBudgetLeft(): boolean {
  return devicePingCountToday().count < MAX_DEVICE_PINGS_PER_DAY;
}

/**
 * Claims one shade slot for today. Returns false (claiming nothing) when the
 * budget is spent. The day's first trigger that wants a shade post claims the
 * slot; the rest stay silent. Mornings and the plan-created moment bypass the
 * budget entirely.
 */
export function claimDevicePingSlot(): boolean {
  const cur = devicePingCountToday();
  if (cur.count >= MAX_DEVICE_PINGS_PER_DAY) return false;
  try {
    localStorage.setItem(DEVICE_PINGS_KEY, JSON.stringify({ date: cur.date, count: cur.count + 1 }));
  } catch { /* private mode — budget unenforceable, allow the ping */ }
  return true;
}

/**
 * Post a device notification for a trigger whose inbox row has already been
 * written. Shares the day's shade budget (claimed once, by the first trigger
 * that posts) and applies quiet hours. The inbox row is always written
 * regardless of the shade outcome — the budget only gates the shade.
 *
 * The single gate for an unprompted shade post during the app-open flow:
 * quiet hours first, then the daily budget. One slot is claimed the first time
 * any trigger in the day wants a shade post (after the morning, which bypasses
 * the budget). The inbox row is always written under its own dedup key
 * regardless of the shade outcome.
 */
export async function postToDeviceForTrigger(
  userId: string,
  notification: { title: string; body: string; link?: string | null },
): Promise<boolean> {
  try {
    const prefs = await prefsFor(userId);
    if (isWithinQuietHours(prefs)) return false;
    if (!claimDevicePingSlot()) return false;
    void showDeviceNotification({ title: notification.title, body: notification.body, link: notification.link ?? null });
    return true;
  } catch {
    return false;
  }
}

export interface PlanSessionLike {
  title?: string;
  type?: string;
  duration_minutes?: number;
  isRest?: boolean;
  skipped?: boolean;
  [key: string]: unknown;
}

export interface PlanWeekLike {
  week: number;
  sessions?: PlanSessionLike[];
  [key: string]: unknown;
}

export type PlanLike = {
  id: string;
  title: string;
  sport?: string;
  week_current: number;
  duration_weeks: number;
  plan_data: unknown;
} | null;

const weeksOf = (plan: PlanLike): PlanWeekLike[] =>
  Array.isArray(plan?.plan_data) ? (plan.plan_data as PlanWeekLike[]) : [];

const actionableSessions = (sessions: PlanSessionLike[] | undefined): PlanSessionLike[] =>
  (sessions ?? []).filter((s) => !s.skipped && !s.isRest);

/**
 * Today's session from the plan's 7-day week template (Monday-first, index 0).
 * Returns null on rest days and when the plan has no week for the date.
 */
export function sessionForDate(plan: PlanLike, date: Date = new Date()): PlanSessionLike | null {
  if (!plan) return null;
  const weeks = weeksOf(plan);
  if (!weeks.length) return null;
  // The plan's current week; dates beyond the plan length clamp to the final
  // week rather than going silent.
  const startWeek = plan.week_current || 1;
  const week = weeks[Math.min(Math.max(0, startWeek - 1), weeks.length - 1)] ?? weeks[0];
  const sessions = week.sessions ?? [];
  if (!sessions.length) return null;
  // Both plan writers emit 7 Monday-first entries with `day` 1-7; match the
  // day number first (robust to ordering), fall back to position.
  const dayNum = ((date.getDay() + 6) % 7) + 1; // JS Sunday=0 -> Monday=1..Sunday=7
  const byDay = sessions.find((s) => (s as { day?: unknown }).day === dayNum);
  const session = byDay ?? sessions[Math.min(dayNum - 1, sessions.length - 1)];
  if (!session || session.skipped || session.isRest) return null;
  return session;
}

/** First non-rest session of week 1 — the "starting with …" line. */
export function firstSessionOfPlan(plan: PlanLike): PlanSessionLike | null {
  const first = weeksOf(plan)[0]?.sessions;
  return actionableSessions(first).find((s) => s.title) ?? actionableSessions(first)[0] ?? null;
}

export function countWeekOneSessions(plan: PlanLike): number {
  return actionableSessions(weeksOf(plan)[0]?.sessions).length;
}

const MOTIVATORS = [
  "Small steps, done daily, win.",
  "Show up — the plan handles the rest.",
  "Future you is watching. Make them proud.",
  "Consistency beats intensity.",
  "One session. That's the whole job today.",
  "Champions are made on ordinary mornings.",
  "You don't have to feel ready. Just start.",
];

export function motivatorForDate(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0).getTime();
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000);
  return MOTIVATORS[dayOfYear % MOTIVATORS.length];
}

/** "07:10" on the given date, in the athlete's own clock. */
export function morningTimeForDate(date: Date): Date {
  const at = new Date(date);
  at.setHours(MORNING_HOUR, MORNING_MINUTE, 0, 0);
  return at;
}

/** The next N dates (starting today) whose 07:10 is still in the future. */
export function nextMorningDates(now: Date = new Date(), days: number = MORNING_SCHEDULE_DAYS): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    if (morningTimeForDate(day).getTime() > now.getTime()) out.push(day);
  }
  return out;
}

const quietMinutes = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  if (h > 23 || mins > 59) return null;
  return h * 60 + mins;
};

const inQuietWindow = (mins: number, quiet: { quiet_start?: string | null; quiet_end?: string | null }): boolean => {
  const s = quietMinutes(quiet.quiet_start);
  const e = quietMinutes(quiet.quiet_end);
  if (s == null || e == null) return false;
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
};

/**
 * Resolve 07:10 (or any hour:min) on a date against quiet hours.
 *
 * Mornings shift to 15 minutes after quiet ends when 07:10 falls inside it
 * (the briefing is the reason to wake, not noise in the night); anything else
 * inside quiet hours returns null (skip the day — silence was requested).
 */
export function resolveScheduledTime(
  date: Date,
  hour: number,
  minute: number,
  quiet: { quiet_start?: string | null; quiet_end?: string | null },
): Date | null {
  const at = new Date(date);
  at.setHours(hour, minute, 0, 0);
  if (!inQuietWindow(hour * 60 + minute, quiet)) return at;
  if (hour !== MORNING_HOUR || minute !== MORNING_MINUTE) return null;
  const end = quietMinutes(quiet.quiet_end);
  if (end == null) return null;
  const shifted = new Date(date);
  shifted.setHours(Math.floor(end / 60), (end % 60) + 15, 0, 0);
  // Past 11:00 it is not a morning briefing any more — skip the day.
  if (shifted.getHours() * 60 + shifted.getMinutes() > 11 * 60) return null;
  return shifted;
}

// -- Copy builders -----------------------------------------------------------

export function planCreatedCopy(plan: PlanLike): { title: string; body: string } {
  const sport = plan?.sport?.trim() ? ` ${plan.sport.trim()}` : "";
  const count = countWeekOneSessions(plan);
  const first = firstSessionOfPlan(plan);
  const sessionsBit = count > 0 ? `Week 1 has ${count} session${count === 1 ? "" : "s"}` : "Week 1 is mapped out";
  const firstBit = first?.title ? `, starting with ${first.title}` : "";
  return {
    title: `Your${sport} plan is ready 🎯`,
    body: `${sessionsBit}${firstBit}. Tap to see today.`,
  };
}

export function morningCopy(
  session: PlanSessionLike | null,
  date: Date = new Date(),
): { title: string; body: string } {
  if (!session) {
    return {
      title: "Recovery day 🌱",
      body: "No session today — sleep, stretch, and let the work sink in. Tomorrow we go again.",
    };
  }
  const mins = typeof session.duration_minutes === "number" && session.duration_minutes > 0
    ? `${session.duration_minutes} min · ` : "";
  const kind = session.type ? `${mins}${session.type}` : mins ? mins.replace(/ · $/, "") : "Today's session";
  return {
    title: `Today: ${session.title ?? "training"} 💪`,
    body: `${kind}. ${motivatorForDate(date)}`,
  };
}

/**
 * Copy for the morning streak reminder (08:00).
 *
 * The streak number is quoted ONLY when the reminder is aimed at today: a
 * reminder scheduled for tomorrow morning is written tonight, and anything the
 * athlete does tonight (one check-in, one missed day) makes a pre-written count
 * wrong by at least one — and a wrong streak number is exactly the kind of
 * claim this app refuses to make. So the tomorrow version sells the ACTION
 * (keep the streak alive), not a number that may no longer exist.
 */
export function streakReminderCopy(streak: number, forToday: boolean): { title: string; body: string } {
  if (forToday && streak > 0) {
    return {
      title: `Your ${streak}-day streak is still alive 🔥`,
      body: "One recovery check-in keeps it running — two minutes now, streak intact.",
    };
  }
  if (forToday) {
    return {
      title: "Start a streak today 🔥",
      body: "One recovery check-in starts the clock — two minutes, and day one is yours.",
    };
  }
  return {
    title: "Keep the streak alive 🔥",
    body: "A recovery check-in first thing keeps your streak running. Two minutes is all it takes.",
  };
}

export function eveningCopy(planTitle: string, week: number, count: number, shortestMin: number | null): { title: string; body: string } {
  const sessionsBit = `${count} session${count === 1 ? "" : "s"}`;
  const shortBit = shortestMin != null && shortestMin > 0 ? ` Even ${shortestMin} minutes counts.` : "";
  return {
    title: "Today's session is still waiting 🌙",
    body: `Week ${week} of ${planTitle} has ${sessionsBit} left today.${shortBit}`,
  };
}

export function streakCopy(streak: number, openCount: number): { title: string; body: string } {
  return {
    title: `${streak}-day streak at risk 🔥`,
    body: `${openCount} action${openCount === 1 ? "" : "s"} still open today — log before midnight to keep it alive.`,
  };
}

export function challengeCopy(title: string, daysLeft: number, pct: number): { title: string; body: string } {
  const quoted = '"' + title + '"';
  const head = daysLeft <= 0
    ? quoted + " ends today"
    : daysLeft === 1
      ? quoted + " ends tomorrow"
      : quoted + " ends in " + daysLeft + " days";
  const tail = pct >= 100 ? "" : pct > 0 ? pct + "% complete — finish strong." : "You haven't logged progress yet — still time.";
  return { title: head, body: tail || "Tap to log your final effort." };
}

export function reengagementCopy(daysAway: number): { title: string; body: string } {
  return {
    title: "We miss you 👋",
    body: daysAway <= 3
      ? "3 days since your last session. Your plan kept your place — pick up where you left off."
      : `${daysAway} days away. Your plan kept your place — one short session is all it takes to restart.`,
  };
}

/** Warned at this balance or below (and never for unlimited accounts). */
export const LOW_BALANCE_THRESHOLD = 15;
/** A low-balance warning repeats at most this often — money talk fatigues fast. */
export const LOW_BALANCE_REPEAT_DAYS = 3;
/** Readiness at or below this counts as a genuinely bad recovery day. */
export const POOR_READINESS_THRESHOLD = 35;

export function lowBalanceCopy(balance: number): { title: string; body: string } {
  // Calm and concrete, never urgent: the notification is a heads-up, not a
  // timer. Saying what the balance still *does* (reviews, check-ins) is what
  // keeps the line useful for the athlete who can't or won't pay yet.
  return {
    title: "Getting low on credits",
    body: balance <= 0
      ? "You're out of credits for now. Top up in the Market when you're ready — your plan and data keep running while you wait."
      : `You have ${balance} credit${balance === 1 ? "" : "s"} left — quick check-ins and reviews still fit. Top up in the Market before the moment you'll want more.`,
  };
}

export function poorRecoveryCopy(readiness: number): { title: string; body: string } {
  return {
    title: "Your body is asking for easy today 🌧️",
    body: `Readiness ${readiness} — take the gentle option, sleep well tonight, and come back stronger tomorrow.`,
  };
}

export function streakFinalCopy(streak: number): { title: string; body: string } {
  return {
    title: `One left, then day ${streak + 1} 🔥`,
    body: "A single action stands between you and another day on the streak. Log it before midnight.",
  };
}

// -- Local bookkeeping (this device only) ------------------------------------

export function getScheduledMornings(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SCHEDULED_MORNINGS_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function setScheduledMornings(days: string[]): void {
  try {
    localStorage.setItem(SCHEDULED_MORNINGS_KEY, JSON.stringify(days));
  } catch { /* private mode — scheduling degrades, nothing breaks */ }
}

export function getLastOpen(): string | null {
  try {
    return localStorage.getItem(LAST_OPEN_KEY);
  } catch {
    return null;
  }
}

export function markAppOpen(now: Date = new Date()): { previous: string | null; daysAway: number | null } {
  const previous = getLastOpen();
  try {
    localStorage.setItem(LAST_OPEN_KEY, now.toISOString());
  } catch { /* private mode */ }
  if (!previous) return { previous: null, daysAway: null };
  const days = daysBetween(previous.slice(0, 10), localDateKey(now));
  return { previous, daysAway: days };
}

export function lastMorningScheduleKey(): string | null {
  try {
    return localStorage.getItem(LAST_MORNING_SCHEDULE_KEY);
  } catch {
    return null;
  }
}

export function markMorningScheduleDone(key: string): void {
  try {
    localStorage.setItem(LAST_MORNING_SCHEDULE_KEY, key);
  } catch { /* private mode */ }
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
    const openCount = active.filter((a) => idx.get(`${a.id}|${today}`) !== true).length || active.length;
    const copy = streakCopy(streak, openCount);
    await insertOncePerDay(userId, "streak", "streak_alert", copy.title, copy.body, "/goals");
  }
}

/**
 * Streak final push: everything done yesterday and exactly ONE action left
 * today. Distinct from the at-risk alert (which covers any number open) —
 * this is the "you're one rep from history" moment, and it fires at most
 * once a day under its own key so the two never stack into nagging.
 */
export async function checkStreakFinalPush(
  userId: string,
  actions: { id: string; active: boolean }[],
  logs: { action_id: string; log_date: string; completed: boolean }[],
  streak: number,
  now: Date = new Date(),
): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.streak_alerts === false) return;
  const active = actions.filter((a) => a.active);
  if (!active.length || streak <= 0) return;
  const today = localDateKey(now);
  const yest = localDateKey(new Date(now.getTime() - 86400000));
  const idx = new Map<string, boolean>();
  for (const l of logs) if (l.completed) idx.set(`${l.action_id}|${l.log_date}`, true);
  const allDoneYesterday = active.every((a) => idx.get(`${a.id}|${yest}`) === true);
  if (!allDoneYesterday) return;
  const openCount = active.filter((a) => idx.get(`${a.id}|${today}`) !== true).length;
  if (openCount !== 1) return;
  const copy = streakFinalCopy(streak);
  await insertOncePerDay(userId, "streak-final", "streak_final", copy.title, copy.body, "/goals");
}

/**
 * Low-credit warning: balance at or below threshold, unlimited accounts
 * excluded (nothing to warn about). Repeats at most every 3 days — money
 * talk fatigues fast, and the inbox row is always there as the record.
 */
export async function checkLowBalance(
  userId: string,
  balance: number | null,
  unlimited: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (unlimited) return;
  if (balance == null || !Number.isFinite(balance) || balance > LOW_BALANCE_THRESHOLD) return;
  const prefs = await prefsFor(userId);
  if (prefs.low_balance === false) return;
  const cutoff = new Date(now.getTime() - LOW_BALANCE_REPEAT_DAYS * 86400000).toISOString();
  const { data: recent } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .like("link", "vaylo:lowcredits:%")
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  if (recent) return;
  const today = localDateKey(now);
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type: "low_balance",
    title: lowBalanceCopy(Math.max(0, Math.floor(balance))).title,
    body: lowBalanceCopy(Math.max(0, Math.floor(balance))).body,
    link: `vaylo:lowcredits:${today}`,
  });
  if (error) {
    console.error("notification trigger failed:", error.message);
    return;
  }
  void postToDeviceForTrigger(userId, { ...lowBalanceCopy(Math.max(0, Math.floor(balance))), link: "/market" }).catch(() => {});
}

/**
 * Poor-recovery note: today's check-in scored at or below the bad-day line.
 * Gentle by design — it suggests the easy option, never scolds, and fires at
 * most once a day. Self-querying so AppLayout needs no new plumbing.
 */
export async function checkPoorRecovery(userId: string, now: Date = new Date()): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.recovery_alerts === false) return;
  const today = localDateKey(now);
  const { data } = await supabase
    .from("recovery_logs")
    .select("readiness_score")
    .eq("user_id", userId)
    .eq("log_date", today)
    .maybeSingle();
  const readiness = (data as { readiness_score?: unknown } | null)?.readiness_score;
  if (typeof readiness !== "number" || readiness > POOR_READINESS_THRESHOLD) return;
  const copy = poorRecoveryCopy(Math.round(readiness));
  await insertOncePerDay(userId, "recovery", "poor_recovery", copy.title, copy.body, "/recovery");
}

/**
 * Evening nudge (~18:00, app-open check): today's session still untouched.
 *
 * Rest days stay silent — a recovery day with a "you skipped training"
 * notification is how an app teaches its athletes to ignore it.
 */
export async function checkWorkoutReminder(userId: string, plan: PlanLike, now: Date = new Date()): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.workout_reminders === false) return;
  if (!plan) return;
  if (now.getHours() < 17) return;
  const session = sessionForDate(plan, now);
  if (!session) return; // rest day — nothing to remind about
  const week = weeksOf(plan).find((w) => w.week === plan.week_current);
  const actionable = actionableSessions(week?.sessions);
  if (!actionable.length) return;
  const durations = actionable
    .map((s) => s.duration_minutes)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const shortest = durations.length ? Math.min(...durations) : null;
  const copy = eveningCopy(plan.title, plan.week_current, actionable.length, shortest);
  await insertOncePerDay(
    userId,
    "workout",
    "workout_reminder",
    copy.title,
    copy.body,
    // Deep-linked to the plan, not to /workouts. The workout log screen was
    // removed; the plan is where those sessions are still listed and can be
    // ticked off, so "left to log" also went — there is nothing to log.
    "/training",
  );
}

/**
 * Challenge deadlines: 3 days out, 1 day out, ends today — and only while the
 * athlete is behind. Each bucket has its own dedup key so all three can fire
 * across the final stretch, but each fires at most once per day.
 */
export async function checkChallengeDeadlines(
  userId: string,
  challenges: { id: string; title: string; end_date: string; target_value: number }[],
  participants: { challenge_id: string; progress: number; status: string }[],
  now: Date = new Date(),
): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.challenge_deadlines === false) return;
  const today = localDateKey(now);
  for (const c of challenges) {
    const p = participants.find((x) => x.challenge_id === c.id);
    if (!p || p.status !== "active") continue;
    const daysLeft = daysBetween(today, localDateKey(new Date(c.end_date)));
    if (daysLeft == null || ![3, 1, 0].includes(daysLeft)) continue;
    const pct = c.target_value > 0 ? Math.round((p.progress / c.target_value) * 100) : 0;
    if (pct >= 100) continue;
    const copy = challengeCopy(c.title, daysLeft, pct);
    await insertOncePerDay(userId, `chal-${c.id}-${daysLeft}d`, "challenge_deadline", copy.title, copy.body, "/challenges");
  }
}

/**
 * Plan-created celebration: inbox row (once per plan) + immediate device ping
 * + arming the next 7 morning briefings, which are personalised from the new
 * plan's own week template.
 *
 * Gated on workout_reminders: the plan is what those reminders are about, and
 * a separate toggle for a once-per-plan moment would be clutter.
 */
export async function notifyPlanCreated(userId: string, plan: Exclude<PlanLike, null>): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.workout_reminders === false) return;
  const copy = planCreatedCopy(plan);
  const dedupKey = `vaylo:plan-created:${plan.id}`;
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("link", dedupKey)
    .maybeSingle();
  if (!existing) {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type: "plan_created",
      title: copy.title,
      body: copy.body,
      link: dedupKey,
    });
    if (error) {
      console.error("notification trigger failed:", error.message);
      throw new Error(`plan-created inbox insert failed: ${error.message}`);
    }
  }
  // The plan moment is important enough to jump the budget queue and to bypass
  // quiet hours in the same way the morning does (the morning is the day's
  // anchor; the plan moment is the once-per-plan anchor). We still re-read prefs
  // here rather than reusing the top-of-function prefs, because the device path
  // wants the latest quiet-hours setting even if the inbox path already ran.
  const prefs2 = await prefsFor(userId);
  if (!isWithinQuietHours({ quiet_start: prefs2.quiet_start ?? null, quiet_end: prefs2.quiet_end ?? null })) {
    await showDeviceNotification({ title: copy.title, body: copy.body, link: "/training" }).catch(() => {});
  }
  await scheduleMorningReminders(plan, prefs).catch(() => {});
}

/**
 * Morning briefing (app-open half): personalised to today's session, inbox +
 * device. Runs when the app opens before noon.
 *
 * One device ping per morning: if a pre-scheduled briefing for today already
 * fired (today was scheduled, but is no longer pending), the inbox row is
 * still written but the device stays silent — the athlete already got theirs.
 */
export async function checkMorningBriefing(userId: string, plan: PlanLike, now: Date = new Date()): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.workout_reminders === false) return;
  if (now.getHours() >= 12) return;
  const session = sessionForDate(plan, now);
  const copy = morningCopy(session, now);
  const today = localDateKey(now);
  const dedupKey = `vaylo:morning:${today}`;
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("link", dedupKey)
    .maybeSingle();
  if (existing) return;
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type: "morning_briefing",
    title: copy.title,
    body: copy.body,
    link: dedupKey,
  });
  if (error) {
    console.error("notification trigger failed:", error.message);
    return;
  }
  // The morning is the day's anchor: it bypasses the shade budget (which
  // exists to ration everything AFTER the morning) but never double-pings —
  // if the pre-scheduled 07:10 already fired, the inbox row stands alone.
  try {
    if (isWithinQuietHours({ quiet_start: prefs.quiet_start ?? null, quiet_end: prefs.quiet_end ?? null })) return;
    const scheduled = getScheduledMornings();
    const pending = await pendingDeviceNotificationIds();
    const firedAlready = scheduled.includes(today) && !pending.has(morningIdForDate(now));
    if (firedAlready) return; // 07:10 already pinged — inbox only, no double
    await cancelDeviceNotifications([morningIdForDate(now)]).catch(() => {});
    await showDeviceNotification({ title: copy.title, body: copy.body, link: "/training" }).catch(() => {});
  } catch { /* inbox row is already written */ }
}

/**
 * Pre-schedule the next 7 morning briefings on the device, personalised per
 * day from the plan's week template. The OS owns these timers afterwards, so
 * they fire with the app closed — the only notifications in this file that do.
 *
 * Throttled to once per day per plan (localStorage): re-scheduling rewrites
 * the same stable ids, so a second call the same day is harmless but wasteful.
 * Days falling in quiet hours shift past quiet end (mornings) or are skipped.
 * No active plan, or reminders off → previously scheduled mornings are
 * cancelled rather than left to lie about sessions that no longer exist.
 */
export async function scheduleMorningReminders(
  plan: PlanLike,
  prefs: TriggerPrefs,
  now: Date = new Date(),
  /**
   * Ignore the once-a-day throttle. The settings screen passes true: a toggle
   * the athlete just flipped has to take effect now, not at the next app open.
   */
  force = false,
): Promise<number> {
  if (prefs.workout_reminders === false || !plan) {
    const stale = getScheduledMornings();
    if (stale.length) {
      await cancelDeviceNotifications(stale.map((day) => {
        const [y, m, d] = day.split("-").map(Number);
        return morningIdForDate(new Date(y, (m || 1) - 1, d || 1));
      })).catch(() => {});
      setScheduledMornings([]);
    }
    return 0;
  }
  const throttleKey = `${localDateKey(now)}:${plan.id}`;
  if (!force && lastMorningScheduleKey() === throttleKey) return getScheduledMornings().length;
  let scheduled = 0;
  const days: string[] = [];
  // All seven days are computed first, then scheduled in ONE plugin call:
  // the loop shape previously issued a round trip per day on every throttle
  // window, which on a slow open cost seven sequential plugin awaits. Batch
  // scheduling keeps the ids per-day through morningIdForDate, so a cancelled
  // week clears exactly what was armed.
  const jobs: { at: Date; id: number; day: Date }[] = [];
  for (const day of nextMorningDates(now)) {
    const at = resolveScheduledTime(day, MORNING_HOUR, MORNING_MINUTE, prefs);
    if (!at) continue;
    jobs.push({ at, id: morningIdForDate(day), day });
  }
  if (jobs.length > 0) {
    await scheduleDeviceNotificationsBatch(
      jobs.map((j) => ({
        title: morningCopy(sessionForDate(plan, j.day), j.day).title,
        body: morningCopy(sessionForDate(plan, j.day), j.day).body,
        link: "/training",
        at: j.at,
        id: j.id,
      })),
    );
    scheduled = jobs.length;
    days.push(...jobs.map((j) => localDateKey(j.day)));
  }
  setScheduledMornings(days);
  try {
    localStorage.setItem(LAST_MORNING_SCHEDULE_KEY, throttleKey);
  } catch { /* private mode */ }
  return scheduled;
}

/**
 * Arm the next morning's streak reminder on the device (08:00, own id per day).
 *
 * Why pre-scheduled and not app-open: a reminder that only exists while the app
 * is open cannot reach the athlete who did not open it — which is precisely the
 * person whose streak is about to break. The OS owns the timer from here, so it
 * fires with the app closed, the same mechanism as the 07:10 briefing.
 *
 * Re-armed on every app open with the freshest streak, and always aimed at the
 * NEXT morning only (today if 08:00 is still ahead and no check-in has
 * happened, else tomorrow). Already checked in today → tomorrow's copy, which
 * is deliberately number-free. Recovery toggle off → cancelled, never left
 * lying. Quiet hours are respected by SKIPPING, not shifting: this is a nudge,
 * not the day's anchor briefing, and a shifted nudge is a second ping in the
 * afternoon.
 *
 * Returns 1 when a reminder was armed, 0 otherwise (quiet hours, toggle off,
 * unsupported device, plugin failure) — the caller logs nothing either way.
 */
/**
 * WHEN the next streak reminder should fire — pure, so the decision the
 * scheduler acts on is unit-testable rather than buried in plugin I/O.
 *
 * Today if 08:00 is still ahead and no check-in has happened yet (the number
 * in that copy is true as of now); otherwise tomorrow. Quiet hours return
 * null: the slot is SKIPPED, never shifted — this is a nudge, not the day's
 * anchor briefing, and a shifted nudge is a second ping in the afternoon.
 */
export function nextStreakReminderOccurrence(
  now: Date,
  checkedInToday: boolean,
  prefs: TriggerPrefs,
): { day: Date; at: Date; forToday: boolean } | null {
  const todayAt = resolveScheduledTime(now, STREAK_REMINDER_HOUR, STREAK_REMINDER_MINUTE, prefs);
  if (!checkedInToday && todayAt !== null && todayAt.getTime() > now.getTime()) {
    return { day: now, at: todayAt, forToday: true };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const at = resolveScheduledTime(tomorrow, STREAK_REMINDER_HOUR, STREAK_REMINDER_MINUTE, prefs);
  // Quiet hours swallow the slot rather than moving it (see module header).
  return at ? { day: tomorrow, at, forToday: false } : null;
}

export async function scheduleStreakReminder(
  streak: number,
  checkedInToday: boolean,
  prefs: TriggerPrefs,
  now: Date = new Date(),
): Promise<number> {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const bothIds = [streakReminderIdForDate(now), streakReminderIdForDate(tomorrow)];

  if (prefs.recovery_alerts === false) {
    await cancelDeviceNotifications(bothIds).catch(() => {});
    return 0;
  }

  const occurrence = nextStreakReminderOccurrence(now, checkedInToday, prefs);
  if (!occurrence) {
    await cancelDeviceNotifications(bothIds).catch(() => {});
    return 0;
  }

  const copy = streakReminderCopy(streak, occurrence.forToday);
  // Same-id reschedule overwrites, but clear the OTHER day's id first so a
  // stale copy from yesterday's arm can never fire alongside tomorrow's.
  await cancelDeviceNotifications(bothIds).catch(() => {});
  const outcome = await scheduleDeviceNotificationAt({
    title: copy.title,
    body: copy.body,
    link: "/recovery",
    at: occurrence.at,
    id: streakReminderIdForDate(occurrence.day),
  }).catch(() => "failed" as const);
  return outcome === "shown" ? 1 : 0;
}

/**
 * Reengagement: armed 72h out on every app open, so it can only ever fire
 * after 3 days away. Opening the app re-arms (cancels + reschedules) it.
 */
export async function scheduleReengagementPing(userId: string, daysAway: number | null, now: Date = new Date()): Promise<void> {
  const prefs = await prefsFor(userId);
  if (prefs.reengagement === false) {
    await cancelDeviceNotifications([REENGAGEMENT_NOTIFICATION_ID]).catch(() => {});
    return;
  }
  const at = new Date(now.getTime() + REENGAGEMENT_DELAY_MS);
  const resolved = resolveScheduledTime(at, at.getHours(), at.getMinutes(), prefs);
  if (!resolved) {
    await cancelDeviceNotifications([REENGAGEMENT_NOTIFICATION_ID]).catch(() => {});
    return;
  }
  const away = daysAway ?? REENGAGEMENT_DAYS_AWAY;
  const copy = reengagementCopy(Math.max(away, REENGAGEMENT_DAYS_AWAY));
  await cancelDeviceNotifications([REENGAGEMENT_NOTIFICATION_ID]).catch(() => {});
  await scheduleDeviceNotificationAt({
    title: copy.title,
    body: copy.body,
    link: "/",
    at: resolved,
    id: REENGAGEMENT_NOTIFICATION_ID,
  }).catch(() => {});
}

/**
 * Reengagement (app-open half): the returning athlete gets the in-app note.
 * Fires once per day after 3+ days away.
 */
export async function checkReengagement(userId: string, daysAway: number | null): Promise<void> {
  if (daysAway == null || daysAway < REENGAGEMENT_DAYS_AWAY) return;
  const prefs = await prefsFor(userId);
  if (prefs.reengagement === false) return;
  const copy = reengagementCopy(daysAway);
  await insertOncePerDay(userId, "reengagement", "reengagement", copy.title, copy.body, "/");
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
