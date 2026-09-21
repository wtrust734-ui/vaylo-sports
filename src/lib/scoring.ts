// Vaylo Sports scoring engine
// Client-side mirror of the DB-side scoring so previews & analytics stay in sync.
import { supabase } from "@/integrations/supabase/client";

export interface ScoringInputs {
  durationMinutes?: number;
  distanceKm?: number;
  rpe?: number;           // 1-10
  heartRateAvg?: number;  // bpm
  consistencyDays?: number; // active days in period
}

// Volume + intensity + consistency + base
export function computeActivityPoints(i: ScoringInputs): number {
  const dur = i.durationMinutes ?? 0;
  const dist = i.distanceKm ?? 0;
  const intensity = i.rpe ? i.rpe * 10 : (i.heartRateAvg ?? 0);
  const consistency = (i.consistencyDays ?? 0) * 5;
  const raw = 20 + dur * 2 + Math.round(dist * 5) + Math.round(intensity / 10) + consistency;
  return Math.min(500, Math.max(0, raw));
}

export type LeaderboardPeriod = "week" | "month" | "all";

function periodStart(p: LeaderboardPeriod): Date | null {
  const now = new Date();
  if (p === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
  if (p === "month") { const d = new Date(now); d.setDate(d.getDate() - 30); return d; }
  return null;
}

export interface LeaderboardRow {
  user_id: string;
  points: number;
  sport?: string | null;
  rank: number;
}

export async function fetchLeaderboard(opts: { period: LeaderboardPeriod; sport?: string | null; limit?: number }): Promise<LeaderboardRow[]> {
  const client = supabase as any;
  let q = client.from("points_events").select("user_id,points,sport,occurred_at");
  const start = periodStart(opts.period);
  if (start) q = q.gte("occurred_at", start.toISOString());
  if (opts.sport && opts.sport !== "all") q = q.eq("sport", opts.sport);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  const totals: Record<string, { pts: number; sport?: string | null }> = {};
  (data || []).forEach((r: any) => {
    if (!totals[r.user_id]) totals[r.user_id] = { pts: 0, sport: r.sport };
    totals[r.user_id].pts += r.points || 0;
  });
  const sorted = Object.entries(totals)
    .map(([user_id, v]) => ({ user_id, points: v.pts, sport: v.sport }))
    .sort((a, b) => b.points - a.points)
    .slice(0, opts.limit ?? 100)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return sorted;
}

// These return the Supabase result (so callers keep working) but never fail
// silently — every RPC error is logged, and surfaced to any caller that checks.
export async function awardPoints(points: number, source: string, sport?: string | null) {
  const client = supabase as any;
  const res = await client.rpc("award_points", { p_points: points, p_source: source, p_sport: sport ?? null });
  if (res?.error) console.error("awardPoints failed:", res.error.message);
  return res;
}

// Challenge helpers
export async function joinChallenge(id: string) {
  const res = await (supabase as any).rpc("join_challenge", { p_challenge: id });
  if (res?.error) console.error("joinChallenge failed:", res.error.message);
  return res;
}
export async function leaveChallenge(id: string) {
  const res = await (supabase as any).rpc("leave_challenge", { p_challenge: id });
  if (res?.error) console.error("leaveChallenge failed:", res.error.message);
  return res;
}
export async function updateChallengeProgress(id: string, delta: number) {
  const res = await (supabase as any).rpc("update_challenge_progress", { p_challenge: id, p_delta: delta });
  if (res?.error) console.error("updateChallengeProgress failed:", res.error.message);
  return res;
}

// Achievement auto-award helper (streaks / distance milestones)
export async function checkAndAwardMilestones(userId: string) {
  const client = supabase as any;
  const { data: existing } = await client.from("achievements").select("title").eq("user_id", userId);
  const owned = new Set((existing || []).map((e: any) => e.title));
  const { data: pts } = await client.from("points_events").select("points").eq("user_id", userId);
  const total = (pts || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
  const tiers: [number, string, string][] = [
    [500, "Rising Star", "Earned 500 points"],
    [2500, "Contender", "Earned 2,500 points"],
    [10000, "Elite Athlete", "Earned 10,000 points"],
    [50000, "Legend", "Earned 50,000 points"],
  ];
  for (const [t, title, desc] of tiers) {
    if (total >= t && !owned.has(title)) {
      const { error } = await client.from("achievements").insert({ user_id: userId, type: "points", title, description: desc, icon: "star" });
      // 23505 = awarded by another tab in the meantime.
      if (error && error.code !== "23505") console.error("milestone award failed:", error.message);
    }
  }
}
