// ============================================================================
// useAdaptiveSchedule — reading the adaptive record onto a plan's dates
// ----------------------------------------------------------------------------
// The plan in `training_plans.plan_data` is weeks and day numbers. The adaptive
// record is rows in `plan_events` with real dates and a status. Neither can
// answer the calendar's question on its own ("which of these sessions did my
// break change, and why?"), so this hook joins them and hands the screen both
// halves of the answer:
//
//   • `statusFor(week, day)` — the status for one cell of the plan grid, so a
//     session can be marked without the screen knowing anything about dates.
//   • `changes` — one entry per life event that touched this plan, with the
//     same explanation string the Availability screen shows. One sentence in
//     one module, so the two screens cannot disagree about what happened.
//
// It reads the database rather than recomputing the projection, because the
// record is the point: a session the app already marked stays marked, even if
// the plan is edited afterwards.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  activeAdjustments,
  adjustmentForWeek,
  type AdjustmentStep,
  type PlanAdjustmentRecord,
} from "@/lib/adaptivePlan";
import { explanationFor, type LifeEvent, type SessionStatus } from "@/lib/lifeEvents";
import { sessionDate, weekOneMonday, type TrainingPlanLike } from "@/lib/planSchedule";

/** One row of `plan_events`, as far as this hook cares. */
interface PlanEventRow {
  id: string;
  scheduled_date: string;
  title: string;
  status: string;
  important: boolean;
  life_event_id: string | null;
}

export interface AdaptiveSessionRef {
  scheduled_date: string;
  title: string;
  status: SessionStatus;
  important: boolean;
}

export interface AdaptiveChange {
  event: LifeEvent;
  /** The "What changed?" sentence. Null when the event removed nothing. */
  explanation: string | null;
  sessions: AdaptiveSessionRef[];
}

export interface AdaptiveSchedule {
  loading: boolean;
  error: string | null;
  /** The status recorded for a cell of the plan grid. `planned` when none. */
  statusFor: (week: number, day: number) => SessionStatus;
  /** What a life event changed about this plan, oldest first. */
  changes: AdaptiveChange[];
  /** How many sessions on this plan a life event removed in total. */
  lost: number;
  /**
   * Rebuilds applied to this plan, oldest first.
   *
   * Read straight off the plan row rather than queried, because the record is
   * stored on the plan itself — which is what makes it travel with the plan and
   * need no second table to explain it.
   */
  adjustments: PlanAdjustmentRecord[];
  /** The rebuild covering a plan week, for the tag on the week header. */
  rebuildFor: (week: number) => { record: PlanAdjustmentRecord; step: AdjustmentStep } | null;
}

const EMPTY: AdaptiveSchedule = {
  loading: false,
  error: null,
  statusFor: () => "planned",
  changes: [],
  lost: 0,
  adjustments: [],
  rebuildFor: () => null,
};

export function useAdaptiveSchedule(plan: TrainingPlanLike | null | undefined): AdaptiveSchedule {
  const { user } = useAuth();
  const [rows, setRows] = useState<PlanEventRow[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planId = plan?.id ?? null;

  useEffect(() => {
    if (!user || !planId) {
      setRows([]);
      setEvents([]);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      // Scoped to this plan: a record left behind by a plan the athlete has
      // since replaced must not surface on the new one, even if a date happens
      // to coincide.
      const { data, error: readError } = await supabase
        .from("plan_events")
        .select("id, scheduled_date, title, status, important, life_event_id")
        .eq("user_id", user.id)
        .eq("training_plan_id", planId);

      if (!alive) return;
      if (readError) {
        // Reported rather than swallowed: showing a plan with no marks on it
        // would read as "your break changed nothing", which is a lie the app
        // should not tell silently.
        setError(readError.message);
        setRows([]);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as PlanEventRow[];
      setRows(list);

      const ids = [...new Set(list.map((r) => r.life_event_id).filter((id): id is string => !!id))];
      if (ids.length) {
        const { data: lifeRows } = await supabase.from("life_events").select("*").in("id", ids);
        if (alive) setEvents((lifeRows ?? []) as LifeEvent[]);
      } else {
        setEvents([]);
      }
      if (alive) {
        setError(null);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, planId]);

  const statuses = useMemo(() => {
    const map = new Map<string, SessionStatus>();
    for (const row of rows) {
      // Newest row wins for a date: a session re-planned onto a day that
      // already held one should show what it became, not what it replaced.
      map.set(row.scheduled_date, row.status as SessionStatus);
    }
    return map;
  }, [rows]);

  const anchor = useMemo(() => (plan ? weekOneMonday(plan) : null), [plan]);

  const statusFor = useCallback(
    (week: number, day: number): SessionStatus => {
      if (!anchor) return "planned";
      return statuses.get(sessionDate(anchor, week, day)) ?? "planned";
    },
    [anchor, statuses],
  );

  const changes = useMemo<AdaptiveChange[]>(() => {
    const byEvent = new Map<string, AdaptiveChange>();
    for (const row of rows) {
      if (!row.life_event_id) continue;
      const event = events.find((e) => e.id === row.life_event_id);
      if (!event) continue;
      const entry = byEvent.get(event.id) ?? { event, explanation: null, sessions: [] };
      entry.sessions.push({
        scheduled_date: row.scheduled_date,
        title: row.title,
        status: row.status as SessionStatus,
        important: row.important,
      });
      byEvent.set(event.id, entry);
    }
    return [...byEvent.values()]
      .map((change) => ({
        ...change,
        sessions: change.sessions.sort((a, b) => (a.scheduled_date < b.scheduled_date ? -1 : 1)),
        explanation: explanationFor(
          change.event,
          change.sessions.filter((s) => s.status === "cancelled_due_to_availability").length,
        ),
      }))
      .sort((a, b) => (a.event.start_date < b.event.start_date ? -1 : 1));
  }, [rows, events]);

  const lost = useMemo(
    () => rows.filter((r) => r.status === "cancelled_due_to_availability").length,
    [rows],
  );

  // Narrowed defensively: the column is JSON, and a plan written by an older
  // build — or a rebuild half-applied — must read as "no rebuilds" rather than
  // crashing the plan screen.
  const adjustments = useMemo(() => activeAdjustments(plan?.plan_adjustments), [plan?.plan_adjustments]);

  const rebuildFor = useCallback(
    (week: number) => adjustmentForWeek(adjustments, week),
    [adjustments],
  );

  if (!user || !planId) return EMPTY;
  return { loading, error, statusFor, changes, lost, adjustments, rebuildFor };
}
