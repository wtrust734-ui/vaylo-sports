// ============================================================================
// WORKOUT REVIEW — one button, one credit, one answer
// ----------------------------------------------------------------------------
// "Analyse my workouts" bundles the athlete's recent log, their current plan
// week, and the explicit comparison question into the existing
// stats_insight AI call. Stats insight was chosen because it is the small,
// repeatable AI reading (8 credits) that already clears its provider-cost
// floor on its own — it is not a wide coach or a heavy model call.
//
// Server side the call is trivial: the digest is already the whole prompt, so
// this just proves the right type reaches ai-analyze and the route handles
// the 402 the same way every other metered feature does.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { getAiLocale } from "@/i18n";
import { getLocalPBs } from "@/lib/athleteDossier";
import { buildWorkoutReviewDigest } from "@/lib/workoutReview";
import { creditCost } from "@/lib/credits";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { shortfallFromEdgeError } from "@/lib/shortfall";
import { requestCreditTopUp } from "@/lib/topUpStore";

export type WorkoutReviewResult =
  | { kind: "ready" | "unreadable"; data: unknown; charged?: number }
  | { kind: "empty"; reason: string }
  | { kind: "error"; message: string };

export async function runWorkoutReview({
  user,
  profile,
  planWeek,
  weekCurrent,
  durationWeeks,
  onCharge,
}: {
  user: { id: string };
  profile: { sport?: string | null };
  planWeek: Array<{ week: number; sessions: Array<{ day: number; title?: string | null; type?: string | null; duration_minutes?: number | null; description?: string | null; skipped?: boolean | null }> }> | null;
  weekCurrent?: number | null;
  durationWeeks?: number | null;
  onCharge?: (charged: number) => void;
}): Promise<WorkoutReviewResult> {
  if (!user || !profile) return { kind: "error", message: "Start by signing in." };
  if (!planWeek || !Array.isArray(planWeek)) return { kind: "error", message: "No active plan yet — generate one first." };

  const log = await supabase
    .from("workouts")
    .select("id, title, type, sport, duration_minutes, distance_km, calories_burned, completed_at, created_at, notes")
    .eq("user_id", user.id)
    .eq("completed", true)
    .order("completed_at", { ascending: false })
    .limit(20);

  if (log.error) return { kind: "error", message: log.error.message };

  const { digest, workoutCount } = buildWorkoutReviewDigest({
    workouts: (log.data ?? []) as unknown as Array<Record<string, unknown>>,
    planWeek: planWeek.map((week) => ({
      week: week.week,
      sessions: (week.sessions ?? []).map((session) => ({
        day: session.day,
        title: session.title,
        type: session.type,
        duration_minutes: session.duration_minutes,
        description: session.description,
        skipped: session.skipped,
      })),
    }))[0] ?? null,
    weekCurrent,
    durationWeeks,
  });

  if (workoutCount === 0) {
    return { kind: "empty", reason: "Log a few finished sessions first — analysing nothing would be invented." };
  }

  const cost = creditCost("training_insight", 1);
  const outcome = await onCharge?.(cost);

  const { data, error } = await supabase.functions.invoke("ai-analyze", {
    body: {
      type: "stats_insight",
      summary: digest,
      userLocale: getAiLocale(),
      sport: profile.sport ?? "General",
      pbs: getLocalPBs().slice(0, 20).map((p) => ({
        metric: p.metric,
        value: p.value,
        unit: p.unit,
        date: p.date,
      })),
    },
  });

  if (error) {
    const message = await edgeErrorMessage(error);
    const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
    if (status === 402) {
      const sf = await shortfallFromEdgeError(error);
      if (sf) {
        const topUp = await requestCreditTopUp({
          shortfall: sf.shortfall,
          reasonLabel: "Analyse my workouts",
        });
        if (topUp.purchased) {
          return runWorkoutReview({ user, profile, planWeek, weekCurrent, durationWeeks, onCharge });
        }
        return { kind: "error", message: topUp.dismissed ? "Cancelled — add credits to analyse your workouts." : "" };
      }
    }
    return { kind: "error", message };
  }

  const payload = (data ?? {}) as { result?: string; cost?: number; balance?: number | null };
  let parsed: unknown;
  try {
    parsed = typeof payload.result === "string" ? JSON.parse(payload.result) : payload.result;
  } catch {
    return { kind: "unreadable", data: payload };
  }

  const charged = typeof payload.cost === "number" ? payload.cost : 0;
  if (charged > 0) onCharge?.(charged);
  return { kind: "ready", data: parsed, charged };
}
