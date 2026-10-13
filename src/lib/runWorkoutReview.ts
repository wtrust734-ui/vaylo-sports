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
import { buildWorkoutReviewDigest, type WorkoutReviewPlanWeek } from "@/lib/workoutReview";
import { creditCost } from "@/lib/credits";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { shortfallFromEdgeError } from "@/lib/shortfall";
import { requestCreditTopUp } from "@/lib/topUpStore";

export type WorkoutReviewResult =
  | { kind: "ready" | "unreadable"; data: unknown; charged?: number }
  | { kind: "empty"; reason: string }
  | { kind: "error"; message: string };

/**
 * The plan's weeks, in whichever shape they were stored.
 *
 * `training_plans.plan_data` is JSON written by the plan generator, the plan
 * editor and the rebuild, and it has been seen as a bare array and as an object
 * with a `weeks` key. Normalising here rather than at the call site means the
 * screen can hand over whatever the column holds and never accuse an athlete of
 * having no plan because the shape changed.
 */
function planWeeks(planData: unknown): WorkoutReviewPlanWeek[] {
  const source = Array.isArray(planData)
    ? planData
    : planData && typeof planData === "object" && Array.isArray((planData as { weeks?: unknown }).weeks)
      ? (planData as { weeks: unknown[] }).weeks
      : [];
  return source.filter((week): week is WorkoutReviewPlanWeek => !!week && typeof week === "object");
}

/**
 * The week the review is about: the one the athlete is actually in.
 *
 * This used to send the FIRST week of the plan regardless of `weekCurrent`, so
 * an athlete in week 5 of 8 had their last twenty sessions compared against
 * week 1 — the comparison the button exists for was pointed at the wrong page
 * of the plan. When the current week is unknown (or no longer in the plan's
 * range) the first week is a better answer than nothing.
 */
function currentPlanWeek(planData: unknown, weekCurrent?: number | null): WorkoutReviewPlanWeek | null {
  const weeks = planWeeks(planData);
  if (!weeks.length) return null;
  if (typeof weekCurrent === "number") {
    const match = weeks.find((week) => week.week === weekCurrent);
    if (match) return match;
  }
  return weeks[0];
}

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
  /** The active plan's `plan_data`, in whatever shape the column holds. */
  planWeek?: unknown;
  weekCurrent?: number | null;
  durationWeeks?: number | null;
  onCharge?: (charged: number) => void;
}): Promise<WorkoutReviewResult> {
  if (!user || !profile) return { kind: "error", message: "Start by signing in." };

  // A plan is optional and a log is not. This used to refuse outright without
  // one — "No active plan yet — generate one first" — which turned the button
  // into a dead end for the athlete with the most to learn from it, and
  // contradicted this screen's own comment on the plan read ("A missing plan is
  // not an error") as well as the digest builder, which already knows how to
  // say that no plan was supplied. The review now reads the log, says what it
  // was missing, and still costs what the button says.
  const week = currentPlanWeek(planWeek, weekCurrent);

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
    planWeek: week,
    weekCurrent: week ? weekCurrent : null,
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
