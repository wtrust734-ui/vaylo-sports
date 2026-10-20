// ============================================================================
// INJURY RESTRICTIONS, TESTED
// ----------------------------------------------------------------------------
// These tests pin the safety-critical behaviour of the mapping from a recorded
// injury to what an existing training plan can still ask of the athlete:
//
//   1. only ACTIVE injuries restrict (improving/reassess still restrict;
//      resolved lifts every flag),
//   2. restrictions come from the recorded site, not from guesses — an
//      unmapped site ("Other", free-text sites) produces NO verdict rather
//      than an invented rule,
//   3. where the app adapts, it says what to do; where it cannot safely
//      decide, it flags for a professional instead of rewriting,
//   4. a high-severity injury is never auto-adapted — it is flagged for
//      professional assessment,
//   5. rest/recovery sessions are never flagged, and the summary counts one
//      verdict per session,
//   6. nothing in this module writes or mutates plan data.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  injuryVerdictForSession,
  summarizeInjuryImpact,
  type InjuryRestriction,
} from "./injuryRestrictions";

const knee = (overrides: Partial<InjuryRestriction> = {}): InjuryRestriction => ({
  id: "inj-1",
  status: "active",
  bodyPart: "Knee",
  severity: 4,
  notes: null,
  ...overrides,
});

const session = (overrides: Record<string, unknown> = {}) => ({
  title: "Intervals",
  duration_minutes: 60,
  type: "session",
  isRest: false,
  isRecovery: false,
  ...overrides,
});

describe("which injuries restrict training", () => {
  it("restricts while active", () => {
    const verdict = injuryVerdictForSession(knee(), session({ title: "Tempo Run 60min" }));
    expect(verdict.action).toBe("adapt");
  });

  it("still restricts while improving or awaiting reassessment", () => {
    // "Improving" is a status about the athlete's trend, not a licence: the
    // restriction stands until the athlete (ideally with a professional's
    // word) marks it resolved. THIS is the rule the safety bar sets: the
    // restriction is not lifted because the pain stopped dominating.
    expect(injuryVerdictForSession(knee({ status: "improving" }), session({ title: "Tempo Run" })).action).toBe("adapt");
    expect(injuryVerdictForSession(knee({ status: "reassess" }), session({ title: "Tempo Run" })).action).toBe("adapt");
  });

  it("lifts every restriction once resolved", () => {
    expect(injuryVerdictForSession(knee({ status: "resolved" }), session({ title: "Tempo Run" })).action).toBe("none");
  });

  it("guards junk severity instead of trusting it", () => {
    const verdict = injuryVerdictForSession(knee({ severity: 400 }), session({ title: "Tempo Run" }));
    // A nonsense severity clamps to the top of the real scale — which in this
    // app means "flag for a professional", not "silently proceed".
    expect(verdict.action).toBe("flag");
  });
});

describe("what an active injury says about one session", () => {
  it("adapts sport-pattern sessions in the affected area, with the dose named", () => {
    const verdict = injuryVerdictForSession(knee(), session({ title: "Tempo Run 60min" }));
    expect(verdict.action).toBe("adapt");
    if (verdict.action !== "adapt") throw new Error("unreachable");
    expect(verdict.reason).toContain("Knee");
    expect(verdict.chip).toContain("Reduce");
  });

  it("flags loaded-area work for a professional rather than rewriting it", () => {
    // Squats with a knee injury are the classic case the app must NOT solve
    // by pretending a lighter squat is safe enough: it flags for clearance.
    const verdict = injuryVerdictForSession(knee(), session({ title: "Heavy Back Squat" }));
    expect(verdict.action).toBe("flag");
    if (verdict.action !== "flag") throw new Error("unreachable");
    expect(verdict.reason).toMatch(/professional|physiotherapist|assess/i);
  });

  it("never adapts a session into nothing: rest and recovery stay untouched", () => {
    expect(injuryVerdictForSession(knee(), session({ isRest: true, type: "rest" })).action).toBe("none");
    expect(injuryVerdictForSession(knee(), session({ isRecovery: true })).action).toBe("none");
  });
});

describe("severity shapes the verdict", () => {
  it("takes a severe injury to a professional instead of adapting around it", () => {
    // Severity ≥6 in ANY area is beyond what the app can conservatively
    // rewrite: the verdict flags, the session stays as written.
    for (const severity of [6, 8, 10]) {
      const verdict = injuryVerdictForSession(knee({ severity }), session({ title: "Tempo Run 60min" }));
      expect(verdict.action).toBe("flag");
      if (verdict.action !== "flag") throw new Error("unreachable");
      expect(verdict.reason).toContain(String(severity));
    }
  });

  it("leaves a mild niggle adaptable only where the conservative rule is defensible", () => {
    const verdict = injuryVerdictForSession(knee({ severity: 2 }), session({ title: "Tempo Run 60min" }));
    expect(verdict.action).toBe("adapt");
  });
});

describe("unmapped sites are never guessed at", () => {
  it("produces no verdict for a site the app has no conservative rule for", () => {
    for (const bodyPart of ["Other", "Wrist", "Elbow", "ribs", "jaw"]) {
      // Wrist/Elbow are real app-respected sites, but the conservative rule
      // set deliberately holds no auto-adaptation for them; "Other" is the
      // athlete's own words. All of these leave the session untouched.
      expect(injuryVerdictForSession(knee({ bodyPart }), session({ title: "Tempo Run" })).action).toBe("none");
    }
  });

  it("matches free-typed lower-limb sites the picker's list covers", () => {
    // The picker's list is a set of shortcuts, not the set of injuries; the
    // free-typed sites that fall inside a mapped area get the same rule.
    expect(injuryVerdictForSession(knee({ bodyPart: "shin splint (left)" }), session({ title: "Tempo Run 60min" })).action).toBe("adapt");
    expect(injuryVerdictForSession(knee({ bodyPart: "groin strain" }), session({ title: "Tempo Run 60min" })).action).toBe("adapt");
  });

  it("matches the recorded site's areas: back and shoulder flag their specific load", () => {
    expect(
      injuryVerdictForSession(knee({ bodyPart: "Lower Back", severity: 4 }), session({ title: "Deadlift 5x5" })).action,
    ).toBe("flag");
    expect(
      injuryVerdictForSession(knee({ bodyPart: "Shoulder", severity: 4 }), session({ title: "Overhead Press" })).action,
    ).toBe("flag");
  });
});

describe("the plan-level summary", () => {
  const plan = [
    {
      week: 1,
      sessions: [
        { day: 1, title: "Tempo Run", duration_minutes: 60 },
        { day: 2, title: "Rest Day", duration_minutes: 0, isRest: true, type: "rest" },
        { day: 3, title: "Heavy Back Squat", duration_minutes: 50 },
        { day: 4, title: "Upper Body Pull", duration_minutes: 45 },
      ],
    },
    { week: 2, sessions: [{ day: 1, title: "Long Run", duration_minutes: 90 }] },
    { week: 3, sessions: [] },
  ];

  it("flags each affected session once, with the injury named, and skips clean ones", () => {
    const report = summarizeInjuryImpact([knee({ severity: 4 })], plan);
    // One verdict per session — the knee pattern matches BOTH the runs, and
    // the squat is flagged separately; the pull day and the rest day are not
    // touched.
    const affectedTitles = report.affected.map((a) => a.title).sort();
    expect(affectedTitles).toEqual(["Heavy Back Squat", "Long Run", "Tempo Run"]);
    for (const a of report.affected) {
      expect(a.verdict.action).not.toBe("none");
      expect(a.week).toBeGreaterThan(0);
    }
  });

  it("ignores resolved injuries and empty plans without crashing", () => {
    const report = summarizeInjuryImpact([knee({ status: "resolved" })], plan);
    expect(report.affected).toHaveLength(0);
    expect(summarizeInjuryImpact([knee()], []).affected).toHaveLength(0);
    expect(summarizeInjuryImpact([], plan).affected).toHaveLength(0);
  });

  it("does not mutate the plan it reads", () => {
    const copy = JSON.parse(JSON.stringify(plan)) as typeof plan;
    summarizeInjuryImpact([knee({ severity: 4 })], plan);
    expect(plan).toEqual(copy);
  });
});
