// Historical import — the decisions, without any I/O.
//
// Three things are being pinned here. The window arithmetic, because "last 6
// months" on the 31st is not `now - 180 days`. The mapping, because an imported
// activity becomes an ORDINARY `workouts` row that every existing reader must
// understand. And the honesty rules: a metric the provider did not send stays
// null, and an activity the athlete already logged by hand is not imported a
// second time.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORT_WINDOW,
  DUPLICATE_MIN_TOLERANCE_MINUTES,
  IMPORT_WINDOWS,
  MAX_IMPORT_PAGES,
  STRAVA_PAGE_SIZE,
  hasAnotherPage,
  importCaveats,
  importPagePlan,
  importSportLabel,
  importSummaryLine,
  importWindowSpec,
  isLikelyManualDuplicate,
  provenanceNote,
  sourceLabel,
  toWorkoutInsert,
  windowStart,
  type ExistingWorkout,
  type StagedActivity,
} from "./importHistory";

const IMPORTED_AT = "2026-10-06T09:00:00.000Z";

const activity = (over: Partial<StagedActivity> = {}): StagedActivity => ({
  source: "strava",
  source_record_id: "abc123",
  title: "Morning Run",
  activity_type: "Run",
  start_time: "2026-08-01T06:30:00.000Z",
  end_time: "2026-08-01T07:30:00.000Z",
  duration_seconds: 3600,
  distance_meters: 10000,
  active_calories: 700,
  heart_rate_avg: 148,
  ...over,
});

/**
 * The window is a LOCAL calendar date — that is the whole point of counting in
 * months — so it is compared in local terms. `toISOString` would shift it into
 * UTC and report the previous day east of Greenwich.
 */
const localDay = (d: Date | null) =>
  d === null
    ? null
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("windowStart", () => {
  it("counts back in calendar months, not in blocks of thirty days", () => {
    expect(localDay(windowStart("3m", new Date(2026, 2, 15)))).toBe("2025-12-15");
    expect(localDay(windowStart("12m", new Date(2026, 2, 15)))).toBe("2025-03-15");
  });

  it("clamps to a month's last day instead of rolling into the next one", () => {
    // Six months before 31 March is 30 September, not 1 October.
    expect(localDay(windowStart("6m", new Date(2026, 2, 31)))).toBe("2025-09-30");
    // Twelve months before 29 February is 28 February of the previous year.
    expect(localDay(windowStart("12m", new Date(2024, 1, 29)))).toBe("2023-02-28");
  });

  it("returns null for the whole-history window", () => {
    expect(windowStart("all", new Date(2026, 2, 15))).toBeNull();
  });

  it("falls back to the default window for an unknown id", () => {
    expect(importWindowSpec("nope" as never).id).toBe(DEFAULT_IMPORT_WINDOW);
    expect(IMPORT_WINDOWS).toHaveLength(4);
  });
});

describe("pagination", () => {
  it("stops only on a short page", () => {
    expect(hasAnotherPage(STRAVA_PAGE_SIZE)).toBe(true);
    expect(hasAnotherPage(STRAVA_PAGE_SIZE - 1)).toBe(false);
    expect(hasAnotherPage(0)).toBe(false);
  });

  it("bounds a run so a bad cursor cannot loop for ever", () => {
    const plan = importPagePlan();
    expect(plan.pageSize).toBe(200);
    expect(plan.maxPages).toBe(MAX_IMPORT_PAGES);
    expect(plan.ceiling).toBe(5000);
  });
});

describe("importSportLabel", () => {
  it("uses the app's own words for the activities Strava sends", () => {
    expect(importSportLabel("Run")).toBe("Running");
    expect(importSportLabel("VirtualRide")).toBe("Cycling");
    expect(importSportLabel("weight_training")).toBe("Strength");
    expect(importSportLabel("Swim")).toBe("Swimming");
    expect(importSportLabel("Soccer")).toBe("Football");
  });

  it("keeps the provider's own word rather than inventing a sport", () => {
    expect(importSportLabel("Windsurfing")).toBe("Windsurfing");
    expect(importSportLabel("")).toBe("Training");
    expect(importSportLabel(null)).toBe("Training");
  });
});

describe("toWorkoutInsert", () => {
  it("produces an ordinary workouts row that the existing readers understand", () => {
    const row = toWorkoutInsert(activity(), "u1", IMPORTED_AT);

    expect(row).toMatchObject({
      user_id: "u1",
      title: "Morning Run",
      type: "Run",
      sport: "Running",
      // Seconds → minutes, metres → kilometres.
      duration_minutes: 60,
      distance_km: 10,
      heart_rate_avg: 148,
      calories_burned: 700,
      completed: true,
      source: "strava",
      external_id: "abc123",
      imported_at: IMPORTED_AT,
      notes: "Imported from Strava",
    });
    expect(row?.started_at).toBe("2026-08-01T06:30:00.000Z");
    expect(row?.completed_at).toBe("2026-08-01T07:30:00.000Z");
  });

  it("prices the session with Phase 3's own load rules", () => {
    // 60 minutes of running with no effort rating: the moderate assumption,
    // which sessionLoad reports as low confidence. The import does not upgrade
    // that to look better.
    expect(toWorkoutInsert(activity(), "u1", IMPORTED_AT)?.session_load).toBe(60);
  });

  it("leaves a metric the provider did not send as null, never zero", () => {
    const row = toWorkoutInsert(
      activity({
        distance_meters: null,
        active_calories: null,
        heart_rate_avg: null,
        title: null,
      }),
      "u1",
      IMPORTED_AT,
    );

    expect(row?.distance_km).toBeNull();
    expect(row?.calories_burned).toBeNull();
    expect(row?.heart_rate_avg).toBeNull();
    // No name upstream means the sport stands in for the title, not a guess.
    expect(row?.title).toBe("Running");
  });

  it("falls back to the recorded window when the provider sent no duration", () => {
    const row = toWorkoutInsert(activity({ duration_seconds: null }), "u1", IMPORTED_AT);
    expect(row?.duration_minutes).toBe(60);
  });

  it("rejects an activity it cannot place in time", () => {
    expect(toWorkoutInsert(activity({ start_time: "not a date" }), "u1", IMPORTED_AT)).toBeNull();
    expect(
      toWorkoutInsert(
        activity({ duration_seconds: 0, end_time: "2026-08-01T06:00:00.000Z" }),
        "u1",
        IMPORTED_AT,
      ),
    ).toBeNull();
  });

  it("rejects an activity with no stable id to dedupe on", () => {
    expect(toWorkoutInsert(activity({ source_record_id: "" }), "u1", IMPORTED_AT)).toBeNull();
    expect(toWorkoutInsert(activity({ source: "" }), "u1", IMPORTED_AT)).toBeNull();
  });

  it("rounds distance to centimetres, not to a friendlier number", () => {
    const row = toWorkoutInsert(activity({ distance_meters: 10555 }), "u1", IMPORTED_AT);
    expect(row?.distance_km).toBe(10.56);
  });
});

describe("sourceLabel / provenanceNote", () => {
  it("names importers and stays silent about manual entries", () => {
    expect(sourceLabel("strava")).toBe("Strava");
    expect(sourceLabel("health_connect")).toBe("Health Connect");
    // A null source and 'manual' both mean "the athlete typed this".
    expect(sourceLabel(null)).toBeNull();
    expect(sourceLabel("manual")).toBeNull();
  });

  it("writes provenance onto the row itself", () => {
    expect(provenanceNote("strava")).toBe("Imported from Strava");
  });
});

describe("isLikelyManualDuplicate", () => {
  const existing = (over: Partial<ExistingWorkout> = {}): ExistingWorkout => ({
    id: "w1",
    started_at: "2026-08-01T06:35:00.000Z",
    completed_at: "2026-08-01T07:30:00.000Z",
    duration_minutes: 60,
    sport: "Running",
    type: "run",
    source: null,
    ...over,
  });

  it("matches a hand-logged session on the same day, sport and duration", () => {
    expect(isLikelyManualDuplicate(activity(), [existing()])?.id).toBe("w1");
  });

  it("tolerates a quarter of the duration, and at least ten minutes", () => {
    expect(isLikelyManualDuplicate(activity(), [existing({ duration_minutes: 70 })])?.id).toBe("w1");
    expect(isLikelyManualDuplicate(activity(), [existing({ duration_minutes: 95 })])).toBeNull();
    // The floor: a 12-minute warm-up is not a 20-minute session.
    expect(
      isLikelyManualDuplicate(activity({ duration_seconds: 1200 }), [
        existing({ duration_minutes: 20 }),
      ])?.id,
    ).toBe("w1");
    expect(DUPLICATE_MIN_TOLERANCE_MINUTES).toBe(10);
  });

  it("never matches across days or sports", () => {
    expect(
      isLikelyManualDuplicate(activity(), [existing({ started_at: "2026-08-03T06:35:00.000Z" })]),
    ).toBeNull();
    expect(
      isLikelyManualDuplicate(activity(), [existing({ sport: "Swimming", type: "swim" })]),
    ).toBeNull();
  });

  it("does not treat an unknown sport as evidence of a match", () => {
    // Neither side can be classified, so there is nothing to compare.
    expect(
      isLikelyManualDuplicate(activity({ activity_type: "Windsurfing" }), [
        existing({ sport: "Windsurfing", type: "windsurfing" }),
      ]),
    ).toBeNull();
  });

  it("ignores previously imported rows — the database owns that dedupe", () => {
    expect(isLikelyManualDuplicate(activity(), [existing({ source: "strava" })])).toBeNull();
    // ...but a row explicitly marked manual is still a manual row.
    expect(isLikelyManualDuplicate(activity(), [existing({ source: "manual" })])?.id).toBe("w1");
  });

  it("refuses to drop a session on a weak signal", () => {
    // Same day and sport but no comparable durations is not enough to skip.
    expect(
      isLikelyManualDuplicate(activity(), [existing({ duration_minutes: null })]),
    ).toBeNull();
    expect(
      isLikelyManualDuplicate(activity({ duration_seconds: null, end_time: "2026-08-01T06:30:00.000Z" }), [
        existing(),
      ]),
    ).toBeNull();
  });
});

describe("summary copy", () => {
  it("describes the range when there is one", () => {
    expect(importSummaryLine(45, "3m", "2026-07-01", "2026-09-30")).toBe(
      "We imported 45 sessions in the last 3 months from 2026-07-01 to 2026-09-30.",
    );
  });

  it("says nothing new rather than nothing at all", () => {
    expect(importSummaryLine(0, "6m", null, null)).toBe("Nothing new came back from that window.");
  });

  it("uses the singular for a single session", () => {
    expect(importSummaryLine(1, "all", "2026-08-01", "2026-08-01")).toBe(
      "We imported 1 session.",
    );
  });

  it("always states the effort-rating limit", () => {
    const notes = importCaveats(0, false);
    expect(notes.join(" ")).toContain("no effort rating");
  });

  it("counts what it skipped and admits when it hit the ceiling", () => {
    const notes = importCaveats(3, true);
    expect(notes.join(" ")).toContain("3 sessions were skipped");
    expect(notes.join(" ")).toContain("5000");
  });
});
