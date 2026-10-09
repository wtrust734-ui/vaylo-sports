// "Your Vaylo Starting Analysis".
//
// The specification's rule for this screen is that missing data must never be
// invented, so the tests are organised around that: what the analysis says when
// the record supports it, what it explicitly declines to say when the record
// does not, and the one thing it must never say at all — a medical claim.
//
// Dates are the four weeks from Monday 5 January 2026, chosen so the week
// arithmetic is checkable by hand.

import { describe, expect, it } from "vitest";
import {
  BACK_TO_BACK_DAYS,
  CONSISTENCY_TARGET_PER_WEEK,
  LONG_GAP_DAYS,
  MIN_SESSIONS_FOR_PATTERNS,
  MIN_SESSIONS_FOR_TREND,
  NO_EFFORT_NOTE,
  RECORD_ONLY_NOTE,
  SPIKE_RATIO,
  WORKLOAD_WINDOW_DAYS,
  YOUTH_ANALYSIS_NOTE,
  bandFromFactor,
  buildStartingAnalysis,
  dayNumber,
  mondayOf,
  type AnalysisInput,
  type AnalysisSession,
  type StartingAnalysis,
} from "./startingAnalysis";

/** Zero-padded day, so `2026-01-${d(5)}` is a real date and not `2026-01-05x`. */
const d = (n: number) => String(n).padStart(2, "0");

const session = (date: string, over: Partial<AnalysisSession> = {}): AnalysisSession => ({
  date,
  sport: "Running",
  title: "Easy run",
  durationMinutes: 60,
  distanceKm: 10,
  load: 60,
  source: "manual",
  ...over,
});

/** Three sessions a week for four weeks, all comparable. */
const twelveSessions = (): AnalysisSession[] =>
  ["05", "06", "07", "12", "13", "14", "19", "20", "21", "26", "27", "28"].map((d) =>
    session(`2026-01-${d}`),
  );

const build = (over: Partial<AnalysisInput> = {}): StartingAnalysis =>
  buildStartingAnalysis({ sessions: twelveSessions(), ...over });

/** Every string anywhere in the result — for the prose guard below. */
function allProse(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allProse);
  if (value && typeof value === "object") return Object.values(value).flatMap(allProse);
  return [];
}

describe("day arithmetic", () => {
  it("reads date-only strings without drifting through a timezone", () => {
    expect(dayNumber("2026-01-05")).toBe(dayNumber("2026-01-05T00:00:00Z"));
    expect(dayNumber("nonsense")).toBeNull();
  });

  it("puts a date in the week beginning Monday", () => {
    // 2026-01-05 is a Monday; 01-11 is the Sunday that ends that week.
    expect(mondayOf(dayNumber("2026-01-05")!)).toBe(dayNumber("2026-01-05"));
    expect(mondayOf(dayNumber("2026-01-11")!)).toBe(dayNumber("2026-01-05"));
    expect(mondayOf(dayNumber("2026-01-12")!)).toBe(dayNumber("2026-01-12"));
  });
});

describe("an empty record", () => {
  const empty = buildStartingAnalysis({ sessions: [] });

  it("says there is nothing to read rather than showing zeros", () => {
    expect(empty.empty).toBe(true);
    expect(empty.reason).toContain("no sessions to read");
    expect(empty.sessionCount).toBe(0);
    expect(empty.patterns).toBeNull();
    expect(empty.consistency).toBeNull();
    expect(empty.strengths).toEqual([]);
  });

  it("still states what the record can and cannot contain", () => {
    expect(empty.caveats).toContain(RECORD_ONLY_NOTE);
  });
});

describe("facts about the record", () => {
  it("counts the record, splitting imports from hand-logged sessions", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        session("2026-01-05"),
        session("2026-01-06", { source: "strava" }),
        session("2026-01-07", { source: "strava" }),
      ],
    });

    expect(analysis.sessionCount).toBe(3);
    expect(analysis.importedCount).toBe(2);
    expect(analysis.manualCount).toBe(1);
    expect(analysis.sources).toEqual(["strava"]);
    expect(analysis.firstDate).toBe("2026-01-05");
    expect(analysis.lastDate).toBe("2026-01-07");
  });

  it("ignores sessions with an unusable date instead of guessing one", () => {
    const analysis = buildStartingAnalysis({
      sessions: [session("2026-01-05"), session("not a date"), session("")],
    });

    expect(analysis.sessionCount).toBe(1);
  });
});

describe("patterns", () => {
  it("derives weekly volume and rhythm over the span the record covers", () => {
    const analysis = build();

    expect(analysis.patterns).toMatchObject({
      weeklyVolumeMinutes: 180, // 12 × 60 over 4 weeks
      weeklySessionCount: 3,
      typicalSessionMinutes: 60,
      longestSessionMinutes: 60,
    });
    expect(analysis.patterns?.commonSports).toEqual([{ sport: "Running", sessions: 12 }]);
  });

  it("labels the intensity as an estimate, because no effort was ever logged", () => {
    const analysis = build();
    expect(analysis.patterns?.typicalIntensity).toBe("moderate");
    expect(analysis.patterns?.typicalIntensityBasis).toBe("estimated");
  });

  it("ranks sports by how often they appear", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...Array.from({ length: 6 }, (_, i) => session(`2026-01-${d(i + 5)}`)),
        ...Array.from({ length: 3 }, (_, i) => session(`2026-01-${d(i + 12)}`, { sport: "Swimming" })),
        ...Array.from({ length: 2 }, (_, i) => session(`2026-01-${d(i + 20)}`, { sport: "Cycling" })),
      ],
    });

    expect(analysis.patterns?.commonSports[0]).toEqual({ sport: "Running", sessions: 6 });
    expect(analysis.patterns?.commonSports).toHaveLength(3);
  });

  it("declines to describe a pattern from too little data", () => {
    const analysis = buildStartingAnalysis({
      sessions: [session("2026-01-05"), session("2026-01-06"), session("2026-01-07")],
    });

    expect(MIN_SESSIONS_FOR_PATTERNS).toBe(8);
    expect(analysis.patterns).toBeNull();
    expect(analysis.consistency).toBeNull();
  });
});

describe("consistency", () => {
  it("measures against the weeks the record covers, not against empty weeks since", () => {
    const analysis = build();
    expect(analysis.consistency).toMatchObject({
      weeksConsidered: 4,
      weeksWithSessions: 4,
      weeksMeetingTarget: 4,
      percent: 100,
      targetPerWeek: CONSISTENCY_TARGET_PER_WEEK,
    });
  });

  it("reports a trailing absence as a number rather than scoring it", () => {
    // Four sessions in each of two weeks, the last on Thursday 15 January,
    // analysed on 4 February — twenty days later.
    const analysis = buildStartingAnalysis({
      sessions: ["05", "06", "07", "08", "12", "13", "14", "15"].map((d) =>
        session(`2026-01-${d}`),
      ),
      today: "2026-02-04",
    });

    expect(analysis.consistency).toMatchObject({
      weeksConsidered: 2,
      weeksMeetingTarget: 2,
      // 15 Jan → 4 Feb is 20 days.
      daysSinceLastSession: 20,
    });
    // Still 100%: the weeks it trained in are the weeks it is judged on. The
    // absence is reported as a fact rather than silently scored as failure.
    expect(analysis.consistency?.percent).toBe(100);
  });
});

describe("recent workload", () => {
  const inWindow = (month: string, days: string[], load: number) =>
    days.map((d) => session(`2026-${month}-${d}`, { load }));

  const withBothWindows = () => ({
    sessions: [
      ...inWindow("01", ["10", "17", "24", "31"], 100),
      ...inWindow("02", ["07", "14", "21", "28"], 100),
    ],
    today: "2026-03-01",
  });

  it("compares the last four weeks with the four before them", () => {
    const analysis = buildStartingAnalysis(withBothWindows());

    expect(analysis.recentWorkload).toMatchObject({
      recentDays: WORKLOAD_WINDOW_DAYS,
      recentLoad: 400,
      recentSessions: 4,
      priorLoad: 400,
      priorSessions: 4,
      ratio: 1,
      band: "steady",
    });
  });

  it("calls a big jump high", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...inWindow("01", ["10", "17", "24", "31"], 100),
        ...inWindow("02", ["07", "14", "21", "28"], 200),
      ],
      today: "2026-03-01",
    });

    expect(analysis.recentWorkload?.ratio).toBe(2);
    expect(analysis.recentWorkload?.band).toBe("high");
  });

  it("uses an explicit unknown instead of 'steady' when there is nothing to compare", () => {
    const analysis = build();

    expect(analysis.recentWorkload?.priorLoad).toBeNull();
    expect(analysis.recentWorkload?.ratio).toBeNull();
    expect(analysis.recentWorkload?.band).toBe("unknown");
  });

  it("reports no workload at all when nothing carries a load figure", () => {
    const analysis = buildStartingAnalysis({
      sessions: twelveSessions().map((s) => ({ ...s, load: null })),
    });

    expect(analysis.recentWorkload).toBeNull();
  });
});

describe("progress", () => {
  it("compares the earlier half of the record with the later half", () => {
    const analysis = buildStartingAnalysis({
      sessions: twelveSessions().map((s, i) => ({ ...s, distanceKm: i < 6 ? 8 : 12 })),
    });

    expect(analysis.progress).toMatchObject({
      metric: "distance",
      fromValue: 8,
      toValue: 12,
      changePercent: 50,
      direction: "up",
    });
    expect(analysis.progress?.basedOn).toContain("12");
  });

  it("calls a small difference flat rather than a trend", () => {
    const analysis = buildStartingAnalysis({
      sessions: twelveSessions().map((s, i) => ({ ...s, distanceKm: i < 6 ? 10 : 10.3 })),
    });

    expect(analysis.progress?.direction).toBe("flat");
  });

  it("falls back to duration when no distances were recorded", () => {
    const analysis = buildStartingAnalysis({
      sessions: twelveSessions().map((s, i) => ({
        ...s,
        distanceKm: null,
        durationMinutes: i < 6 ? 40 : 70,
        load: null,
      })),
    });

    expect(analysis.progress).toMatchObject({ metric: "duration", direction: "up" });
  });

  it("says why there is no trend instead of inventing one", () => {
    const analysis = buildStartingAnalysis({
      sessions: Array.from({ length: 4 }, (_, i) => session(`2026-01-${d(i + 5)}`)),
    });

    expect(MIN_SESSIONS_FOR_TREND).toBe(6);
    expect(analysis.progress).toBeNull();
    expect(analysis.progressUnavailableReason).toContain("Not enough comparable sessions");
  });
});

describe("goal alignment", () => {
  it("agrees when the goal's sport is what the athlete actually does", () => {
    const analysis = build({ goals: [{ title: "Run a sub-40 10K", category: "running" }] });

    expect(analysis.goalAlignment).toMatchObject({ aligned: true });
    expect(analysis.goalAlignment?.text).toContain("sub-40 10K");
  });

  it("names the mismatch when training points somewhere else", () => {
    const analysis = build({ goals: [{ title: "Get stronger in the gym", category: "strength" }] });

    expect(analysis.goalAlignment?.aligned).toBe(false);
    expect(analysis.goalAlignment?.text).toContain("more focused on Running");
    expect(analysis.nextSteps.map((s) => s.id)).toContain("aim-at-goal");
  });

  it("refuses to guess when it cannot classify the goal", () => {
    const analysis = build({ goals: [{ title: "Sleep better", category: null }] });

    expect(analysis.goalAlignment?.aligned).toBeNull();
    expect(analysis.goalAlignment?.text).toContain("can't yet say");
  });

  it("says nothing about goals when there are none, and suggests setting one", () => {
    const analysis = build();
    expect(analysis.goalAlignment).toBeNull();
    expect(analysis.nextSteps.map((s) => s.id)).toContain("set-a-goal");
  });
});

describe("strengths", () => {
  it("recognises a consistent weekly rhythm", () => {
    const ids = build().strengths.map((s) => s.id);
    expect(ids).toContain("consistent");
    expect(ids).toContain("rhythm");
  });

  it("recognises range across sports", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...Array.from({ length: 6 }, (_, i) => session(`2026-01-${d(i + 5)}`)),
        ...Array.from({ length: 4 }, (_, i) => session(`2026-01-${d(i + 12)}`, { sport: "Swimming" })),
      ],
    });

    expect(analysis.strengths.map((s) => s.id)).toContain("multi-sport");
  });

  it("claims no strengths a thin record cannot support", () => {
    const analysis = buildStartingAnalysis({
      sessions: [session("2026-01-05"), session("2026-01-06")],
    });

    expect(analysis.strengths).toEqual([]);
  });
});

describe("things worth flagging", () => {
  it("flags weeks well above the athlete's own median", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...["05", "06", "07", "12", "13", "14", "19", "20", "21"].map((d) =>
          session(`2026-01-${d}`, { load: 60 }),
        ),
        ...["26", "27", "28"].map((d) => session(`2026-01-${d}`, { load: 400 })),
      ],
    });

    expect(SPIKE_RATIO).toBe(1.5);
    expect(analysis.issues.map((i) => i.id)).toContain("spikes");
  });

  it("flags demanding days that landed back to back", () => {
    expect(BACK_TO_BACK_DAYS).toBe(2);
    expect(build().issues.map((i) => i.id)).toContain("back-to-back");
  });

  it("names a long break as a fact that changes the next week", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...Array.from({ length: 5 }, (_, i) => session(`2026-01-0${i + 5}`)),
        ...Array.from({ length: 5 }, (_, i) => session(`2026-02-1${i + 1}`)),
      ],
    });

    expect(LONG_GAP_DAYS).toBe(21);
    const gap = analysis.issues.find((i) => i.id === "gap");
    expect(gap).toBeDefined();
    expect(gap?.detail).toContain("gap of");
  });

  it("does not flag a single big week as a pattern", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...["05", "06", "07", "12", "13", "14", "19", "20"].map((d) =>
          session(`2026-01-${d}`, { load: 60 }),
        ),
        ...["21", "26", "27", "28"].map((d) => session(`2026-01-${d}`, { load: 500 })),
      ],
    });

    // Half the weeks are spikes, which is not a deviation from a pattern.
    expect(analysis.issues.map((i) => i.id)).not.toContain("spikes");
  });
});

describe("next steps", () => {
  it("puts what is missing from the record before day-to-day advice", () => {
    const thin = buildStartingAnalysis({
      sessions: [session("2026-01-05"), session("2026-01-06")],
    });

    expect(thin.nextSteps[0].id).toBe("log-more");
  });

  it("suggests strength work when there is none", () => {
    expect(build().nextSteps.map((s) => s.id)).toContain("add-strength");
  });

  it("stays quiet about strength when the athlete already lifts", () => {
    const analysis = buildStartingAnalysis({
      sessions: [
        ...Array.from({ length: 8 }, (_, i) => session(`2026-01-${d(i + 5)}`)),
        session("2026-01-15", { sport: "Strength", title: "Gym" }),
      ],
    });

    expect(analysis.nextSteps.map((s) => s.id)).not.toContain("add-strength");
  });
});

describe("never fabricating", () => {
  it("gives every claim a basis a reader can check", () => {
    const analysis = build({ goals: [{ title: "Run faster", category: "running" }] });
    const insights = [...analysis.strengths, ...analysis.issues, ...analysis.nextSteps];

    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.basedOn.trim().length, insight.id).toBeGreaterThan(0);
    }
  });

  it("states the effort-rating limit whenever something was imported", () => {
    const imported = buildStartingAnalysis({
      sessions: twelveSessions().map((s) => ({ ...s, source: "strava" })),
    });

    expect(imported.caveats).toContain(NO_EFFORT_NOTE);
    // Nothing imported: no need for a caveat about imported data.
    expect(build().caveats).not.toContain(NO_EFFORT_NOTE);
  });

  it("always says the record is a floor, not a measurement", () => {
    expect(build().caveats).toContain(RECORD_ONLY_NOTE);
  });
});

describe("youth framing", () => {
  it("adds a development note and keeps the thresholds the same", () => {
    const adult = build({ age: 30 });
    const youth = build({ age: 14 });

    expect(youth.caveats).toContain(YOUTH_ANALYSIS_NOTE);
    expect(adult.caveats).not.toContain(YOUTH_ANALYSIS_NOTE);
    expect(youth.consistency?.percent).toBe(adult.consistency?.percent);
  });

  it("softens the framing of a flagged pattern", () => {
    const spiky = [
      ...["05", "06", "07", "12", "13", "14", "19", "20", "21"].map((d) =>
        session(`2026-01-${d}`, { load: 60 }),
      ),
      ...["26", "27", "28"].map((d) => session(`2026-01-${d}`, { load: 400 })),
    ];

    const adult = buildStartingAnalysis({ sessions: spiky, age: 30 });
    const youth = buildStartingAnalysis({ sessions: spiky, age: 14 });

    expect(adult.issues.find((i) => i.id === "spikes")?.title).toBe("Load jumped in some weeks");
    expect(youth.issues.find((i) => i.id === "spikes")?.title).toBe(
      "Some weeks were much bigger than others",
    );
  });
});

describe("safety", () => {
  it("never makes a medical claim, in any branch, for any age", () => {
    const forbidden =
      /overtrain|over-train|injur|burnout|burn-out|depress|diagnos|syndrome|mental health|disorder|patholog/i;

    const spiky = [
      ...["05", "06", "07", "12", "13", "14", "19", "20", "21"].map((d) =>
        session(`2026-01-${d}`, { load: 60 }),
      ),
      ...["26", "27", "28"].map((d) => session(`2026-01-${d}`, { load: 400 })),
    ];

    const variants: StartingAnalysis[] = [
      buildStartingAnalysis({ sessions: [] }),
      buildStartingAnalysis({ sessions: [session("2026-01-05")] }),
      build({ age: 13 }),
      build({ goals: [{ title: "Get stronger in the gym", category: "strength" }] }),
      buildStartingAnalysis({ sessions: spiky, age: 15 }),
      buildStartingAnalysis({
        sessions: [...twelveSessions(), ...spiky].map((s) => ({ ...s, load: null })),
      }),
    ];

    for (const analysis of variants) {
      for (const text of allProse(analysis)) {
        expect(text, text).not.toMatch(forbidden);
      }
    }
  });
});

describe("bandFromFactor", () => {
  it("reads a load-per-minute figure back against Phase 3's own table", () => {
    expect(bandFromFactor(1.0)).toBe("moderate");
    expect(bandFromFactor(0.7)).toBe("recovery");
    expect(bandFromFactor(1.8)).toBe("max");
  });

  it("returns nothing for a figure it cannot use", () => {
    expect(bandFromFactor(null)).toBeNull();
    expect(bandFromFactor(0)).toBeNull();
    expect(bandFromFactor(Number.NaN)).toBeNull();
  });
});
