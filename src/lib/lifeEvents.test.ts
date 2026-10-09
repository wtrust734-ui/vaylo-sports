// ============================================================================
// LIFE EVENTS & AVAILABILITY — behaviour
// ----------------------------------------------------------------------------
// Each test is a guarantee the product makes to an athlete, written so that
// breaking it fails the suite rather than being argued about later.
//
// The four that matter most, because getting any of them wrong corrupts either
// the training record or the athlete's trust in it:
//
//   1. A completed session is never altered by a break.
//   2. Nothing is auto-moved into the following days.
//   3. A break is not counted as a failure.
//   4. A note is never required, and silence is never treated as a signal.
// ============================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { flattenPlan, type TrainingPlanLike } from "./planSchedule";
import {
  ALLOW_TRAINING_OPTIONS,
  asPlannedSession,
  YOUTH_BREAK_NOTE,
  LIFE_EVENT_TYPES,
  ACTIVITY_LEVELS,
  assessAvailability,
  availabilityKind,
  countsTowardCompletion,
  coversDate,
  eventOnDate,
  explanationFor,
  formatPeriod,
  isFailure,
  isInsideAvailabilityWindow,
  mentionsWellbeingConcern,
  safetyNotice,
  sessionExplanation,
  sortEvents,
  spanDays,
  type LifeEvent,
  type LifeEventType,
  type PlannedSession,
} from "./lifeEvents";

const UID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

function event(over: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: EVENT_ID,
    user_id: UID,
    start_date: "2026-07-01",
    end_date: "2026-07-07",
    event_type: "holiday",
    activity_level: "light",
    allow_training: "no",
    note: null,
    ...over,
  };
}

function session(over: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id: `s-${over.scheduled_date ?? "2026-07-01"}`,
    scheduled_date: "2026-07-01",
    title: "Tempo Run",
    status: "planned",
    ...over,
  };
}

/** A week of planned sessions, matching the shape the Training grid renders. */
const week = (): PlannedSession[] =>
  ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"].map(
    (d, i) => session({ id: `wk-${i}`, scheduled_date: d, status: i === 6 ? "rest" : "planned" }),
  );

// ---------------------------------------------------------------------------
// 1. Vocabulary
// ---------------------------------------------------------------------------

describe("life event vocabulary", () => {
  it("offers every reason the spec names, plus a no-reason option", () => {
    const ids = LIFE_EVENT_TYPES.map((t) => t.id);
    for (const required of [
      "holiday",
      "travel",
      "exams",
      "competition",
      "illness",
      "injury",
      "wellbeing",
      "busy",
      "family",
      "other",
      "private",
    ] as LifeEventType[]) {
      expect(ids, `${required} is missing from the catalogue`).toContain(required);
    }
  });

  it("keeps the database CHECK and the catalogue in step", () => {
    // The migration hard-codes the same three lists. A type added to one and
    // not the other is a 23514 at insert time, discovered by an athlete.
    const sql: string = readFileSync(
      `${__dirname}/../../supabase/migrations/20261005140000_life_events_availability.sql`,
      "utf8",
    ).replace(/\r\n?/g, "\n");

    for (const t of LIFE_EVENT_TYPES) {
      expect(sql, `event_type ${t.id} is not accepted by the CHECK`).toContain(`'${t.id}'`);
    }
    for (const a of ACTIVITY_LEVELS) {
      expect(sql, `activity_level ${a.id} is not accepted by the CHECK`).toContain(`'${a.id}'`);
    }
    for (const o of ALLOW_TRAINING_OPTIONS) {
      expect(sql, `allow_training ${o.id} is not accepted by the CHECK`).toContain(`'${o.id}'`);
    }
  });

  it("never makes a note necessary", () => {
    // Every catalogue entry must be usable with note = null. Nothing in the
    // copy may imply otherwise.
    for (const t of LIFE_EVENT_TYPES) {
      expect(t.hint.length, `${t.id} has no hint`).toBeGreaterThan(0);
      expect(t.hint.toLowerCase()).not.toMatch(/explain|describe|tell us why|required/);
    }
    expect(safetyNotice({ event_type: "private", note: null })).not.toBeNull();
    expect(safetyNotice({ event_type: "holiday", note: null })).toBeNull();
  });

  it("defaults a competition to training-allowed and illness to no training", () => {
    const byId = (id: LifeEventType) => LIFE_EVENT_TYPES.find((t) => t.id === id)!;
    expect(byId("competition").defaultAllowTraining).toBe("yes");
    expect(byId("illness").defaultAllowTraining).toBe("no");
    expect(byId("injury").defaultAllowTraining).toBe("no");
    // A wellbeing break must never be defaulted to "no training": pausing is
    // the athlete's decision, not the app's.
    expect(byId("wellbeing").defaultAllowTraining).toBe("optional");
    expect(byId("holiday").defaultAllowTraining).toBe("optional");
  });
});

// ---------------------------------------------------------------------------
// 2. The allocator
// ---------------------------------------------------------------------------

describe("assessAvailability", () => {
  it("edge case 1 — a one-day break cancels exactly that day", () => {
    const e = event({ start_date: "2026-07-03", end_date: "2026-07-03" });
    const result = assessAvailability(week(), e);
    expect(result.cancelled.map((c) => c.scheduled_date)).toEqual(["2026-07-03"]);
  });

  it("edge case 2 — a 7-day holiday cancels the week but leaves rest alone", () => {
    const result = assessAvailability(week(), event());
    // Six working sessions; the 7th is a rest day and is not a loss.
    expect(result.cancelled).toHaveLength(6);
    expect(result.cancelled.some((c) => c.scheduled_date === "2026-07-07")).toBe(false);
  });

  it("edge case 3 — a 4-week break cancels every planned session in it", () => {
    const e = event({ start_date: "2026-07-01", end_date: "2026-07-28", event_type: "exams" });
    const fourWeeks: PlannedSession[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      fourWeeks.push(session({ id: `d${i}`, scheduled_date: d.toISOString().slice(0, 10) }));
    }
    const result = assessAvailability(fourWeeks, e);
    expect(result.cancelled).toHaveLength(28);
    expect(spanDays(e.start_date, e.end_date)).toBe(28);
  });

  it("edge case 4 — a holiday with optional exercise cancels nothing", () => {
    const e = event({ allow_training: "optional" });
    const result = assessAvailability(week(), e);
    expect(result.cancelled).toHaveLength(0);
    // The sessions stay planned — the athlete said they might train.
    expect(result.adjustments.filter((a) => a.reason === "optional_window")).toHaveLength(6);
    expect(result.adjustments.every((a) => a.status === "planned" || a.status === "rest")).toBe(true);
  });

  it("cancels nothing when training is still wanted", () => {
    const e = event({ allow_training: "yes" });
    const result = assessAvailability(week(), e);
    expect(result.cancelled).toHaveLength(0);
    expect(result.adjustments.every((a) => a.reason === "unchanged")).toBe(true);
  });

  it("edge case 5 — an unplanned competition does not cancel the surrounding plan", () => {
    const e = event({
      start_date: "2026-07-04",
      end_date: "2026-07-04",
      event_type: "competition",
      allow_training: "yes",
    });
    expect(assessAvailability(week(), e).cancelled).toHaveLength(0);
  });

  it("edge case 7 — one event overlapping many sessions links every one of them", () => {
    const e = event();
    const result = assessAvailability(week(), e);
    for (const c of result.cancelled) {
      expect(c.lifeEventId).toBe(e.id);
      expect(c.reason).toBe("unavailable");
    }
  });

  it("NEVER moves a session to another date", () => {
    // The single most important rule in the phase. A naive implementation
    // shifts each missed session forward by N days; this asserts the dates
    // that come out are exactly the dates that went in.
    const before = week().map((s) => s.scheduled_date);
    const result = assessAvailability(week(), event());
    const after = result.adjustments.map((a) => a.scheduled_date);
    expect(after).toEqual(before);
  });

  it("leaves completed, skipped and replaced sessions untouched", () => {
    const sessions = [
      session({ id: "done", scheduled_date: "2026-07-02", status: "completed" }),
      session({ id: "modified", scheduled_date: "2026-07-03", status: "modified" }),
      session({ id: "chose-to-skip", scheduled_date: "2026-07-04", status: "skipped" }),
      session({ id: "swapped", scheduled_date: "2026-07-05", status: "replaced" }),
      session({ id: "planned", scheduled_date: "2026-07-06", status: "planned" }),
    ];
    const result = assessAvailability(sessions, event());
    expect(result.cancelled.map((c) => c.sessionId)).toEqual(["planned"]);
    const untouched = result.adjustments.filter((a) => a.reason === "unchanged").map((a) => a.sessionId);
    expect(untouched).toEqual(["done", "modified", "chose-to-skip", "swapped"]);
  });

  it("does not re-claim a session another event already cancelled", () => {
    const first = event({ id: "event-a" });
    const second = event({ id: "event-b" });
    const sessions = [
      session({ id: "already", scheduled_date: "2026-07-02", life_event_id: first.id }),
      session({ id: "free", scheduled_date: "2026-07-03" }),
    ];
    const result = assessAvailability(sessions, second);
    expect(result.cancelled.map((c) => c.sessionId)).toEqual(["free"]);
  });

  it("keeps the key-workout flag on what was lost", () => {
    const sessions = [
      session({ id: "key", scheduled_date: "2026-07-02", important: true }),
      session({ id: "filler", scheduled_date: "2026-07-03", important: false }),
    ];
    const result = assessAvailability(sessions, event());
    expect(result.lostKeySessions.map((s) => s.sessionId)).toEqual(["key"]);
  });

  it("does not touch sessions outside the period", () => {
    const e = event({ start_date: "2026-08-01", end_date: "2026-08-07" });
    expect(assessAvailability(week(), e).cancelled).toHaveLength(0);
  });

  it("treats the period as inclusive on both ends", () => {
    const e = event({ start_date: "2026-07-02", end_date: "2026-07-03" });
    expect(coversDate(e, "2026-07-02")).toBe(true);
    expect(coversDate(e, "2026-07-03")).toBe(true);
    expect(coversDate(e, "2026-07-01")).toBe(false);
    expect(coversDate(e, "2026-07-04")).toBe(false);
    expect(assessAvailability(week(), e).cancelled).toHaveLength(2);
  });

  it("edge case 6 — availability changed mid-week only affects the remaining days", () => {
    const e = event({ start_date: "2026-07-04", end_date: "2026-07-05" });
    const result = assessAvailability(week(), e);
    expect(result.cancelled.map((c) => c.scheduled_date)).toEqual(["2026-07-04", "2026-07-05"]);
  });
});

// ---------------------------------------------------------------------------
// 3. A break is not a failure — the analytics contract
// ---------------------------------------------------------------------------

describe("completion counting", () => {
  it("excludes cancelled, rescheduled and replaced sessions from the denominator", () => {
    for (const status of ["cancelled_due_to_availability", "rescheduled", "replaced", "rest"] as const) {
      expect(isFailure(status), `${status} must not be a failure`).toBe(false);
      expect(countsTowardCompletion(session({ status }))).toBe(false);
    }
  });

  it("still counts a session the athlete chose to skip", () => {
    // Skipping with no availability change is real adherence information.
    expect(isFailure("skipped")).toBe(true);
    expect(countsTowardCompletion(session({ status: "skipped" }))).toBe(true);
  });

  it("counts completed and modified as done", () => {
    expect(isFailure("completed")).toBe(false);
    expect(countsTowardCompletion(session({ status: "completed" }))).toBe(true);
    expect(countsTowardCompletion(session({ status: "modified" }))).toBe(true);
  });

  it("THE REGRESSION: a two-week holiday is not fourteen failures", () => {
    // This is the bug the phase exists to fix. WeeklySummary's `planned`
    // denominator counted every plan_events row regardless of status, so a
    // holiday produced "You completed 1/14 sessions. Block two non-negotiable
    // training windows this week."
    const holiday = event({ start_date: "2026-07-01", end_date: "2026-07-14" });
    let failures = 0;
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
      const s = session({ id: `h${i}`, scheduled_date: d, status: "cancelled_due_to_availability" });
      if (countsTowardCompletion(s, [holiday]) && isFailure(s.status)) failures++;
    }
    expect(failures).toBe(0);
  });

  it("excludes an optional window even before the status has synced", () => {
    const optional = event({ allow_training: "optional" });
    const s = session({ scheduled_date: "2026-07-03", status: "planned" });
    // No life_event_id is written for an optional window (the session is not
    // cancelled), so the exclusion has to come from the dates.
    expect(isInsideAvailabilityWindow("2026-07-03", [optional])).toBe(true);
    expect(countsTowardCompletion(s, [optional])).toBe(false);
  });

  it("keeps counting sessions in a window where training is still wanted", () => {
    const stillTraining = event({ allow_training: "yes" });
    const s = session({ scheduled_date: "2026-07-03", status: "planned" });
    expect(countsTowardCompletion(s, [stillTraining])).toBe(true);
  });

  it("counts a session outside any window normally", () => {
    const s = session({ scheduled_date: "2026-09-01", status: "planned" });
    expect(countsTowardCompletion(s, [event()])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge case 8 — logging a session during a break
// ---------------------------------------------------------------------------

describe("logging a workout while a life event is active", () => {
  it("keeps a completed session completed and count it", () => {
    const holiday = event({ allow_training: "no" });
    const trained = session({
      id: "light-session",
      scheduled_date: "2026-07-03",
      status: "completed",
    });
    // The allocator must refuse to cancel it: the athlete did the work.
    expect(assessAvailability([trained], holiday).cancelled).toHaveLength(0);
    expect(countsTowardCompletion(trained, [holiday])).toBe(true);
    expect(isFailure(trained.status)).toBe(false);
  });

  it("never lets a break rewrite the training record", () => {
    // Immutability, stated as a property: for any status that is not
    // `planned`, the allocator returns it byte-identical.
    const e = event();
    const locked: PlannedSession[] = [
      session({ id: "a", scheduled_date: "2026-07-02", status: "completed" }),
      session({ id: "b", scheduled_date: "2026-07-03", status: "modified" }),
      session({ id: "c", scheduled_date: "2026-07-04", status: "skipped" }),
      session({ id: "d", scheduled_date: "2026-07-05", status: "replaced" }),
      session({ id: "e", scheduled_date: "2026-07-06", status: "rescheduled", original_scheduled_date: "2026-06-30" }),
    ];
    const result = assessAvailability(locked, e);
    for (const original of locked) {
      const out = result.adjustments.find((a) => a.sessionId === original.id)!;
      expect(out.status, `${original.id} was rewritten`).toBe(original.status);
      expect(out.reason).toBe("unchanged");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. "What changed?" explanations
// ---------------------------------------------------------------------------

describe("what changed", () => {
  it("names the period and the count, in the spec's shape", () => {
    const text = explanationFor(event({ start_date: "2026-07-05", end_date: "2026-07-12" }), 6);
    expect(text).toContain("adjusted because you added a holiday");
    expect(text).toContain("5 Jul – 12 Jul");
    expect(text).toContain("6 sessions");
  });

  it("uses the singular for one session", () => {
    expect(explanationFor(event(), 1)).toContain("1 session ");
  });

  // The three below were written after watching a real break produce them in
  // the app: "These 1 session were adjusted because you added a competition
  // from 14 Oct." It is the sentence an athlete reads straight after recording
  // a break, so it is worth being a sentence.
  it("agrees with its own number", () => {
    const one = explanationFor(event(), 1) ?? "";
    expect(one).not.toMatch(/These 1\b/);
    expect(one).toContain("1 session was adjusted");
    expect(one).toContain("It is not counted as missed");

    const many = explanationFor(event(), 4) ?? "";
    expect(many).toContain("These 4 sessions were adjusted");
    expect(many).toContain("They are not counted as missed");
  });

  it("says \"on\" for a single day and \"from\" for a range", () => {
    const oneDay = explanationFor(
      event({ event_type: "competition", start_date: "2026-10-14", end_date: "2026-10-14" }),
      1,
    ) ?? "";
    expect(oneDay).toContain("a competition on 14 Oct");
    expect(oneDay).not.toContain("from 14 Oct");

    const range = explanationFor(event({ start_date: "2026-10-14", end_date: "2026-10-18" }), 2) ?? "";
    expect(range).toContain("a holiday from 14 Oct – 18 Oct");
  });

  it("keeps the same window wording on the optional-window sentence", () => {
    const text = explanationFor(
      event({ allow_training: "optional", start_date: "2026-10-14", end_date: "2026-10-14" }),
      0,
    ) ?? "";
    expect(text).toContain("marked a holiday on 14 Oct");
    expect(text).toContain("Nothing was removed");
  });

  it("says nothing was removed for an optional window", () => {
    const text = explanationFor(event({ allow_training: "optional" }), 0);
    expect(text).toContain("Nothing was removed");
  });

  it("returns null when nothing changed and nothing is optional", () => {
    expect(explanationFor(event({ allow_training: "yes" }), 0)).toBeNull();
  });

  it("never blames the athlete", () => {
    // Phrase-level, not word-level: the copy legitimately contains "not
    // counted as missed", and a bare substring check would rule out the one
    // sentence that does the reassuring.
    const text = explanationFor(event(), 3) ?? "";
    expect(text).not.toMatch(/you (missed|failed|didn't|did not|should)|behind schedule|catch up|lazy|excuse/i);
    expect(text).toMatch(/not counted as missed/);
  });

  it("names the cause on a cancelled session's detail", () => {
    const e = event({ id: "ev-1" });
    const s = session({
      scheduled_date: "2026-07-03",
      status: "cancelled_due_to_availability",
      life_event_id: e.id,
    });
    const detail = sessionExplanation(s, [e]);
    expect(detail).toContain("holiday");
    expect(detail).toContain(formatPeriod(e.start_date, e.end_date));
  });

  it("explains a reschedule with both dates", () => {
    const s = session({
      scheduled_date: "2026-07-06",
      status: "rescheduled",
      original_scheduled_date: "2026-07-03",
    });
    const detail = sessionExplanation(s, []);
    expect(detail).toContain("3 Jul");
    expect(detail).toContain("6 Jul");
  });
});

// ---------------------------------------------------------------------------
// 6. Safeguarding
// ---------------------------------------------------------------------------

describe("safety messaging", () => {
  it("shows a supportive, non-diagnostic message for a personal break", () => {
    const notice = safetyNotice({ event_type: "wellbeing", note: null })!;
    expect(notice.level).toBe("support");
    expect(notice.body).toMatch(/part of training|counted against you/);
    // Non-diagnostic: no condition is named and no assessment is implied.
    for (const word of ["depression", "disorder", "diagnos", "overtraining", "symptom"]) {
      expect((notice.title + notice.body).toLowerCase()).not.toContain(word);
    }
  });

  it("never makes a wellbeing break feel like letting someone down", () => {
    const notice = safetyNotice({ event_type: "wellbeing", note: null })!;
    for (const word of ["failure", "fail", "guilt", "disappoint", "let down", "excuse"]) {
      expect((notice.title + notice.body).toLowerCase()).not.toContain(word);
    }
  });

  it("escalates to a human when a note suggests the athlete may be struggling", () => {
    const notice = safetyNotice({
      event_type: "wellbeing",
      note: "I can't cope with anything at the moment and I hate myself",
    })!;
    expect(notice.level).toBe("concern");
    expect(notice.action).toMatch(/trusted|parent|carer|coach|doctor/);
    // It says out loud that the app cannot assess this.
    expect(notice.body).toMatch(/can't assess|isn't trying/);
  });

  it("states plainly that it is not a health service and names real people", () => {
    const notice = safetyNotice({ event_type: "private", note: "self harm" })!;
    expect(notice.body).toMatch(/training app, not a health service/);
    expect(notice.action).toMatch(/emergency number|professional|doctor|counsellor/);
  });

  it("stays silent for an ordinary holiday", () => {
    expect(safetyNotice({ event_type: "holiday", note: "Beach, no gym" })).toBeNull();
  });

  it("flags illness and injury without diagnosing or giving medical advice", () => {
    for (const type of ["illness", "injury"] as LifeEventType[]) {
      const notice = safetyNotice({ event_type: type })!;
      expect(notice.body).toMatch(/doesn't diagnose|does not diagnose/);
      expect(notice.action).toMatch(/doctor|physiotherapist/);
      for (const word of ["you have", "syndrome", "torn", "infection", "treatment"]) {
        expect((notice.body + notice.action).toLowerCase()).not.toContain(word);
      }
    }
  });

  it("treats an empty note as silence, never as a signal", () => {
    // An athlete choosing "private" is exercising the whole point of the
    // option. Inferring distress from the absence of a note would punish it.
    expect(mentionsWellbeingConcern(null)).toBe(false);
    expect(mentionsWellbeingConcern("")).toBe(false);
    expect(mentionsWellbeingConcern("   ")).toBe(false);
    expect(mentionsWellbeingConcern("Busy at work, back at it next week")).toBe(false);
  });

  it("is a keyword net, documented as one, and not a detector", () => {
    // It is expected to miss paraphrases. This test pins that limitation so
    // nobody later reads a match as an assessment.
    expect(mentionsWellbeingConcern("I'm not in a great place")).toBe(false);
    // ...which is why the supportive message is offered without one.
    expect(safetyNotice({ event_type: "wellbeing" })).not.toBeNull();
  });

  it("gives a youth athlete permission rather than a warning", () => {
    expect(YOUTH_BREAK_NOTE).toMatch(/normal/);
    expect(YOUTH_BREAK_NOTE).toMatch(/rest/);
    for (const word of ["risk", "warn", "reduced", "decline", "lose"]) {
      expect(YOUTH_BREAK_NOTE.toLowerCase()).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Ordering and lookup
// ---------------------------------------------------------------------------

describe("lookup helpers", () => {
  it("sorts newest first", () => {
    const a = event({ id: "a", start_date: "2026-01-01", end_date: "2026-01-05" });
    const b = event({ id: "b", start_date: "2026-06-01", end_date: "2026-06-05" });
    expect(sortEvents([a, b]).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("finds the event covering a date, preferring the latest start", () => {
    const broad = event({ id: "broad", start_date: "2026-01-01", end_date: "2026-12-31" });
    const narrow = event({ id: "narrow", start_date: "2026-07-01", end_date: "2026-07-07" });
    expect(eventOnDate([broad, narrow], "2026-07-03")?.id).toBe("narrow");
    expect(eventOnDate([broad], "2026-07-03")?.id).toBe("broad");
    expect(eventOnDate([narrow], "2026-08-01")).toBeNull();
  });

  it("counts a single-day period as one day", () => {
    expect(spanDays("2026-07-01", "2026-07-01")).toBe(1);
    expect(spanDays("2026-07-01", "2026-07-07")).toBe(7);
    expect(spanDays("not-a-date", "2026-07-07")).toBe(0);
  });

  it("renders one-day and multi-day periods differently, with no UTC drift", () => {
    expect(formatPeriod("2026-07-05", "2026-07-05")).toBe("5 Jul");
    expect(formatPeriod("2026-07-05", "2026-07-12")).toBe("5 Jul – 12 Jul");
  });

  it("maps a period to one of three kinds the styling and copy share", () => {
    expect(availabilityKind(event({ allow_training: "no" }))).toBe("paused");
    expect(availabilityKind(event({ allow_training: "optional" }))).toBe("optional");
    expect(availabilityKind(event({ allow_training: "yes" }))).toBe("training");
  });
});

// ---------------------------------------------------------------------------
// The projection join — a break against a real plan, not a hand-built list
// ---------------------------------------------------------------------------
// Everything above tests the rules against sessions written by hand. These test
// the join the app actually performs: `training_plans.plan_data` projected onto
// real dates, folded together with whatever `plan_events` already records. That
// is where a holiday once became fourteen counted failures, so it is asserted
// end to end rather than assumed.

describe("a break against a projected plan", () => {
  /** A six-week plan, one session a day, anchored on Monday 5 October 2026. */
  const plan = (): TrainingPlanLike => ({
    id: "plan-1",
    created_at: new Date(2026, 9, 7).toISOString(), // Wednesday
    week_current: 1,
    duration_weeks: 6,
    plan_data: [1, 2, 3, 4, 5, 6].map((w) => ({
      week: w,
      sessions: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
        day: d,
        title: `W${w}D${d}`,
        // Sunday is the programmed rest day, as the real generator writes it.
        type: d === 7 ? "rest" : d === 2 ? "intervals" : "endurance",
        isRest: d === 7,
      })),
    })),
  });

  const covered = (start: string, end: string) =>
    flattenPlan(plan()).filter((s) => s.scheduled_date >= start && s.scheduled_date <= end);

  it("dates week 1 on the Monday of the week the plan was created", () => {
    const first = flattenPlan(plan())[0];
    expect(first.scheduled_date).toBe("2026-10-05");
  });

  it("cancels only the sessions inside a one-day break", () => {
    const result = assessAvailability(
      covered("2026-10-07", "2026-10-07").map((s) => asPlannedSession(s)),
      event({ id: "one-day", start_date: "2026-10-07", end_date: "2026-10-07", allow_training: "no" }),
    );
    expect(result.cancelled.map((a) => a.scheduled_date)).toEqual(["2026-10-07"]);
  });

  it("cancels exactly the six sessions inside a seven-day holiday", () => {
    // Sunday 11 October is a rest day, so seven calendar days hold six sessions
    // that could be trained at all.
    const result = assessAvailability(
      covered("2026-10-05", "2026-10-11").map((s) => asPlannedSession(s)),
      event({ id: "week-off", start_date: "2026-10-05", end_date: "2026-10-11", allow_training: "no" }),
    );
    expect(result.cancelled).toHaveLength(6);
    expect(result.cancelled.some((a) => a.scheduled_date === "2026-10-11")).toBe(false);
  });

  it("handles a four-week break without touching the plan before or after it", () => {
    const whole = flattenPlan(plan()).map((s) => asPlannedSession(s));
    const result = assessAvailability(
      whole,
      event({ id: "four-weeks", start_date: "2026-10-12", end_date: "2026-11-08", allow_training: "no" }),
    );

    const cancelled = new Set(result.cancelled.map((a) => a.scheduled_date));
    // Weeks 2–5 are covered; week 1 is behind it and week 6 ahead of it.
    expect(cancelled.has("2026-10-11")).toBe(false); // last day of week 1
    expect(cancelled.has("2026-10-12")).toBe(true); // first day of week 2
    expect(cancelled.has("2026-11-07")).toBe(true); // last training day of week 5
    // The break's own last day is a Sunday, and Sundays are programmed rest.
    // Rest is never a loss, however long the break around it.
    expect(cancelled.has("2026-11-08")).toBe(false);
    expect(cancelled.has("2026-11-09")).toBe(false); // first day of week 6
    // And nothing was moved: every session keeps the date the plan gave it.
    expect(result.adjustments.every((a) => whole.some((s) => s.scheduled_date === a.scheduled_date))).toBe(true);
  });

  it("keeps a holiday's options open when the athlete still wants to train", () => {
    const optional = assessAvailability(
      covered("2026-10-05", "2026-10-11").map((s) => asPlannedSession(s)),
      event({ id: "opt", start_date: "2026-10-05", end_date: "2026-10-11", allow_training: "optional" }),
    );
    expect(optional.cancelled).toHaveLength(0);
    // Nothing is written, but the sessions are excluded from the denominator.
    expect(optional.adjustments.some((a) => a.reason === "optional_window")).toBe(true);

    const yes = assessAvailability(
      covered("2026-10-05", "2026-10-11").map((s) => asPlannedSession(s)),
      event({ id: "yes", start_date: "2026-10-05", end_date: "2026-10-11", allow_training: "yes" }),
    );
    expect(yes.adjustments.every((a) => a.reason === "unchanged")).toBe(true);
  });

  it("is idempotent: re-saving the same break rewrites nothing", () => {
    // Second save of a break whose sessions the app already marked. The status
    // is what decides, which is why the write path can call this every time.
    const already = covered("2026-10-05", "2026-10-11").map((s) =>
      asPlannedSession(s, { id: `row-${s.scheduled_date}`, status: "cancelled_due_to_availability" }),
    );
    const result = assessAvailability(
      already,
      event({ id: "again", start_date: "2026-10-05", end_date: "2026-10-11", allow_training: "no" }),
    );
    expect(result.adjustments.every((a) => a.reason === "unchanged")).toBe(true);
    expect(result.adjustments.every((a) => a.sessionId.startsWith("row-"))).toBe(true);
  });

  it("leaves a session another event already claimed to the event that got it", () => {
    const mixed = covered("2026-10-05", "2026-10-11").map((s) =>
      s.scheduled_date === "2026-10-06"
        ? asPlannedSession(s, { id: "row-06", status: "cancelled_due_to_availability" })
        : asPlannedSession(s),
    );
    const result = assessAvailability(
      mixed,
      event({ id: "second", start_date: "2026-10-05", end_date: "2026-10-11", allow_training: "no" }),
    );

    // `cancelled` counts what the window now holds, which is why the Thursday
    // is listed. What must not happen is a second write: `reason` is what the
    // write path filters on, and only the five still-planned sessions carry
    // `unavailable`.
    const writable = result.adjustments.filter((a) => a.reason === "unavailable");
    expect(writable.map((a) => a.scheduled_date)).not.toContain("2026-10-06");
    expect(writable).toHaveLength(5);
    expect(result.cancelled.find((a) => a.scheduled_date === "2026-10-06")?.reason).toBe("unchanged");
  });

  it("marks the key sessions among the losses, for the re-planner", () => {
    const result = assessAvailability(
      covered("2026-10-05", "2026-10-11").map((s) => asPlannedSession(s)),
      event({ id: "week-off", start_date: "2026-10-05", end_date: "2026-10-11", allow_training: "no" }),
    );
    // Day 2 of the plan's week is typed `intervals`, and a lost interval
    // session is the loss a later phase has to rebuild.
    expect(result.lostKeySessions.map((a) => a.scheduled_date)).toEqual(["2026-10-06"]);
    expect(result.adjustments.find((a) => a.scheduled_date === "2026-10-06")?.important).toBe(true);
  });
});
