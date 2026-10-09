import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "./dates";

export type OutcomeGoal = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  metric_unit: string | null;
  start_value: number | null;
  current_value: number | null;
  target_value: number | null;
  deadline: string | null;
  status: string;
};

export type ProcessGoal = {
  id: string;
  outcome_goal_id: string | null;
  title: string;
  description: string | null;
  weekly_target: number;
  active: boolean;
};

export type DailyAction = {
  id: string;
  process_goal_id: string | null;
  title: string;
  active: boolean;
};

export type ActionLog = {
  id: string;
  action_id: string;
  log_date: string;
  completed: boolean;
};

/**
 * Preindexed log lookup: `"actionId|date" -> completed`. Builds once per
 * render pass instead of scanning the full log array for every action×day
 * pair (the old `logs.some(...)` was O(days × actions × logs)).
 */
export const buildLogIndex = (logs: ActionLog[]): Map<string, boolean> => {
  const idx = new Map<string, boolean>();
  for (const l of logs) {
    if (!l.completed) continue;
    idx.set(`${l.action_id}|${l.log_date}`, true);
  }
  return idx;
};

const doneOn = (idx: Map<string, boolean>, actionId: string, dateKey: string): boolean =>
  idx.get(`${actionId}|${dateKey}`) === true;

export const startOfWeek = (d = new Date()) => {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const isoDate = (d: Date) => localDateKey(d);

export const outcomeProgress = (g: OutcomeGoal): number => {
  const start = Number(g.start_value ?? 0);
  const cur = Number(g.current_value ?? 0);
  const target = Number(g.target_value ?? 0);
  if (!target || target === start) return 0;
  const pct = ((cur - start) / (target - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

/**
 * Required weekly rate to hit the target by the deadline.
 * Formula: (target − current) / max(1, daysLeft) × 7.
 * A passed deadline shows "—" (the old code showed a nonsense negative rate);
 * units come from metric_unit; dates are local calendar days.
 */
export const requiredRate = (g: OutcomeGoal): string => {
  if (!g.deadline || !g.target_value) return "—";
  const remaining = Number(g.target_value) - Number(g.current_value ?? 0);
  const daysLeft = Math.ceil(
    (new Date(`${g.deadline}T23:59:59`).getTime() - Date.now()) / 86400000,
  );
  if (daysLeft <= 0 || remaining <= 0) return "—";
  const perWeek = (remaining / Math.max(1, daysLeft)) * 7;
  return `${perWeek.toFixed(2)} ${g.metric_unit ?? ""}/wk`;
};

/**
 * Reliability — PRODUCT-DEFINED consistency score (not a validated measure).
 * Formula: Σ over the last `days` local calendar days of weight_i, where
 * weight_i = 1 + (days − i)/days (today weighs ~2×, `days` ago weighs 1×),
 * summed across every ACTIVE action; reliability = 100 × done/total.
 * Missing logs count as not done — an inactive action counts as neither.
 */
export const reliabilityScore = (
  actions: DailyAction[],
  logs: ActionLog[],
  days = 30,
): number => {
  if (!actions.length) return 0;
  const idx = buildLogIndex(logs);
  const today = new Date();
  let weightedDone = 0;
  let weightedTotal = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = isoDate(d);
    const w = 1 + (days - i) / days; // recent days weigh more
    for (const a of actions) {
      if (!a.active) continue;
      weightedTotal += w;
      if (doneOn(idx, a.id, key)) weightedDone += w;
    }
  }
  if (!weightedTotal) return 0;
  return Math.round((weightedDone / weightedTotal) * 100);
};

export const currentStreak = (actions: DailyAction[], logs: ActionLog[]): number => {
  const activeActions = actions.filter((a) => a.active);
  if (!activeActions.length) return 0;
  const idx = buildLogIndex(logs);
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = isoDate(d);
    const allDone = activeActions.every((a) => doneOn(idx, a.id, key));
    if (allDone) streak++;
    else break;
  }
  return streak;
};

export const weeklyCompletionForProcess = (
  pg: ProcessGoal,
  actions: DailyAction[],
  logs: ActionLog[],
): { done: number; target: number; pct: number } => {
  const wkStart = startOfWeek();
  const wkActions = actions.filter((a) => a.process_goal_id === pg.id);
  const ids = new Set(wkActions.map((a) => a.id));
  const idx = buildLogIndex(logs);
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart);
    d.setDate(wkStart.getDate() + i);
    const key = isoDate(d);
    for (const id of ids) {
      if (doneOn(idx, id, key)) { done++; break; }
    }
  }
  const target = pg.weekly_target;
  return { done, target, pct: Math.min(100, Math.round((done / Math.max(1, target)) * 100)) };
};

export const todayCompletionMap = (
  actions: DailyAction[],
  logs: ActionLog[],
): Record<string, boolean> => {
  const key = isoDate(new Date());
  const idx = buildLogIndex(logs);
  const map: Record<string, boolean> = {};
  for (const a of actions) {
    map[a.id] = doneOn(idx, a.id, key);
  }
  return map;
};

export async function toggleAction(actionId: string, userId: string, completed: boolean) {
  const today = isoDate(new Date());
  const result = completed
    ? await supabase
        .from("daily_action_logs")
        .upsert(
          { action_id: actionId, user_id: userId, log_date: today, completed: true },
          { onConflict: "action_id,log_date" },
        )
    : await supabase
        .from("daily_action_logs")
        .delete()
        .eq("action_id", actionId)
        .eq("log_date", today);

  // Surface failures to the caller instead of reporting a silent success.
  if (result.error) throw result.error;
  return result;
}
