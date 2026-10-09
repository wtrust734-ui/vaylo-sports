// Tests for the database-facing half of the recovery read.
//
// `recoveryAdjust.test.ts` covers the rules and `sessionLoad.test.ts` covers the
// load model, both without a database. This file covers the plumbing, which is
// where the bugs that never throw live: a null load read as zero, a session
// from `workouts` ignored so an imported match goes unseen, a plan projected
// onto the wrong days. All of them would leave the screen looking fine and
// being wrong.
//
// supabase-js is mocked at the module boundary — the same approach
// `adaptivePlanning.test.ts` takes — so the real queries run against a small
// in-memory table store.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Chain {
  select: () => Chain;
  eq: (column: string, value: unknown) => Chain;
  is: (column: string, value: unknown) => Chain;
  gte: (column: string, value: unknown) => Chain;
  lte: (column: string, value: unknown) => Chain;
  order: () => Chain;
  limit: (n: number) => Chain;
  then: (resolve: (value: { data: Row[]; error: null }) => unknown) => unknown;
}

const db = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const from = (table: string): Chain => {
    const filters: ((row: Row) => boolean)[] = [];
    let limit: number | null = null;
    const run = () => {
      const found = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      return limit === null ? found : found.slice(0, limit);
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === (value ?? null));
        return chain;
      },
      gte: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) >= String(value));
        return chain;
      },
      lte: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) <= String(value));
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    } as unknown as Chain;
    return chain;
  };
  return {
    tables,
    from,
    reset() {
      for (const key of Object.keys(tables)) delete tables[key];
    },
    seed(table: string, rows: Row[]) {
      tables[table] = rows;
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

import { cachedRecoveryRead, correctedSportColumns, loadColumnsFor, loadRecoveryFacts, projectSessions, readRecoveryForPlan, shouldRecalculate } from "./recoveryPlanning";
import { decideForWeek } from "./recoveryAdjust";
import { lsSet } from "./localStore";
import type { TrainingPlanLike } from "./planSchedule";

const TODAY = "2026-10-05"; // a Monday
const anchor = () => new Date(...([2026, 9, 5] as [number, number, number])).toISOString();

const plan = (weeks: Row[] = []): TrainingPlanLike =>
  ({
    id: "p1",
    user_id: "u1",
    title: "Plan",
    sport: "Running",
    goal: "Endurance",
    level: "beginner",
    duration_weeks: 6,
    description: "",
    plan_data: weeks,
    week_current: 1,
    active: true,
    created_at: anchor(),
    updated_at: anchor(),
    plan_adjustments: [],
  }) as unknown as TrainingPlanLike;

const session = (day: number, title: string, type: string, duration = 45): Row => ({
  day,
  dayName: "Monday",
  title,
  type,
  duration_minutes: duration,
  description: "",
  warmup: [],
  exercises: [],
  cooldown: [],
});

const week = (n: number, sessions: Row[]): Row => ({ week: n, sessions, isDeload: false, isHoliday: false });

beforeEach(() => db.reset());

describe("loadRecoveryFacts — reading both session tables", () => {
  it("reads performance logs and workouts into one load list", async () => {
    db.seed("performance_logs", [{ user_id: "u1", log_date: "2026-10-04", sport: "Running", title: "Easy run", session_load: 45 }]);
    db.seed("workouts", [
      { user_id: "u1", completed: true, completed_at: "2026-10-03T18:00:00.000Z", created_at: "2026-10-03T18:00:00.000Z", sport: "football", type: "sport", title: "Match", session_load: 126 },
    ]);
    const facts = await loadRecoveryFacts({ userId: "u1", today: TODAY });
    expect(facts.loads).toHaveLength(2);
    expect(facts.loads.map((l) => l.source).sort()).toEqual(["performance_log", "workout"]);
  });

  it("keeps a null load as null instead of reading it as zero", async () => {
    // A session with no stored load is a session the model could not price.
    // Reading it as 0 would make an athlete who logged an unpriceable session
    // look like one who did nothing at all.
    db.seed("performance_logs", [{ user_id: "u1", log_date: "2026-10-04", sport: "Running", session_load: null }]);
    db.seed("workouts", []);
    const facts = await loadRecoveryFacts({ userId: "u1", today: TODAY });
    expect(facts.loads[0].load).toBeNull();
  });

  it("excludes a completed session with no completion date, which is not in the window", async () => {
    // The query restricts `completed_at` to the range, so a row without one
    // cannot come back — and it should not: an unfinished session has no day to
    // attribute its load to.
    db.seed("workouts", [{ user_id: "u1", completed: true, completed_at: null, created_at: "2026-10-02T08:00:00.000Z", session_load: 30 }]);
    db.seed("performance_logs", []);
    const facts = await loadRecoveryFacts({ userId: "u1", today: TODAY });
    expect(facts.loads).toEqual([]);
  });

  it("reads every recovery column the rules use, including sleep duration", async () => {
    db.seed("recovery_logs", [
      { user_id: "u1", log_date: TODAY, sleep_quality: 3, fatigue: 9, soreness: 8, mood: 4, stress: 7, energy: 2, rest_hours: 5.5, hrv: 42, readiness_score: 38 },
    ]);
    const facts = await loadRecoveryFacts({ userId: "u1", today: TODAY });
    expect(facts.recovery[0]).toMatchObject({ sleep_quality: 3, fatigue: 9, rest_hours: 5.5, hrv: 42, readiness_score: 38 });
  });

  it("carries life events and competitions through as hard constraints", async () => {
    db.seed("life_events", [
      { id: "e1", user_id: "u1", start_date: "2026-10-05", end_date: "2026-10-12", event_type: "holiday", activity_level: "none", allow_training: "no", note: null, created_at: TODAY, updated_at: TODAY },
    ]);
    db.seed("events", [{ user_id: "u1", title: "City Half", event_date: "2026-10-20" }]);
    const facts = await loadRecoveryFacts({ userId: "u1", today: TODAY });
    expect(facts.events).toHaveLength(1);
    expect(facts.competitions).toEqual([{ title: "City Half", date: "2026-10-20" }]);
  });

  it("returns an empty, usable fact set when nothing is logged", async () => {
    // Not an error. An athlete who has logged nothing gets the honest
    // "not enough information" answer rather than a broken screen.
    const facts = await loadRecoveryFacts({
      userId: "u1",
      plan: plan([week(1, [session(1, "Tempo Run", "tempo", 45)])]),
      today: TODAY,
    });
    expect(facts.loads).toEqual([]);
    expect(facts.recovery).toEqual([]);
    expect(facts.competitions).toEqual([]);
    const result = decideForWeek(facts.sessions, facts);
    expect(result.uncertainty).toContain("don't have enough information");
    expect(result.decisions[0].action).toBe("insufficient");
  });

  it("says nothing at all when there is no plan to read", async () => {
    // No sessions means there is nothing to be uncertain *about*. Telling an
    // athlete "I don't have enough information to confidently adjust this
    // session" when they have no plan would be a sentence about nothing.
    const facts = await loadRecoveryFacts({ userId: "u1", today: TODAY });
    expect(facts.sessions).toEqual([]);
    expect(decideForWeek(facts.sessions, facts).uncertainty).toBeNull();
  });
});

describe("projectSessions — the plan onto real dates", () => {
  it("projects week and day onto the calendar the plan is anchored to", () => {
    const sessions = projectSessions(plan([week(1, [session(1, "Easy Run", "endurance"), session(3, "Intervals", "intervals")])]));
    expect(sessions.map((s) => s.date)).toEqual(["2026-10-05", "2026-10-07"]);
    expect(sessions[1].durationMinutes).toBe(45);
  });

  it("carries Phase 2's protected-session flag through, so both layers agree", () => {
    const sessions = projectSessions(
      plan([week(1, [{ ...session(1, "Intervals", "intervals"), key: true }, session(2, "Jog", "endurance")])]),
    );
    expect(sessions[0].key).toBe(true);
    expect(sessions[1].key).toBe(false);
  });

  it("reads the rebuild week off a session Phase 2 tagged", () => {
    const sessions = projectSessions(
      plan([week(1, [{ ...session(1, "Easy", "endurance"), returnFromBreak: { weekBack: 2 } }, session(2, "Jog", "endurance")])]),
    );
    expect(sessions[0].returnWeekBack).toBe(2);
    expect(sessions[1].returnWeekBack).toBeNull();
  });

  it("falls back to the derived importance flag when a session has no explicit key", () => {
    // Phase 1 derived importance from the session type; Phase 2 wrote an
    // explicit `key`. Both have to count, or a protected session stops being
    // protected for anyone on an older plan.
    const sessions = projectSessions(plan([week(1, [session(1, "Intervals", "intervals"), session(2, "Jog", "endurance")])]));
    expect(sessions[0].key).toBe(true);
    expect(sessions[1].key).toBe(false);
  });

  it("treats a rest day as rest", () => {
    const sessions = projectSessions(plan([week(1, [{ ...session(1, "Rest", "rest", 0), isRest: true }])]));
    expect(sessions[0].isRest).toBe(true);
  });
});

describe("readRecoveryForPlan", () => {
  it("produces a decision the screen can render, with the facts behind it", async () => {
    db.seed("recovery_logs", [{ user_id: "u1", log_date: TODAY, sleep_quality: 2, fatigue: 9, readiness_score: 35, soreness: 6, mood: 4, stress: 5, energy: 3, rest_hours: 5 }]);
    db.seed("performance_logs", [
      { user_id: "u1", log_date: "2026-09-20", sport: "Running", session_load: 50 },
      { user_id: "u1", log_date: "2026-09-22", sport: "Running", session_load: 55 },
      { user_id: "u1", log_date: "2026-09-24", sport: "Running", session_load: 50 },
      { user_id: "u1", log_date: "2026-10-03", sport: "Running", session_load: 140 },
    ]);
    db.seed("workouts", []);

    const result = await readRecoveryForPlan({
      userId: "u1",
      plan: plan([week(1, [session(1, "Tempo Run", "tempo", 45)])]),
      today: TODAY,
    });
    expect(result.facts.loads.length).toBe(4);
    expect(result.week.decisions).toHaveLength(1);
    expect(result.week.decisions[0].evidence.length).toBeGreaterThan(0);
  });
});

describe("offline — §8", () => {
  it("caches the read so it can be shown without a connection", async () => {
    db.seed("recovery_logs", [{ user_id: "u1", log_date: TODAY, sleep_quality: 2, fatigue: 9, readiness_score: 30, soreness: 6, mood: 4, stress: 5, energy: 3, rest_hours: 5 }]);
    db.seed("performance_logs", []);
    db.seed("workouts", []);

    const read = await readRecoveryForPlan({
      userId: "u1",
      plan: plan([week(1, [session(1, "Tempo Run", "tempo", 45)])]),
      today: TODAY,
    });
    expect(read).not.toBeNull();

    const cached = cachedRecoveryRead("u1", "p1", TODAY);
    expect(cached).not.toBeNull();
    expect(cached!.week.decisions).toHaveLength(1);
    // The explanation quotes the athlete's numbers, so they have to survive
    // too — a cached suggestion with no supporting evidence reads as invention.
    expect(cached!.facts.recovery[0].readiness_score).toBe(30);
  });

  it("does not serve one day's read on another day", async () => {
    db.seed("performance_logs", []);
    db.seed("workouts", []);
    await readRecoveryForPlan({ userId: "u1", plan: plan([week(1, [session(1, "Tempo", "tempo")])]), today: TODAY });
    expect(cachedRecoveryRead("u1", "p1", TODAY)).not.toBeNull();
    // A different day is a different question, and yesterday's answer must not
    // be presented as today's.
    expect(cachedRecoveryRead("u1", "p1", "2026-10-06")).toBeNull();
  });

  it("ignores a cache entry that is the wrong shape rather than crashing", () => {
    lsSet("vaylo_recovery_read_v1:u1:p1:2026-10-05", { nonsense: true });
    expect(cachedRecoveryRead("u1", "p1", "2026-10-05")).toBeNull();
  });

  it("has no cache to serve without a plan", () => {
    expect(cachedRecoveryRead("u1", undefined, TODAY)).toBeNull();
  });
});

describe("loadColumnsFor — writing a load at log time", () => {
  it("prices a session from what the athlete recorded, not what was planned", () => {
    const columns = loadColumnsFor({ sport: "Running", durationMinutes: 60, rpe: 6 });
    expect(columns.session_load).toBe(60);
  });

  it("writes null rather than zero for a session it cannot price", () => {
    // `Number(null)` is 0. A missing duration must not become a zero-minute
    // session, which downstream reads as "this athlete did nothing".
    expect(loadColumnsFor({ sport: "Running", durationMinutes: null, rpe: 6 }).session_load).toBeNull();
    expect(loadColumnsFor({ sport: "Running", durationMinutes: undefined, rpe: 6 }).session_load).toBeNull();
    expect(loadColumnsFor({}).session_load).toBeNull();
  });

  it("still accepts a numeric string, because a form field arrives as one", () => {
    expect(loadColumnsFor({ sport: "Running", durationMinutes: "60" as unknown as number, rpe: 6 }).session_load).toBe(60);
  });

  it("never writes a negative or non-finite load", () => {
    for (const input of [
      { sport: "Running", durationMinutes: 0, rpe: 1 },
      { sport: "Strength", durationMinutes: -30, rpe: 0 },
      { sport: "Swimming", distanceKm: -5, durationMinutes: 30, rpe: 5 },
    ]) {
      const { session_load } = loadColumnsFor(input);
      if (session_load !== null) {
        expect(Number.isFinite(session_load)).toBe(true);
        expect(session_load).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("correctedSportColumns — re-pricing a session whose sport was wrong", () => {
  it("re-prices when the corrected sport can be priced", () => {
    // The verified live case: a 65-minute ride corrected to a run.
    expect(correctedSportColumns({ durationMinutes: 65, distanceKm: 30 }, "Running")).toEqual({
      sport: "Running",
      session_load: 65,
    });
    // RPE 8 is the "hard" band, factor 1.35: 45 × 1.35 = 60.75 → 61.
    expect(correctedSportColumns({ durationMinutes: 45, rpe: 8 }, "Running").session_load).toBe(61);
  });

  it("omits the load rather than writing null when the sport cannot be priced", () => {
    // A strength session needs lifted volume or an effort figure. Writing the
    // null through would erase a load the athlete may already have seen, and the
    // queued update only sends the keys it is handed, so an omitted key cannot
    // overwrite the stored one.
    const columns = correctedSportColumns({ durationMinutes: 65, distanceKm: 30 }, "Strength");
    expect(columns).toEqual({ sport: "Strength" });
    expect("session_load" in columns).toBe(false);
  });
});

describe("shouldRecalculate", () => {
  it("recomputes only when there is no load to preserve", () => {
    expect(shouldRecalculate(null)).toBe(true);
    expect(shouldRecalculate(undefined)).toBe(true);
    // A stored number is a historical record and is not revised after the fact.
    expect(shouldRecalculate(0)).toBe(false);
    expect(shouldRecalculate(120)).toBe(false);
  });
});