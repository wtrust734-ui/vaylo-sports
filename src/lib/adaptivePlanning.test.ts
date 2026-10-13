// Tests for the database-facing half of the adaptive rebuild.
//
// `adaptivePlan.test.ts` covers the rules; this file covers the plumbing, which
// is where the bugs that never throw live: a break credited at double weight, a
// recovery read that quietly turns into "always poor", a rebuild that runs twice,
// an undo offered for a rebuild that is not the latest. All of them would leave
// the plan looking fine and being wrong.
//
// supabase-js is mocked at the module boundary — the same approach
// `offlineQueue.test.ts` takes — so the real functions are exercised against a
// tiny in-memory table store rather than asserted about in source.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Chain {
  select: () => Chain;
  eq: (column: string, value: unknown) => Chain;
  gte: (column: string, value: unknown) => Chain;
  lte: (column: string, value: unknown) => Chain;
  in: (column: string, values: unknown[]) => Chain;
  is: (column: string, value: unknown) => Chain;
  order: () => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  update: (values: Row) => Chain;
  then: (resolve: (value: { data: Row[]; error: null } | { error: null }) => unknown) => unknown;
}

const db = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const writes: { table: string; values: Row; id: string }[] = [];

  const updateChain = (table: string, values: Row): Chain => {
    let id = "";
    const chain = {
      eq: (column: string, value: unknown) => {
        if (column === "id") id = String(value);
        return chain;
      },
      then: (resolve: (value: { error: null }) => unknown) => {
        writes.push({ table, values, id });
        return resolve({ error: null });
      },
    } as unknown as Chain;
    return chain;
  };

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
      gte: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) >= String(value));
        return chain;
      },
      lte: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) <= String(value));
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      is: (column: string, value: unknown) => {
        // supabase's `.is()` is SQL IS, so a null filter matches null and
        // undefined alike — which is what the cross-sport attribution read
        // relies on to find sessions logged without a plan.
        filters.push((row) => (row[column] ?? null) === (value ?? null));
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      update: (values: Row) => updateChain(table, values),
      // Awaiting the builder runs the query, exactly as supabase-js does.
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    } as unknown as Chain;
    return chain;
  };

  return {
    tables,
    writes,
    from,
    reset() {
      for (const key of Object.keys(tables)) delete tables[key];
      writes.length = 0;
    },
    seed(table: string, rows: Row[]) {
      tables[table] = rows;
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

import {
  ageFromDateOfBirth,
  breakBriefForGenerator,
  breakFacts,
  loadReturnContext,
  planWeekStart,
  rebuildPlanForBreak,
  undoPlanRebuild,
} from "./adaptivePlanning";
import { activeAdjustments, creditedDays } from "./adaptivePlan";
import { clearQueue } from "./offlineQueue";
import { localDateKey } from "./dates";
import type { LifeEvent } from "./lifeEvents";
import type { PlanWeekLike } from "./planSchedule";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = "2026-10-05"; // a Monday

/** The Monday of the week containing today, which is what the plan anchors on. */
const anchorIso = () => new Date(...([2026, 9, 5] as [number, number, number])).toISOString();

const session = (day: number, title: string, type: string, duration = 60): Row => ({
  day,
  dayName: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1],
  title,
  type,
  duration_minutes: duration,
  description: `${title}.`,
  skipped: false,
});

const rest = (day: number): Row => ({
  day,
  dayName: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1],
  title: "Rest Day",
  type: "rest",
  duration_minutes: 0,
  isRest: true,
});

const week = (n: number): Row => ({
  week: n,
  isDeload: false,
  sessions: [session(1, "Speed Work", "speed"), rest(2), session(3, "Interval Training", "intervals"), rest(4), session(5, "Strength Training", "strength"), rest(6), session(7, "Long Run", "endurance")],
});

const planData = (weeks = 6): Row[] => Array.from({ length: weeks }, (_, i) => week(i + 1));

const planRow = (data: Row[] | null = planData(), adjustments: unknown[] = []) => ({
  id: "p1",
  created_at: anchorIso(),
  plan_data: data,
  plan_adjustments: adjustments,
});

const holiday = (overrides: Partial<LifeEvent> = {}): LifeEvent =>
  ({
    id: "ev-1",
    user_id: "u1",
    start_date: "2026-10-12",
    end_date: "2026-10-18",
    event_type: "holiday",
    activity_level: "none",
    allow_training: "no",
    note: null,
    created_at: TODAY,
    updated_at: TODAY,
    ...overrides,
  }) as LifeEvent;

beforeEach(() => {
  db.reset();
  clearQueue();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// The small pure helpers
// ---------------------------------------------------------------------------

describe("ageFromDateOfBirth", () => {
  const born = (yearsAgo: number, dayOffset = 0): string => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - yearsAgo);
    date.setDate(date.getDate() + dayOffset);
    return localDateKey(date);
  };

  it("counts completed years, not the year of birth", () => {
    expect(ageFromDateOfBirth(born(30))).toBe(30);
    expect(ageFromDateOfBirth(born(30, -1))).toBe(30); // birthday was yesterday
    expect(ageFromDateOfBirth(born(30, 1))).toBe(29); // birthday is tomorrow
  });

  it("returns null rather than a guess when it cannot know", () => {
    expect(ageFromDateOfBirth(null)).toBeNull();
    expect(ageFromDateOfBirth(undefined)).toBeNull();
    expect(ageFromDateOfBirth("")).toBeNull();
    expect(ageFromDateOfBirth("not a date")).toBeNull();
  });

  it("reads a timestamp-shaped date of birth, which is what the column holds", () => {
    expect(ageFromDateOfBirth(`${born(14)}T00:00:00.000Z`)).toBe(14);
  });
});

describe("breakFacts", () => {
  it("counts the break inclusively, which is how the bands are written", () => {
    expect(breakFacts(holiday()).days).toBe(7);
    expect(breakFacts(holiday({ start_date: "2026-10-12", end_date: "2026-10-12" })).days).toBe(1);
    expect(breakFacts(holiday({ start_date: "2026-10-12", end_date: "2026-11-08" })).days).toBe(28);
  });

  it("carries the athlete's own answers through untouched", () => {
    const facts = breakFacts(holiday({ activity_level: "light", allow_training: "optional", event_type: "exams" }));
    expect(facts).toMatchObject({
      eventId: "ev-1",
      eventType: "exams",
      activityLevel: "light",
      allowTraining: "optional",
    });
  });
});

describe("planWeekStart", () => {
  it("anchors week 1 on the Monday of the plan's creation week", () => {
    const start = planWeekStart(planRow());
    expect(start(1)).toBe(TODAY);
    expect(start(3)).toBe("2026-10-19");
  });
});

// ---------------------------------------------------------------------------
// The context reads
// ---------------------------------------------------------------------------

describe("loadReturnContext", () => {
  it("falls back to conservative defaults when there is nothing to read", async () => {
    const context = await loadReturnContext({
      userId: "u1",
      planId: "p1",
      facts: breakFacts(holiday()),
      age: null,
      today: TODAY,
    });
    expect(context.age).toBeNull();
    expect(context.recoveryPoor).toBeUndefined();
    // Undefined rather than zero: nothing read is not the same as nothing done.
    expect(context.consistentWeeksBefore).toBeUndefined();
    expect(context.activeDaysSameSport).toBe(0);
    expect(context.activeDaysOtherSport).toBe(0);
  });

  it("reads poor recovery from the athlete's own last three logs", async () => {
    db.seed("recovery_logs", [
      { user_id: "u1", readiness_score: 40 },
      { user_id: "u1", readiness_score: 52 },
      { user_id: "u1", readiness_score: 46 },
    ]);
    const poor = await loadReturnContext({ userId: "u1", planId: "p1", facts: breakFacts(holiday()), today: TODAY });
    expect(poor.recoveryPoor).toBe(true);

    db.seed("recovery_logs", [
      { user_id: "u1", readiness_score: 80 },
      { user_id: "u1", readiness_score: 75 },
      { user_id: "u1", readiness_score: 90 },
    ]);
    const fine = await loadReturnContext({ userId: "u1", planId: "p1", facts: breakFacts(holiday()), today: TODAY });
    expect(fine.recoveryPoor).toBe(false);
  });

  it("takes the reason for the break as the medical flag, without asking again", async () => {
    const illness = await loadReturnContext({
      userId: "u1", planId: "p1", facts: breakFacts(holiday({ event_type: "illness" })), today: TODAY,
    });
    expect(illness.medical).toBe(true);

    const injury = await loadReturnContext({
      userId: "u1", planId: "p1", facts: breakFacts(holiday({ event_type: "injury" })), today: TODAY,
    });
    expect(injury.medical).toBe(true);

    const holidayBreak = await loadReturnContext({
      userId: "u1", planId: "p1", facts: breakFacts(holiday()), today: TODAY,
    });
    expect(holidayBreak.medical).toBe(false);
  });

  it("reports no consistency figure at all when there is no history to judge from", async () => {
    // An athlete with no logs is unknown, not untrained — and treating unknown
    // as untrained would give a new athlete a *fuller* first week back than a
    // well-logged one.
    const context = await loadReturnContext({ userId: "u1", planId: "p1", facts: breakFacts(holiday()), today: TODAY });
    expect(context.consistentWeeksBefore).toBeUndefined();
  });

  it("ignores unreadable readiness values rather than treating them as zero", async () => {
    db.seed("recovery_logs", [{ user_id: "u1", readiness_score: null }, { user_id: "u1", readiness_score: 88 }]);
    const context = await loadReturnContext({ userId: "u1", planId: "p1", facts: breakFacts(holiday()), today: TODAY });
    expect(context.recoveryPoor).toBe(false);
  });

  it("counts only whole weeks of at least three logged days", async () => {
    db.seed("training_loads", [
      // Week of 21 Sep: three days → consistent.
      { user_id: "u1", log_date: "2026-09-21" }, { user_id: "u1", log_date: "2026-09-23" }, { user_id: "u1", log_date: "2026-09-25" },
      // Week of 28 Sep: two days → not consistent.
      { user_id: "u1", log_date: "2026-09-29" }, { user_id: "u1", log_date: "2026-10-01" },
    ]);
    const context = await loadReturnContext({ userId: "u1", planId: "p1", facts: breakFacts(holiday()), today: TODAY });
    expect(context.consistentWeeksBefore).toBe(1);
  });

  it("credits days logged against this plan in full, and separates identified from unidentified sport", async () => {
    // A break that has already happened, because activity can only have been
    // logged during a break that is behind the athlete.
    const past = breakFacts(holiday({ start_date: "2026-09-14", end_date: "2026-09-20" }));
    db.seed("training_loads", [
      { user_id: "u1", log_date: "2026-09-15" }, // during the break, logged against this plan
      { user_id: "u1", log_date: "2026-09-17" }, // during the break, another sport, identified
      { user_id: "u1", log_date: "2026-09-19" }, // during the break, sport not recorded
      { user_id: "u1", log_date: "2026-09-25" }, // after the break — credited not at all
    ]);
    db.seed("workouts", [
      { user_id: "u1", training_plan_id: "p1", completed_at: "2026-09-15T09:00:00.000Z" },
      // Phase 3: this row names its sport, so it is identified rather than
      // assumed to be "some other plan".
      { user_id: "u1", training_plan_id: null, sport: "Swimming", completed_at: "2026-09-17T09:00:00.000Z" },
      // This one does not, so it stays on the older half-credit reading.
      { user_id: "u1", training_plan_id: null, sport: null, type: null, completed_at: "2026-09-19T09:00:00.000Z" },
    ]);

    const context = await loadReturnContext({ userId: "u1", planId: "p1", facts: past, today: TODAY });
    expect(context.activeDaysSameSport).toBe(1);
    // Both unattributed days still count as other-sport activity...
    expect(context.activeDaysOtherSport).toBe(2);
    // ...but only the swimming day could be actually identified.
    expect(context.attributedOtherSportDays).toBe(1);
  });

  it("gives an identified cross-sport day more credit than an unidentified one", async () => {
    const past = breakFacts(holiday({ start_date: "2026-09-14", end_date: "2026-09-20" }));
    db.seed("training_loads", [
      { user_id: "u1", log_date: "2026-09-17" },
      { user_id: "u1", log_date: "2026-09-19" },
    ]);
    db.seed("workouts", [
      { user_id: "u1", training_plan_id: null, sport: "Swimming", completed_at: "2026-09-17T09:00:00.000Z" },
      { user_id: "u1", training_plan_id: null, sport: null, completed_at: "2026-09-19T09:00:00.000Z" },
    ]);

    const context = await loadReturnContext({ userId: "u1", planId: "p1", facts: past, today: TODAY });
    // 0.75 for the swim, 0.5 for the unnamed session.
    expect(creditedDays(past, context)).toBeCloseTo(1.25, 5);
  });

  it("never credits more than half the break, however much was logged", async () => {
    const past = breakFacts(holiday({ start_date: "2026-09-14", end_date: "2026-09-20" }));
    db.seed("training_loads", Array.from({ length: 7 }, (_, i) => ({ user_id: "u1", log_date: `2026-09-${14 + i}` })));
    db.seed("workouts", []);
    const context = await loadReturnContext({ userId: "u1", planId: "p1", facts: past, today: TODAY });
    expect(creditedDays(past, context)).toBeLessThanOrEqual(past.days * 0.5);
  });
});

// ---------------------------------------------------------------------------
// The generator brief
// ---------------------------------------------------------------------------

describe("breakBriefForGenerator", () => {
  it("lists the breaks the generator has to know about", async () => {
    db.seed("life_events", [holiday() as unknown as Row]);
    const brief = await breakBriefForGenerator({ userId: "u1", age: 30, today: TODAY });
    expect(brief.breaks).toHaveLength(1);
    expect(brief.breaks[0]).toMatchObject({ from: "2026-10-12", to: "2026-10-18", days: 7 });
    expect(brief.breaks[0].label).toContain("no training");
  });

  it("computes the progression for a break the athlete is still coming back from", async () => {
    // Eight days away, ending nine days ago: still recent enough to be the
    // reason the athlete is coming back.
    db.seed("life_events", [holiday({ start_date: "2026-09-19", end_date: "2026-09-26" }) as unknown as Row]);
    const brief = await breakBriefForGenerator({ userId: "u1", age: 30, today: TODAY });
    expect(brief.returnEvent).not.toBeNull();
    // Eight days away is a fortnight: two weeks back, starting under 60%.
    expect(brief.returns[0].weeks).toEqual([
      { volumePct: 55, intensityPct: 65 },
      { volumePct: 75, intensityPct: 80 },
    ]);
  });

  it("says nothing about a break so old that it is no longer the reason", async () => {
    db.seed("life_events", [holiday({ start_date: "2026-08-01", end_date: "2026-08-10" }) as unknown as Row]);
    const brief = await breakBriefForGenerator({ userId: "u1", age: 30, today: TODAY });
    expect(brief.returnEvent).toBeNull();
    expect(brief.returns).toEqual([]);
  });

  it("says nothing about a break too short to have cost anything", async () => {
    db.seed("life_events", [holiday({ start_date: "2026-10-01", end_date: "2026-10-02" }) as unknown as Row]);
    const brief = await breakBriefForGenerator({ userId: "u1", age: 30, today: TODAY });
    expect(brief.returns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Applying and undoing
// ---------------------------------------------------------------------------

describe("rebuildPlanForBreak", () => {
  it("rebuilds the weeks after the break and stores the record with it", async () => {
    const plan = planRow();
    const result = await rebuildPlanForBreak({ userId: "u1", plan, event: holiday(), age: 30, today: TODAY });

    expect(result.ok).toBe(true);
    expect(result.outcome!.reason).toBe("applied");

    const write = db.writes.find((w) => w.table === "training_plans");
    expect(write).toBeDefined();
    expect(write!.id).toBe("p1");

    const written = write!.values.plan_data as PlanWeekLike[];
    const rebuiltWeek = written[2];
    expect(rebuiltWeek.returnFromBreak).toMatchObject({ volumePct: 70, focus: "rebuild" });
    expect(rebuiltWeek.sessions.find((s) => s.day === 1)!.duration_minutes).toBe(40);

    const adjustments = activeAdjustments(write!.values.plan_adjustments);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].lifeEventId).toBe("ev-1");
    expect(adjustments[0].before.length).toBeGreaterThan(0);
  });

  it("never touches a week the athlete has already finished", async () => {
    const plan = planRow();
    const result = await rebuildPlanForBreak({ userId: "u1", plan, event: holiday(), age: 30, today: TODAY });
    const written = db.writes[0].values.plan_data as PlanWeekLike[];
    // The break is in week 2 and the return is in week 3. Week 2 is the week the
    // athlete said they would not train in, so it is emptied: every session in
    // it becomes a rest day that names what stood there, and nothing in it is
    // left asking to be done.
    const original = plan.plan_data as PlanWeekLike[];
    const away = written[1];
    expect(away).not.toBe(original[1]);
    expect(away.sessions.filter((s) => !s.isRest && s.type !== "rest")).toEqual([]);
    expect(away.sessions.find((s) => s.day === 1)!.returnFromBreak).toMatchObject({
      dropped: true,
      originalTitle: original[1].sessions.find((s) => s.day === 1)!.title,
    });
    // Week 1 is the loading week before the holiday: still ahead of the
    // athlete, so it banks ~10% more volume (60 min -> 65) rather than being
    // rewritten as history.
    expect(written[0]).not.toBe(plan.plan_data[0]);
    expect(written[0].sessions.find((s) => s.day === 1)!.duration_minutes).toBe(65);
  });

  it("refuses to apply the same break twice", async () => {
    const first = await rebuildPlanForBreak({ userId: "u1", plan: planRow(), event: holiday(), age: 30, today: TODAY });
    const write = db.writes[0];
    const applied = { ...planRow(), plan_data: write.values.plan_data, plan_adjustments: write.values.plan_adjustments };

    const second = await rebuildPlanForBreak({ userId: "u1", plan: applied, event: holiday(), age: 30, today: TODAY });
    expect(second.outcome!.reason).toBe("already-applied");
    expect(db.writes).toHaveLength(1);
  });

  it("reports a plan with no weeks rather than writing an empty one", async () => {
    const result = await rebuildPlanForBreak({ userId: "u1", plan: planRow(null), event: holiday(), age: 30, today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBeNull();
    expect(db.writes).toHaveLength(0);
  });

  it("leaves a session the adaptive record says was completed exactly as it was", async () => {
    db.seed("plan_events", [
      { user_id: "u1", training_plan_id: "p1", scheduled_date: "2026-10-19", status: "completed" },
    ]);
    const result = await rebuildPlanForBreak({ userId: "u1", plan: planRow(), event: holiday(), age: 30, today: TODAY });
    const written = db.writes[0].values.plan_data as PlanWeekLike[];
    const monday = written[2].sessions.find((s) => s.day === 1)!;
    expect(monday.duration_minutes).toBe(60);
    expect(monday.returnFromBreak).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});

describe("undoPlanRebuild", () => {
  const applyBreak = async (
    event: LifeEvent,
    plan: { id: string; plan_data: unknown; plan_adjustments: unknown } = planRow(),
  ) => {
    const result = await rebuildPlanForBreak({ userId: "u1", plan, event, age: 30, today: TODAY });
    const write = db.writes[db.writes.length - 1];
    const records = activeAdjustments(write.values.plan_adjustments);
    return {
      plan: { id: "p1", plan_data: write.values.plan_data, plan_adjustments: write.values.plan_adjustments },
      // The last one: a plan can carry several rebuilds, and only the newest is
      // ever the undo target.
      record: records[records.length - 1],
      original: plan.plan_data,
    };
  };

  it("restores the sessions it replaced, exactly", async () => {
    const { plan, record, original } = await applyBreak(holiday());
    const undone = await undoPlanRebuild({ plan, recordId: record.id });

    expect(undone.ok).toBe(true);
    expect(undone.plan_data).toEqual(original);
    expect(undone.plan_adjustments).toEqual([]);
    expect(db.writes).toHaveLength(2);
    expect(db.writes[1].values.plan_adjustments).toEqual([]);
  });

  it("refuses to undo a rebuild that a later one sits on top of", async () => {
    const first = await applyBreak(holiday());
    const second = await applyBreak(
      holiday({ id: "ev-2", start_date: "2026-10-19", end_date: "2026-10-25" }),
      { id: "p1", plan_data: first.plan.plan_data, plan_adjustments: first.plan.plan_adjustments },
    );
    expect(activeAdjustments(second.plan.plan_adjustments)).toHaveLength(2);

    const refused = await undoPlanRebuild({ plan: second.plan, recordId: first.record.id });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("most recent");

    // The latest one is still reversible, and only then is the first one.
    const latest = await undoPlanRebuild({ plan: second.plan, recordId: second.record.id });
    expect(latest.ok).toBe(true);
    const afterLatest = { id: "p1", plan_data: latest.plan_data, plan_adjustments: latest.plan_adjustments };
    const thenFirst = await undoPlanRebuild({ plan: afterLatest, recordId: first.record.id });
    expect(thenFirst.ok).toBe(true);
    // All the way back to the plan as it was written.
    expect(thenFirst.plan_data).toEqual(planData());
  });

  it("reports an unknown record instead of writing something invented", async () => {
    const { plan } = await applyBreak(holiday());
    const missing = await undoPlanRebuild({ plan, recordId: "not-a-record" });
    expect(missing.ok).toBe(false);
    expect(db.writes).toHaveLength(1);
  });
});
