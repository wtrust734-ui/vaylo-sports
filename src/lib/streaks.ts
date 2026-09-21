import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "@/lib/dates";

export interface StreakState {
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  freezes_available: number;
}

export async function touchStreak(): Promise<{ current: number; longest: number } | null> {
  // Send the athlete's local day: the server clamps it to ±1 day of its own
  // date, so streaks stay correct across timezones without being gameable.
  const { data, error } = await (supabase as any).rpc("touch_streak", { p_date: localDateKey() });
  if (error) { console.warn("touch_streak", error); return null; }
  return data as { current: number; longest: number };
}

export async function getStreak(userId: string): Promise<StreakState | null> {
  const { data } = await (supabase as any).from("streaks").select("*").eq("user_id", userId).maybeSingle();
  return data as StreakState | null;
}
