// ============================================================================
// USE ACHIEVEMENT STATS — the counters behind every achievement rule
// ----------------------------------------------------------------------------
// Moved out of the Achievements page when the Trophy Room stopped being one
// screen. Achievements and Badges are separate screens now, but they read the
// same numbers and, crucially, they both AWARD: a badge the athlete has just
// earned by buying something must be written the first time they open Badges,
// and an achievement must be written when they open Achievements. Two copies of
// this would be two places that could disagree about what has been earned, so
// there is one.
//
// The write is an insert per newly earned rule, and `23505` (the unique
// `(user_id, type, title)` index) is treated as already-earned rather than as a
// failure: two open tabs can award the same medal in the same second.
// ============================================================================

import { useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  builtInAchievements,
  emptyStats,
  type Achievement,
  type AchievementStats,
} from "@/lib/achievements";

export function useAchievementStats() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [earnedAchievements, setEarnedAchievements] = useState<Achievement[]>([]);
  const [stats, setStats] = useState<AchievementStats>(emptyStats);

  useEffect(() => { if (user) void fetchAll(); }, [user]);

  const fetchAll = async () => {
    if (!user) return;
    const [achRes, chRes, purchRes, workRes, recRes, eventRes, rivalRes, planRes, friendRes, mealRes, waterRes, coachRes, mentalRes, cueRes, reviewRes, hrvRes, streakRes, nutRes, partRes] = await Promise.all([
      supabase.from("achievements").select("*").eq("user_id", user.id),
      supabase.from("challenges").select("*").order("created_at", { ascending: false }),
      supabase.from("user_purchases").select("product_id").eq("user_id", user.id),
      supabase.from("workouts").select("id", { count: "exact" }).eq("user_id", user.id).eq("completed", true),
      supabase.from("recovery_logs").select("id, readiness_score", { count: "exact" }).eq("user_id", user.id),
      supabase.from("events").select("id, actual_position", { count: "exact" }).eq("user_id", user.id),
      supabase.from("event_rivals").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("training_plans").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("friendships").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("meal_logs").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("water_logs").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("coach_messages").select("id", { count: "exact" }).eq("user_id", user.id).eq("role", "user"),
      supabase.from("mental_checkins").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("cue_words").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("mental_reviews").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("recovery_logs").select("id", { count: "exact" }).eq("user_id", user.id).not("hrv", "is", null),
      // The streak counters behind the streak achievements come from the
      // server's own streaks table (cached run recomputed at each claim) —
      // never from a client-side guess. Without this the streak medals could
      // never fire: the old code passed a hardcoded 0.
      supabase.from("streaks" as never).select("current_streak").eq("user_id", user.id).maybeSingle() as never,
      // Two counters the catalogue reads but never loaded, so the rules that
      // depend on them ("Diet Planner", "Challenger", "Two Challenges"…) could
      // never fire — a trophy on a rule nobody can complete. Both are plain
      // counts of the athlete's own rows.
      supabase.from("nutrition_plans").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("challenge_participants").select("id", { count: "exact" }).eq("user_id", user.id).eq("status", "completed"),
    ]);

    setEarnedAchievements(achRes.data || []);
    const pIds = (purchRes.data || []).map(p => p.product_id);

    const greenDays = (recRes.data || []).filter((r) => r.readiness_score != null && r.readiness_score >= 85).length;
    const events = eventRes.data || [];
    const results = events.filter((e) => e.actual_position != null);
    const firstPlace = results.filter((e) => e.actual_position === 1).length;
    const podium = results.filter((e) => e.actual_position != null && e.actual_position <= 3).length;

    const createdChallenges = (chRes.data || []).filter((c) => c.creator_id === user.id).length;
    const baseStats: AchievementStats = {
      workouts: workRes.count || 0,
      checkins: recRes.count || 0,
      greenDays,
      events: eventRes.count || 0,
      rivals: rivalRes.count || 0,
      plans: planRes.count || 0,
      friends: friendRes.count || 0,
      meals: mealRes.count || 0,
      water: waterRes.count || 0,
      coachMsgs: coachRes.count || 0,
      mentalCheckins: mentalRes.count || 0,
      cueWords: cueRes.count || 0,
      reviews: reviewRes.count || 0,
      hrvLogs: hrvRes.count || 0,
      purchases: pIds,
      results: results.length,
      firstPlace,
      podium,
      rivalBeats: 0,
      nutritionPlans: nutRes.count || 0,
      completedChallenges: partRes.count || 0,
      createdChallenges,
      // Server streak: qualifying days (training, recovery, learning, weekly
      // goal, scheduled rest) computed by the backend; 0 when no streak row.
      streak: ((streakRes as { data: { current_streak: number } | null }).data?.current_streak) ?? 0,
    };

    setStats(baseStats);

    // Auto-award new achievements
    const earnedIds = new Set((achRes.data || []).map((a) => a.type));
    const statsData = baseStats;

    for (const ach of builtInAchievements) {
      if (!earnedIds.has(ach.id) && ach.check(statsData)) {
        const { error } = await supabase.from("achievements").insert({
          user_id: user.id, title: ach.title, description: ach.desc, type: ach.id, icon: ach.icon,
        });
        // 23505 = already earned (raced by another tab); anything else is a real failure.
        if (error && error.code !== "23505") {
          toast({ title: "Couldn't save an achievement", description: error.message, variant: "destructive" });
          break;
        }
      }
    }
    // Re-fetch achievements after awarding
    const { data: refreshed } = await supabase.from("achievements").select("*").eq("user_id", user.id).order("earned_at", { ascending: false });
    setEarnedAchievements(refreshed || []);
  };

  return {
    stats,
    earnedAchievements,
    /** The ids already earned — what both shelves mark as earned. */
    earnedIds: new Set(earnedAchievements.map(a => a.type)),
  };
}
