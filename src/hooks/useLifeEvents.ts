// ============================================================================
// useLifeEvents — reading and writing an athlete's availability
// ----------------------------------------------------------------------------
// The screen-facing half of the availability layer. Two responsibilities, kept
// deliberately separate:
//
//   • CRUD on `life_events`. Creating and editing both work offline through the
//     existing write queue, so a break added on a train is not lost.
//
//   • Applying an event to the plan: recording the sessions it overlaps as
//     `cancelled_due_to_availability`. This is a *separate* call from saving
//     the event, because the two can fail independently and the athlete should
//     still have their break recorded if the calendar write fails. Saving a
//     break is the promise; tidying the calendar is the follow-up.
//
// Why `applyToPlan` writes rows at all, rather than only explaining itself on
// screen: the plan itself lives in `training_plans.plan_data` as weeks and day
// numbers, which carries no statuses and cannot answer "which sessions were
// lost, and to what?". Copying the whole plan into `plan_events` would create a
// second source of truth for every session in the season. So only the sessions
// something actually changed are written — the adaptive record — and the plan
// stays the plan. A later re-planning phase reads that record instead of
// re-deriving it.
//
// What this hook deliberately does not do: move anything. `applyToPlan` only
// ever writes `cancelled_due_to_availability`, and only onto sessions that are
// still `planned`. The decision logic lives in `src/lib/lifeEvents.ts` and is
// tested without a database; this file is the plumbing around it.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ageFromDateOfBirth, rebuildPlanForBreak } from "@/lib/adaptivePlanning";
import {
  asPlannedSession,
  assessAvailability,
  type ActivityLevel,
  type AllowTraining,
  type LifeEvent,
  type LifeEventType,
  type PlannedSession,
  type SessionStatus,
} from "@/lib/lifeEvents";
import { insertOrQueue, pendingWrites, updateOrQueue } from "@/lib/offlineQueue";
import { flattenPlan, type DatedSession, type TrainingPlanLike } from "@/lib/planSchedule";
import { readFailed } from "@/lib/dbRead";

/** What the form collects. `user_id` is added by this hook. */
export interface LifeEventInput {
  start_date: string;
  end_date: string;
  event_type: LifeEventType;
  activity_level: ActivityLevel;
  allow_training: AllowTraining;
  note?: string | null;
}

export type SaveOutcome =
  | { ok: true; event: LifeEvent; queued: boolean }
  | { ok: false; error: string };

/**
 * What a break did to the *content* of the plan, as opposed to its calendar.
 *
 * Distinguishing the two matters to the copy: "we marked six sessions" and "we
 * rebuilt your next week" are different sentences, and an athlete who has been
 * away for a fortnight needs the second one.
 */
export interface RebuildSummary {
  applied: boolean;
  /** The "why has my plan changed?" sentence for the rebuild, when one applied. */
  explanation: string | null;
  /** The plan weeks that were rebuilt. */
  weeks: number[];
  /** Present when the rebuild was attempted and did not land. */
  error?: string;
}

/** What `applyToPlan` did. `marked` is what actually changed this call. */
export interface ApplyOutcome {
  marked: number;
  /** The "What changed?" sentence for the event, or null when nothing changed. */
  explanation: string | null;
  /** Null when the break was too short to need a rebuild, or there was no plan. */
  rebuild: RebuildSummary | null;
}

const explain = (error: unknown): string => {
  const message = (error as { message?: string } | null)?.message;
  return message || "Something went wrong saving that. Please try again.";
};

export interface UseLifeEvents {
  events: LifeEvent[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  refresh: () => Promise<void>;
  create: (input: LifeEventInput) => Promise<SaveOutcome>;
  update: (id: string, patch: Partial<LifeEventInput>) => Promise<SaveOutcome>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Records the sessions an event overlaps as `cancelled_due_to_availability`,
   * and returns how many this call changed.
   *
   * Safe to call repeatedly: sessions already attributed to this event, or to
   * any other, are left exactly as they are — so re-saving an edited break
   * never stacks a second copy of the same session.
   */
  applyToPlan: (event: LifeEvent) => Promise<ApplyOutcome>;
}

export function useLifeEvents(): UseLifeEvents {
  const { user, profile } = useAuth();
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: readError } = await supabase
      .from("life_events")
      .select("*")
      .eq("user_id", user.id)
      .order("start_date", { ascending: false });

    if (readError) {
      // A failed read is reported rather than rendered as "no breaks": telling
      // an athlete their holiday was not saved when it was is worse than the
      // error message.
      setError(explain(readError));
    } else {
      setError(null);
      setEvents((data ?? []) as LifeEvent[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: LifeEventInput): Promise<SaveOutcome> => {
      if (!user) return { ok: false, error: "You need to be signed in to add a break." };
      setSaving(true);
      try {
        const row = {
          user_id: user.id,
          start_date: input.start_date,
          end_date: input.end_date,
          event_type: input.event_type,
          activity_level: input.activity_level,
          allow_training: input.allow_training,
          note: input.note?.trim() ? input.note.trim() : null,
        };

        // insertOrQueue generates the id, so the optimistic copy below and the
        // row that eventually lands share one primary key.
        const result = await insertOrQueue("life_events", row as unknown as Record<string, unknown>);
        if (!result.ok) return { ok: false, error: explain(result.error) };

        const saved: LifeEvent = { id: result.id, ...row } as LifeEvent;
        setEvents((prev) => [saved, ...prev].sort((a, b) => (a.start_date < b.start_date ? 1 : -1)));
        return { ok: true, event: saved, queued: result.queued };
      } finally {
        setSaving(false);
      }
    },
    [user],
  );

  const update = useCallback(
    async (id: string, patch: Partial<LifeEventInput>): Promise<SaveOutcome> => {
      setSaving(true);
      try {
        const values: Record<string, unknown> = { ...patch };
        if ("note" in values) {
          const note = typeof values.note === "string" ? values.note.trim() : "";
          values.note = note ? note : null;
        }
        const result = await updateOrQueue("life_events", id, values);
        if (!result.ok) return { ok: false, error: explain(result.error) };

        const merged = events.find((e) => e.id === id);
        const next = merged ? { ...merged, ...patch, note: (values.note as string | null) ?? null } : null;
        setEvents((prev) => (next ? prev.map((e) => (e.id === id ? next : e)) : prev));
        return { ok: true, event: (next ?? { id }) as LifeEvent, queued: result.queued };
      } finally {
        setSaving(false);
      }
    },
    [events],
  );

  const remove = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      // Deleting a break must not silently leave its sessions cancelled — but
      // it must also not un-cancel them automatically, because the athlete may
      // have moved on. The rows keep their status and lose the link (the FK is
      // ON DELETE SET NULL), which keeps the history honest either way.
      const { error: deleteError } = await supabase.from("life_events").delete().eq("id", id);
      if (deleteError) return { ok: false, error: explain(deleteError) };
      setEvents((prev) => prev.filter((e) => e.id !== id));
      return { ok: true };
    },
    [],
  );

  const applyToPlan = useCallback(
    async (event: LifeEvent): Promise<ApplyOutcome> => {
      if (!user) return { marked: 0, explanation: null, rebuild: null };

      // Which sessions does this break actually cover? Read from the plan, not
      // from `plan_events`: that table holds only the sessions something has
      // already changed, so asking it would make the second break of a season
      // behave differently from the first.
      let planRow: TrainingPlanLike | null = null;
      if (event.allow_training === "no") {
        const { data, error: planReadError } = await supabase
          .from("training_plans")
          .select("id, created_at, week_current, duration_weeks, plan_data, plan_adjustments")
          .eq("user_id", user.id)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        // A failed read is not "no plan". With `planRow` null the projection
        // below matches no sessions and the athlete is told their break changed
        // nothing — a false statement about their own calendar. The event itself
        // is saved by this point, so the tidy-up half is abandoned loudly rather
        // than reported wrongly.
        if (readFailed(planReadError, "your training plan")) {
          return { marked: 0, explanation: null, rebuild: null };
        }
        planRow = (data as TrainingPlanLike | null) ?? null;
      }

      const covered: DatedSession[] = planRow
        ? flattenPlan(planRow).filter(
            (s) => s.scheduled_date >= event.start_date && s.scheduled_date <= event.end_date,
          )
        : [];

      // What has already been recorded, in the database and in the offline
      // queue. A break saved twice — on a train, then again at home — must not
      // write two rows for one session.
      const keyOf = (row: { scheduled_date: string; title: string }) =>
        `${row.scheduled_date}::${row.title}`;
      const recorded = new Map<string, { id: string; status: SessionStatus }>();

      // `life_event_id` is deliberately not read: the database guarantees a
      // row carrying one is never still `planned`, so the status alone already
      // answers "has this session been claimed by an event?".
      const { data: existingRows, error: recordedReadError } = await supabase
        .from("plan_events")
        .select("id, scheduled_date, title, status")
        .eq("user_id", user.id)
        .gte("scheduled_date", event.start_date)
        .lte("scheduled_date", event.end_date);

      // Without this read the de-duplication below is blind: every session the
      // plan covers would look unrecorded, and a break applied twice — on the
      // train, then again at home — would write a second row for one day instead
      // of updating the first. Abandoned rather than risk the duplicates.
      if (readFailed(recordedReadError, "the sessions this break already changed")) {
        return { marked: 0, explanation: null, rebuild: null };
      }

      for (const row of existingRows ?? []) {
        recorded.set(keyOf(row), { id: row.id, status: row.status as SessionStatus });
      }
      for (const queued of pendingWrites()) {
        if (queued.table !== "plan_events") continue;
        const values = queued.values as { scheduled_date?: unknown; title?: unknown; status?: unknown };
        if (typeof values.scheduled_date !== "string" || typeof values.title !== "string") continue;
        const key = keyOf({ scheduled_date: values.scheduled_date, title: values.title });
        if (!recorded.has(key)) {
          recorded.set(key, { id: queued.id, status: (values.status as SessionStatus) ?? "planned" });
        }
      }

      // One entry per covered session, resolved to the identity it already has:
      // an existing row (update in place) or a projected session (insert once).
      const inputs: PlannedSession[] = [];
      const identity = new Map<
        string,
        { kind: "row"; id: string } | { kind: "new"; session: DatedSession }
      >();
      for (const session of covered) {
        const found = recorded.get(keyOf(session));
        inputs.push(asPlannedSession(session, found ?? null));
        identity.set(
          found ? found.id : session.id,
          found ? { kind: "row", id: found.id } : { kind: "new", session },
        );
      }

      const assessment = assessAvailability(inputs, event);
      const writable = assessment.adjustments.filter((a) => a.reason === "unavailable");

      // Sequential rather than parallel: the count here is a week or two of
      // sessions, and a burst of concurrent writes is a worse trade than a
      // slightly slower loop.
      let marked = 0;
      for (const adjustment of writable) {
        const where = identity.get(adjustment.sessionId);
        if (!where) continue;

        if (where.kind === "row") {
          const { error: writeError } = await supabase
            .from("plan_events")
            .update({
              status: "cancelled_due_to_availability",
              life_event_id: event.id,
              adjusted_reason: "availability",
            })
            .eq("id", where.id);
          if (!writeError) marked++;
          continue;
        }

        // A session the plan holds but no row records yet. Queued rather than
        // written outright, so a break added with no signal still ends with a
        // truthful calendar once the signal returns.
        const result = await insertOrQueue("plan_events", {
          user_id: user.id,
          training_plan_id: planRow?.id ?? null,
          scheduled_date: where.session.scheduled_date,
          title: where.session.title,
          type: where.session.type,
          status: "cancelled_due_to_availability",
          life_event_id: event.id,
          important: where.session.important,
          adjusted_reason: "availability",
        });
        if (result.ok) marked++;
      }

      // Phase 2. The same break that cancelled those sessions is also a break
      // the athlete has to come back from, and coming back to the old numbers
      // immediately is how the fortnight away turns into an injury. This runs
      // after the record is written and is allowed to fail on its own: the
      // break is saved either way, and the athlete is told which half worked.
      //
      // Deliberately only for `allow_training: "no"`. An athlete who kept
      // training through their holiday has not been away, and rebuilding their
      // plan around a break they did not take would be the app arguing with
      // them about their own week.
      let rebuild: RebuildSummary | null = null;
      if (planRow && event.allow_training === "no") {
        const result = await rebuildPlanForBreak({
          userId: user.id,
          plan: planRow,
          event,
          age: ageFromDateOfBirth(profile?.date_of_birth),
        });
        if (result.ok && result.outcome?.adjustment) {
          rebuild = {
            applied: true,
            explanation: result.outcome.adjustment.explanation,
            weeks: result.outcome.adjustment.steps.map((s) => s.week),
          };
        } else if (!result.ok) {
          rebuild = {
            applied: false,
            explanation: null,
            weeks: [],
            error: result.error,
          };
        }
      }

      return { marked, explanation: assessment.explanation, rebuild };
    },
    [user, profile],
  );

  return { events, loading, error, saving, refresh, create, update, remove, applyToPlan };
}
