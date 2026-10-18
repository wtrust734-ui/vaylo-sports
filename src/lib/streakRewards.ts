// ============================================================================
// STREAK REWARDS — client half
// ----------------------------------------------------------------------------
// The client can only ASK:
//   * claimStreakDay(source, ref, day?)  → server validates the source row and
//     inserts at most one qualifying day; all XP flows through the existing
//     xp_award service and its ledger. The client never sends an XP amount, a
//     streak computation or a milestone unlock — the server is authoritative.
//   * useStreakPanel()  → one RPC returning everything the streak screen shows.
//
// Idempotency: the day is unique per user+day, and milestone rows are unique
// per user+milestone, so duplicate events, retries and concurrent claims can
// never double anything. newMilestone toasts are fired only from the claim
// that actually awarded them (the server's `new_milestones` list is asserted
// as a "not duplicate" check too).
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** The five qualifying-day sources the server accepts (see the migration). */
export type StreakSource =
  | "training_session"
  | "recovery_session"
  | "learning_lesson"
  | "weekly_goal"
  | "rest_day";

export interface StreakMilestone {
  kind: string;
  days: number;
  name: string;
  xp: number;
  earned: boolean;
}

export interface StreakPanel {
  current_streak: number;
  live_run: number;
  longest_streak: number;
  last_activity_day: string | null;
  next_milestone: { days: number; name: string; xp: number; remaining: number } | null;
  milestones: StreakMilestone[];
  history: { day: string; source: string; detail: Record<string, unknown> }[];
}

export async function claimStreakDay(
  source: StreakSource,
  sourceRef: string,
  day?: string,
): Promise<{ ok: boolean; newMilestones: StreakMilestone[] }> {
  const { data, error } = await supabase.rpc("streak_claim_day" as never, {
    p_day: day ?? null,
    p_source: source,
    p_source_ref: sourceRef,
  } as never);
  if (error) {
    // Claim failures are silent on purpose — the underlying activity already
    // saved and its own XP already landed through xp_award.
    return { ok: false, newMilestones: [] };
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    duplicate_day?: boolean;
    new_milestones?: { kind?: string; days?: number; name?: string; xp?: number }[];
  };
  const newMilestones = (r.new_milestones ?? []).filter(
    (m): m is StreakMilestone =>
      m.kind != null && m.days != null && m.name != null && m.xp != null,
  );
  // Restrained, idempotent: the server reports only the milestones this exact
  // award actually granted, so a replay or a duplicate day can never re-toast.
  for (const m of newMilestones) {
    toast.success(`${m.name} unlocked`, {
      description: `${m.days}-day streak locked in — +${m.xp} XP`,
      duration: 7000,
    });
  }
  window.dispatchEvent(new Event("vaylo:streak-changed"));
  return { ok: r.ok === true, newMilestones };
}

/** Convenience: claim today against this source and reference. */
export function claimStreakToday(source: StreakSource, sourceRef: string) {
  const todayLocal = new Date();
  const day = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, "0")}-${String(todayLocal.getDate()).padStart(2, "0")}`;
  return claimStreakDay(source, sourceRef, day);
}

/** Live panel for the streak screen and the dashboard card. */
export function useStreakPanel() {
  const { user } = useAuth();
  const [panel, setPanel] = useState<StreakPanel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPanel(null);
      setLoading(false);
      return;
    }
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc("streak_panel" as never);
      if (!alive) return;
      if (error) {
        // The dashboard card must not crash without data; the streak page
        // surfaces the empty state on its own.
        setPanel(null);
      } else {
        setPanel((data ?? {}) as unknown as StreakPanel);
      }
      setLoading(false);
    };
    void load();
    const onChange = () => void load();
    window.addEventListener("vaylo:streak-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("vaylo:streak-changed", onChange);
    };
  }, [user]);

  return { panel, loading };
}
