// ============================================================================
// XP — shared client half of the athlete progression system
// ----------------------------------------------------------------------------
// XP is a progression metric ONLY: not money, not credits, not coins, not
// purchasable. This module:
//   * mirrors the level ladder defined in 20261018080000_xp_progression.sql
//     (thresholds 1–10 by table, post-10 by the same config formula);
//   * calls the server's xp_award RPC — the client NEVER sends an XP amount;
//     the amount, proof validation, idempotency and daily caps all live in
//     the database functions;
//   * exposes a small profile/history read model for the UI.
//
// A rest day earns recovery XP through the recovery check-in itself — no
// exercise required — so future streak rules can treat a logged rest day as a
// valid activity day without a migration.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// ── reward kinds (mirrors public.xp_reward_rules; amounts live server-side) ──
export type XpKind =
  | "training_session"
  | "recovery_session"
  | "learning_lesson"
  | "weekly_goal"
  | "assessment";

export const XP_KIND_LABELS: Record<XpKind, string> = {
  training_session: "Completed a training session",
  recovery_session: "Recovery check-in",
  learning_lesson: "Completed a lesson",
  weekly_goal: "Weekly training goal",
  assessment: "Passed an assessment",
};

// ── level ladder (mirrors public.xp_levels) ──────────────────────────────────
export const XP_LEVEL_THRESHOLDS: number[] = [
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200,
];

/** Post-level-10 growth — mirrors xp_level_config (first delta, then +60/level). */
export const XP_POST10_FIRST_DELTA = 800;
export const XP_POST10_GROWTH = 60;

/** Total XP required to hold a level (level 1 → 0, level 10 → 3200, …). */
export function xpThreshold(level: number): number {
  if (level <= 1) return 0;
  if (level <= 10) return XP_LEVEL_THRESHOLDS[level - 1];
  let total = XP_LEVEL_THRESHOLDS[9];
  for (let k = 11; k <= level; k++) {
    // Strictly increasing: the per-level delta itself grows with k.
    total += XP_POST10_FIRST_DELTA + (k - 11) * XP_POST10_GROWTH;
  }
  return total;
}

/** The level an XP total corresponds to. Pure, shared with the SQL twin. */
export function xpLevelFor(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp < 0) return 1;
  let level = 1;
  for (let i = 1; i < XP_LEVEL_THRESHOLDS.length; i++) {
    if (totalXp >= XP_LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  while (xpThreshold(level + 1) <= totalXp) level++;
  return Math.max(1, level);
}

// ── profile read model ───────────────────────────────────────────────────────
export interface XpProfile {
  total_xp: number;
  level: number;
  xp_into_level: number;
  xp_for_next_level: number;
  xp_to_next_level: number;
}

export interface XpAwardResult extends Partial<XpProfile> {
  ok: boolean;
  awarded: number;
  duplicate: boolean;
  leveled_up?: boolean;
  previous_level?: number;
  error?: string;
}

export async function fetchXpProfile(): Promise<XpProfile | null> {
  const { data } = await supabase.rpc("xp_profile" as never);
  const r = (data ?? null) as { ok?: boolean; error?: string } & XpProfile | null;
  if (!r || r.ok !== true) return null;
  return {
    total_xp: Number(r.total_xp ?? 0),
    level: Number(r.level ?? 1),
    xp_into_level: Number(r.xp_into_level ?? 0),
    xp_for_next_level: Number(r.xp_for_next_level ?? 100),
    xp_to_next_level: Number(r.xp_to_next_level ?? 100),
  };
}

export interface XpTransaction {
  id: string;
  kind: string;
  xp_amount: number;
  reason: string | null;
  created_at: string;
}

export async function fetchXpHistory(limit = 30): Promise<XpTransaction[]> {
  // `as never` on the table name until the generated types include the new
  // table.
  const { data } = await supabase
    .from("xp_transactions" as never)
    .select("id, kind, xp_amount, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown) as XpTransaction[];
}

// ── award helpers (one per surface; all go through the same RPC) ─────────────
type AwardError = "not_authenticated" | "unverified_activity" | "unknown_kind" | "daily_cap_reached" | string;

async function award(
  kind: XpKind,
  sourceRef: string,
  opts: { reason?: string; idempotencyKey?: string } = {},
): Promise<XpAwardResult> {
  const { data, error } = await supabase.rpc("xp_award" as never, {
    p_kind: kind,
    p_source_ref: sourceRef,
    p_idempotency_key: opts.idempotencyKey ?? null,
    p_reason: opts.reason ?? null,
  } as never);
  if (error) {
    return { ok: false, awarded: 0, duplicate: false, error: error.message };
  }
  const r = (data ?? {}) as XpAwardResult;
  announceXp(r, kind, opts.reason ?? null);
  return r;
}

/** A logged training session (the log row is verified server-side). */
export function awardTrainingSession(logId: string, reason?: string) {
  return award("training_session", logId, {
    reason,
    idempotencyKey: `training:${logId}`,
  });
}

/** A recovery check-in day (works on rest days — exercise not required). */
export function awardRecoverySession(logDate: string) {
  return award("recovery_session", logDate, {
    idempotencyKey: `recovery:${logDate}`,
  });
}

/** A completed learning lesson (idempotent per lesson). */
export function awardLesson(lessonId: string) {
  return award("learning_lesson", lessonId, {
    idempotencyKey: `lesson:${lessonId}`,
  });
}

/** A passed assessment (score >= the rule's pass mark, validated server-side). */
export function awardAssessment(lessonId: string) {
  return award("assessment", lessonId, {
    idempotencyKey: `assessment:${lessonId}`,
  });
}

/** A weekly process goal hitting its target for the week the goal belongs to. */
export function awardWeeklyGoal(goalId: string, weekStartIso: string) {
  return award("weekly_goal", `${goalId}:${weekStartIso}`, {
    idempotencyKey: `weekly:${goalId}:${weekStartIso}`,
  });
}

// ── notifications: subtle credit, restrained level-up, never twice ──────────
let lastKnownLevel: number | null = null;

/** Called after every award so a level-up is announced once, at the moment it happens. */
function announceXp(result: XpAwardResult, kind: XpKind, reason: string | null) {
  if (result.ok !== true || result.duplicate) return;
  if (result.awarded > 0) {
    toast(`+${result.awarded} XP`, {
      description: reason ?? XP_KIND_LABELS[kind],
      duration: 3500,
    });
  }
  if (result.leveled_up) {
    toast.success(`Level ${result.level} — progress recorded`, {
      description: `You're now level ${result.level}. Keep building.`,
      duration: 6000,
    });
  }
  lastKnownLevel = result.level ?? lastKnownLevel;
}

// ── reactivity: surfaces subscribe to getXpChangedSubject pattern ────────────
export const XP_CHANGED_EVENT = "vaylo:xp-changed";

export function notifyXpChanged() {
  window.dispatchEvent(new Event(XP_CHANGED_EVENT));
}

/** Live profile hook: fetches once per mount, refreshes on award/order events. */
export function useXpProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<XpProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let alive = true;
    const load = async () => {
      const next = await fetchXpProfile();
      if (alive && next) {
        setProfile(next);
        lastKnownLevel = next.level;
        setLoading(false);
      }
    };
    void load();
    window.addEventListener(XP_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(XP_CHANGED_EVENT, load);
    };
  }, [user]);

  return { profile, loading };
}
