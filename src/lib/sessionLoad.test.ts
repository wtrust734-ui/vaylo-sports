import { describe, expect, it } from "vitest";

import {
  dailyLoadTotals,
  loadTotals,
  sessionLoad,
  classifySport,
  bandFor,
  INTENSITY_BANDS,
  FIELD_MATCH_FACTOR,
  FIELD_PRACTICE_FACTOR,
  type SessionLoadInput,
} from "./sessionLoad";

// Spec §4 gives a formula per sport. Each of these cases is one line of §4,
// asserted against the number the formula produces, not against a snapshot of
// whatever the code happens to return today.
describe("sessionLoad — §4 sport models", () => {
  it("case 1: running is duration × intensity factor, and the bands are the spec's", () => {
    // 60 min easy (RPE 3 → recovery band, factor 0.7) = 42
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 3 }).load).toBe(42);
    // 60 min moderate (RPE 6 → 1.0) = 60
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 6 }).load).toBe(60);
    // 60 min hard (RPE 8 → 1.35) = 81
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 8 }).load).toBe(81);
    // 60 min maximal (RPE 10 → 1.75) = 105
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 10 }).load).toBe(105);
  });

  it("publishes the specification's intensity bands rather than the midpoints alone", () => {
    expect(INTENSITY_BANDS.recovery.min).toBe(0.6);
    expect(INTENSITY_BANDS.recovery.max).toBe(0.8);
    expect(INTENSITY_BANDS.moderate.min).toBe(0.9);
    expect(INTENSITY_BANDS.moderate.max).toBe(1.1);
    expect(INTENSITY_BANDS.hard.min).toBe(1.2);
    expect(INTENSITY_BANDS.hard.max).toBe(1.5);
    expect(INTENSITY_BANDS.max.min).toBe(1.5);
    expect(INTENSITY_BANDS.max.max).toBe(2.0);
  });

  it("cycling uses the same duration × factor model as running", () => {
    expect(sessionLoad({ sport: "Cycling", durationMinutes: 90, rpe: 8 }).load).toBe(
      Math.round(90 * INTENSITY_BANDS.hard.factor),
    );
    expect(sessionLoad({ sport: "cycling", durationMinutes: 90, rpe: 6 }).load).toBe(90);
  });

  it("case 8: strength prefers volume load × RPE/10 over any duration proxy", () => {
    // 4 sets × 8 reps × 100 kg = 3200 kg lifted, RPE 8 → 3200 × 8 / 10 = 2560
    const result = sessionLoad({ sport: "Strength", durationMinutes: 60, rpe: 8, volumeLoad: 3200 });
    expect(result.method).toBe("volume-load-x-rpe");
    expect(result.load).toBe(2560);
    expect(result.confidence).toBe("high");
  });

  it("case 8: strength falls back to duration × RPE when sets and reps are unknown", () => {
    const result = sessionLoad({ sport: "gym", durationMinutes: 45, rpe: 7 });
    expect(result.method).toBe("duration-x-rpe");
    expect(result.load).toBe(Math.round(45 * 0.7));
    expect(result.caveat).toMatch(/sets, reps and weights/i);
  });

  it("prices a field/court match above the same minutes of practice, as §4 requires", () => {
    const match = sessionLoad({ sport: "football", durationMinutes: 90, rpe: 7, kind: "match" });
    const practice = sessionLoad({ sport: "football", durationMinutes: 90, rpe: 5, kind: "practice" });
    expect(match.method).toBe("match-minutes-x-factor");
    expect(match.load).toBe(Math.round(90 * FIELD_MATCH_FACTOR));
    expect(practice.load).toBe(Math.round(90 * FIELD_PRACTICE_FACTOR));
    expect(match.load!).toBeGreaterThan(practice.load!);
    // The spec's bands: practice 0.9–1.1, match 1.3–1.6.
    expect(FIELD_PRACTICE_FACTOR).toBeGreaterThanOrEqual(0.9);
    expect(FIELD_PRACTICE_FACTOR).toBeLessThanOrEqual(1.1);
    expect(FIELD_MATCH_FACTOR).toBeGreaterThanOrEqual(1.3);
    expect(FIELD_MATCH_FACTOR).toBeLessThanOrEqual(1.6);
  });

  it("prices an unlabelled field session as practice and says it is unsure", () => {
    const result = sessionLoad({ sport: "football", durationMinutes: 90, rpe: 6 });
    expect(result.confidence).toBe("low");
    expect(result.caveat).toMatch(/not recorded whether this was a match/i);
    expect(result.load).toBe(90);
  });

  it("case 9: swimming uses distance × stroke factor, not minutes × the same factor as running", () => {
    const freestyle = sessionLoad({ sport: "Swimming", distanceMeters: 1500, stroke: "freestyle", rpe: 4 });
    const butterfly = sessionLoad({ sport: "Swimming", distanceMeters: 1500, stroke: "butterfly", rpe: 8 });
    expect(freestyle.method).toBe("distance-x-stroke");
    // Same distance, harder stroke: butterfly must cost more, per the spec's
    // 1.3–1.5 band against freestyle's 1.0.
    expect(butterfly.load!).toBeGreaterThan(freestyle.load!);
  });

  it("never prices a minute of swimming as a minute of running", () => {
    const swim = sessionLoad({ sport: "Swimming", durationMinutes: 60, rpe: 6 });
    const run = sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 6 });
    expect(swim.load).not.toBe(run.load);
  });

  it("reports a swim with no stroke as a low-confidence mixed estimate", () => {
    const result = sessionLoad({ sport: "swim", distanceMeters: 2000 });
    expect(result.confidence).toBe("low");
    expect(result.caveat).toMatch(/stroke was not recorded/i);
  });
});

describe("sessionLoad — honesty about missing data", () => {
  it("returns null and a reason rather than a number when there is no duration", () => {
    const result = sessionLoad({ sport: "Running", rpe: 8 });
    expect(result.load).toBeNull();
    expect(result.caveat).toMatch(/no duration/i);
  });

  it("returns null rather than zero for an unpriceable session", () => {
    // Zero would read as "this athlete did nothing", which is a fact the app
    // does not know. Null says "we could not price it".
    expect(sessionLoad({ sport: "Strength", rpe: 8 }).load).toBeNull();
    expect(sessionLoad({ sport: "Swimming", rpe: 8 }).load).toBeNull();
    expect(sessionLoad({}).load).toBeNull();
  });

  it("case: an unrecognised sport is priced moderately and flagged as a guess", () => {
    const result = sessionLoad({ sport: "Quidditch", durationMinutes: 60 });
    expect(result.method).toBe("unclassified");
    expect(result.load).toBe(60);
    expect(result.confidence).toBe("low");
    expect(result.caveat).toMatch(/could not be identified/i);
  });

  it("never coerces a missing input to zero", () => {
    // `Number(null)` is 0 and `Number("")` is 0. An RPE of 0 would read as the
    // easiest possible effort and silently unload every session the athlete did
    // not bother to rate, and a null duration would read as a zero-minute
    // session — load 0, which downstream means "nothing happened".
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, rpe: null, sessionType: "intervals" }).load).toBe(
      Math.round(60 * INTENSITY_BANDS.hard.factor),
    );
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 0 as unknown as number }).load).toBe(
      Math.round(60 * INTENSITY_BANDS.recovery.factor),
    );
    expect(sessionLoad({ sport: "Running", durationMinutes: 0, rpe: 6 }).load).toBe(0);
    expect(sessionLoad({ sport: "Running", durationMinutes: "" as unknown as number, rpe: 6 }).load).toBeNull();
  });

  it("uses the session's own type when no RPE was logged", () => {
    // A planned intervals session is a hard session even before anyone reports
    // how it felt; treating it as moderate would under-count the very thing the
    // specification asks the app to notice.
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, sessionType: "intervals" }).load).toBe(
      Math.round(60 * INTENSITY_BANDS.hard.factor),
    );
    expect(sessionLoad({ sport: "Running", durationMinutes: 60, sessionType: "recovery" }).load).toBe(
      Math.round(60 * INTENSITY_BANDS.easy.factor),
    );
  });

  it("produces a non-negative finite number for every sane input", () => {
    const inputs: SessionLoadInput[] = [
      { sport: "Running", durationMinutes: 0, rpe: 1 },
      { sport: "Running", durationMinutes: 600, rpe: 10 },
      { sport: "Swimming", distanceMeters: 0, stroke: "mixed" },
      { sport: "Strength", volumeLoad: 0, rpe: 10 },
      { sport: "football", durationMinutes: 120, kind: "match", rpe: 10 },
      { sport: "unknown-thing", durationMinutes: 45, rpe: null },
    ];
    for (const input of inputs) {
      const { load } = sessionLoad(input);
      if (load !== null) {
        expect(Number.isFinite(load)).toBe(true);
        expect(load).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("sessionLoad — classification", () => {
  it("maps the app's existing vocabularies onto sport kinds", () => {
    expect(classifySport("run")).toBe("running");
    expect(classifySport("Running")).toBe("running");
    expect(classifySport("cycle")).toBe("cycling");
    expect(classifySport("swim")).toBe("swimming");
    expect(classifySport("gym")).toBe("strength");
    expect(classifySport("football")).toBe("field");
    expect(classifySport("basketball")).toBe("court");
    expect(classifySport(null)).toBe("unknown");
  });

  it("reads a plan session type when no sport was given", () => {
    expect(classifySport(null, "long_run")).toBe("running");
    expect(classifySport(null, "strength")).toBe("strength");
    expect(classifySport(null, "rest")).toBe("unknown");
  });

  it("never reads swimming as running, or vice versa, when both words are present", () => {
    expect(classifySport("open water swim")).toBe("swimming");
    expect(classifySport("trail run")).toBe("running");
  });

  it("places RPE into the specification's bands", () => {
    expect(bandFor({ rpe: 2 })).toBe("recovery");
    expect(bandFor({ rpe: 4 })).toBe("easy");
    expect(bandFor({ rpe: 6 })).toBe("moderate");
    expect(bandFor({ rpe: 8 })).toBe("hard");
    expect(bandFor({ rpe: 10 })).toBe("max");
    expect(bandFor({ rpe: null, sessionType: "intervals" })).toBe("hard");
  });
});

describe("sessionLoad — aggregation", () => {
  it("case 10: two activities on the same day sum into one day's load", () => {
    const totals = dailyLoadTotals([
      { date: "2026-10-01", load: 42 },
      { date: "2026-10-01", load: 126 },
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].load).toBe(168);
    expect(totals[0].sessions).toBe(2);
  });

  it("counts unpriceable sessions as work that happened but carries no number", () => {
    const totals = dailyLoadTotals([
      { date: "2026-10-01", load: 42 },
      { date: "2026-10-01", load: null },
    ]);
    expect(totals[0].load).toBe(42);
    expect(totals[0].sessions).toBe(1);
  });

  it("reports total, session count and days logged", () => {
    const totals = loadTotals([
      { date: "2026-10-01", load: 40 },
      { date: "2026-10-02", load: 60 },
      { date: "2026-10-02", load: null },
    ]);
    expect(totals.total).toBe(100);
    expect(totals.sessions).toBe(2);
    expect(totals.daysLogged).toBe(2);
  });

  it("orders days oldest first so a window reads as a timeline", () => {
    const totals = dailyLoadTotals([
      { date: "2026-10-03", load: 10 },
      { date: "2026-10-01", load: 10 },
    ]);
    expect(totals.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-03"]);
  });
});