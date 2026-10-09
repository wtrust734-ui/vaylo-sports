import { describe, expect, it } from "vitest";

import { outcomeProgress } from "@/lib/goals";
import type { PlanAdjustmentRecord } from "@/lib/adaptivePlan";
import {
  MAX_DEVELOPMENT_AREAS,
  MAX_MILESTONES,
  MILESTONE_CHECKPOINTS,
  RETURN_INFLUENCE_DAYS,
  buildGoalRoadmap,
  buildRoadmaps,
  deriveDevelopmentAreas,
  derivePhase,
  goalMilestones,
  isDerivedMilestoneId,
  goalProgress,
  isDevelopmentPhase,
  nextMilestone,
  parseDevelopmentAreas,
  parseStoredMilestones,
  restateMilestone,
  roadmapPatch,
  type RoadmapContext,
  type RoadmapGoalRow,
} from "@/lib/roadmap";

// ---------------------------------------------------------------------------
// A roadmap EXTENDS the goals system
// ---------------------------------------------------------------------------
// These tests take the goals the app already stores — `start_value`,
// `current_value`, `target_value`, `deadline` — and check that the roadmap adds
// the middle of the journey without inventing a second progress number. The
// percentage below is the app's own `outcomeProgress()`.

const TODAY = "2026-10-06";

const goal: RoadmapGoalRow = {
  id: "g1",
  user_id: "u1",
  title: "Sub-18 5K",
  description: "Run 5K under 18 minutes",
  category: "performance",
  metric_unit: "sec",
  start_value: 1200,
  current_value: 1120,
  target_value: 1080,
  deadline: "2026-12-31",
  status: "active",
  created_at: "2026-10-01",
};

const ctx = (over: Partial<RoadmapContext> = {}): RoadmapContext => ({
  today: TODAY,
  sports: ["Running"],
  lifeEvents: [],
  weeks: [],
  adjustments: [],
  competitions: [],
  ...over,
});

const rebuild = (endDate: string, createdAt = "2026-10-04T09:00:00Z"): PlanAdjustmentRecord =>
  ({
    id: "adj1",
    kind: "return_from_break",
    lifeEventId: "e1",
    createdAt,
    break: { startDate: "2026-09-25", endDate, days: 9, eventType: "illness", activityLevel: "none" },
    creditedDays: 0,
    steps: [],
    headline: "Rebuilt over three weeks at 45%, 65% and 85% of your usual load.",
    explanation: "",
    medicalNote: null,
    competingSoon: false,
    before: [],
  }) as PlanAdjustmentRecord;

// ---------------------------------------------------------------------------
// Spec case 1 — current level, target, phase
// ---------------------------------------------------------------------------

describe("a goal's roadmap", () => {
  it("carries the goal's own numbers, not a second set", () => {
    const roadmap = buildGoalRoadmap(goal, ctx());
    // The percentage is the goals system's, unchanged.
    expect(roadmap.progress.percent).toBe(outcomeProgress(goal));
    expect(roadmap.progress.percent).toBe(67);
    expect(roadmap.title).toBe("Sub-18 5K");
    expect(roadmap.target).toBe("1080 sec");
    expect(roadmap.goalId).toBe("g1");
    // No level has been recorded, and saying so is better than a blank.
    expect(roadmap.currentLevel).toBe("Not recorded yet");
  });

  it("uses a recorded current level and phase when the athlete has set them", () => {
    const roadmap = buildGoalRoadmap(
      { ...goal, current_level: "4:32 1500m PB, school second team", phase: "specific" },
      ctx(),
    );
    expect(roadmap.currentLevel).toBe("4:32 1500m PB, school second team");
    expect(roadmap.phase).toBe("specific");
    expect(roadmap.phaseSource).toBe("stored");
  });

  it("derives a phase when none is stored", () => {
    const roadmap = buildGoalRoadmap(goal, ctx());
    expect(roadmap.phase).toBe("build");
    expect(roadmap.phaseSource).toBe("derived");
    expect(isDevelopmentPhase(roadmap.phase)).toBe(true);
  });

  it("moves the phase toward the competition as the date approaches", () => {
    const far = derivePhase(goal, ctx({ competitions: [{ title: "Nationals", date: "2026-12-20" }] }), 67, 86);
    const near = derivePhase(goal, ctx({ competitions: [{ title: "County", date: "2026-11-01" }] }), 67, 86);
    const soon = derivePhase(goal, ctx({ competitions: [{ title: "League", date: "2026-10-09" }] }), 67, 86);
    expect(far).toBe("build");
    expect(near).toBe("specific");
    expect(soon).toBe("competition");
    // A past competition is not a reason to taper.
    expect(derivePhase(goal, ctx({ competitions: [{ title: "Old", date: "2026-09-01" }] }), 67, 86)).toBe("build");
  });

  it("refuses an unrecognised phase rather than rendering a word it cannot explain", () => {
    expect(isDevelopmentPhase("base")).toBe(true);
    expect(isDevelopmentPhase("peaking")).toBe(false);
    expect(isDevelopmentPhase(null)).toBe(false);
    // A bogus stored phase falls back to the derived one.
    expect(buildGoalRoadmap({ ...goal, phase: "peaking" }, ctx()).phase).toBe("build");
  });

  it("walks the athlete into transition while a break stops training", () => {
    const breakCtx = ctx({
      lifeEvents: [
        {
          id: "e1",
          start_date: "2026-10-04",
          end_date: "2026-10-12",
          event_type: "illness",
          activity_level: "none",
          allow_training: "no",
        },
      ],
    });
    const roadmap = buildGoalRoadmap({ ...goal, phase: "build" }, breakCtx);
    // A stored phase is overridden: presenting "build" to an athlete who is ill
    // would be the app arguing with their own record.
    expect(roadmap.phase).toBe("transition");
    expect(roadmap.influences[0].label).toBe("Training is paused");
    expect(roadmap.influences[0].tone).toBe("watch");
    expect(roadmap.influences[0].detail).toContain("2026-10-12");
    expect(roadmap.priorities[0]).toContain("Come back gradually");
  });

  it("does not call a holiday a pause when training is still allowed", () => {
    const holiday = ctx({
      lifeEvents: [
        {
          id: "e2",
          start_date: "2026-10-01",
          end_date: "2026-10-20",
          event_type: "holiday",
          activity_level: "normal",
          allow_training: "yes",
        },
      ],
    });
    expect(buildGoalRoadmap(goal, holiday).phase).toBe("build");
  });
});

// ---------------------------------------------------------------------------
// Spec case 2 — key development areas
// ---------------------------------------------------------------------------

describe("development areas", () => {
  it("derives them from the goal's category and the athlete's sport", () => {
    const areas = deriveDevelopmentAreas(goal, ctx());
    expect(areas[0]).toBe("aerobic capacity");
    expect(areas).toContain("threshold work");
    // The sport adds what the category does not, without repeating it.
    expect(areas).toContain("running economy");
    expect(new Set(areas).size).toBe(areas.length);
  });

  it("gives a different answer for a different sport", () => {
    const football = deriveDevelopmentAreas(
      { ...goal, category: "skill" },
      ctx({ sports: ["Football"] }),
    );
    expect(football).toContain("change of direction");
    expect(football).toContain("technique");
    const swimming = deriveDevelopmentAreas(goal, ctx({ sports: ["Swimming"] }));
    expect(swimming).toContain("stroke efficiency");
  });

  it("prefers areas the athlete has written down", () => {
    const roadmap = buildGoalRoadmap(
      { ...goal, development_areas: ["aerobic capacity", "change of direction"] },
      ctx(),
    );
    expect(roadmap.developmentAreas).toEqual(["aerobic capacity", "change of direction"]);
    expect(roadmap.areasSource).toBe("stored");
  });

  it("bounds the list and drops junk", () => {
    expect(parseDevelopmentAreas(["a", "a", " ", null, 7, "b"])).toEqual(["a", "b"]);
    expect(parseDevelopmentAreas("[\"a\",\"b\"]")).toEqual(["a", "b"]);
    expect(parseDevelopmentAreas("<not json>")).toEqual(["<not json>"]);
    expect(parseDevelopmentAreas(null)).toEqual([]);
    expect(parseDevelopmentAreas({ nope: 1 })).toEqual([]);
    expect(
      parseDevelopmentAreas(Array.from({ length: 20 }, (_, i) => `area ${i}`)).length,
    ).toBe(MAX_DEVELOPMENT_AREAS);
    // A goal with no category and no sport still gets an answer.
    expect(deriveDevelopmentAreas({ ...goal, category: "" }, ctx({ sports: [] })).length).toBeGreaterThan(0);
    expect(deriveDevelopmentAreas({ ...goal, category: "" }, ctx({ sports: [] }))[0]).toBe(
      "the basics of this goal",
    );
  });

  it("never produces more areas than the database will store", () => {
    const roadmap = buildGoalRoadmap(goal, ctx({ sports: ["Running", "Cycling", "Swimming", "Football"] }));
    expect(roadmap.developmentAreas.length).toBeLessThanOrEqual(MAX_DEVELOPMENT_AREAS);
  });
});

// ---------------------------------------------------------------------------
// Spec case 3 — milestones and progress
// ---------------------------------------------------------------------------

describe("milestones", () => {
  it("derives checkpoints across the time between the goal being set and its deadline", () => {
    const { milestones, source } = goalMilestones(goal, ctx(), 67);
    expect(source).toBe("derived");
    expect(milestones.length).toBe(MILESTONE_CHECKPOINTS.length);
    expect(milestones[0].targetDate).toBe("2026-10-24");
    expect(milestones[1].targetDate).toBe("2026-11-16");
    expect(milestones[3].targetDate).toBe("2026-12-31");
    // Values interpolate, so a milestone is a number rather than a percentage.
    expect(milestones[0].title).toBe("Reach 1170 sec");
    expect(milestones[3].title).toBe("Reach the target — 1080 sec");
  });

  it("marks passed checkpoints achieved, and undated ones upcoming", () => {
    const { milestones } = goalMilestones(goal, ctx(), 67);
    expect(milestones.map((m) => m.status)).toEqual(["achieved", "achieved", "upcoming", "upcoming"]);
    expect(nextMilestone(milestones)?.id).toBe("cp75");
  });

  it("marks a milestone whose date has gone by as missed", () => {
    const milestone = { id: "cp75", title: "Reach 1110 sec", targetDate: "2026-09-01", status: "upcoming" as const };
    expect(restateMilestone(milestone, 50, TODAY)).toBe("missed");
    expect(restateMilestone(milestone, 80, TODAY)).toBe("achieved");
    // A milestone already recorded as achieved stays achieved.
    expect(restateMilestone({ ...milestone, status: "achieved" }, 10, TODAY)).toBe("achieved");
  });

  it("restates a stored list from today's numbers instead of showing stale statuses", () => {
    const stored = [
      { id: "m1", title: "First race", targetDate: "2026-11-01", status: "upcoming" },
      { id: "m2", title: "Club standard", targetDate: "2026-12-01", status: "upcoming" },
    ];
    const { milestones, source } = goalMilestones({ ...goal, milestones: stored }, ctx(), 67);
    expect(source).toBe("stored");
    expect(milestones.map((m) => m.title)).toEqual(["First race", "Club standard"]);
    expect(milestones.map((m) => m.status)).toEqual(["upcoming", "upcoming"]);
    // The athlete's own words win over the derived checkpoints.
    expect(milestones.some((m) => m.id === "cp50")).toBe(false);
  });

  it("re-derives generated checkpoints instead of freezing last run's copy", () => {
    // The write-back persists the derived checkpoints so the guardian overview
    // can read them. Those stored copies must never be trusted as authored,
    // or a goal whose deadline moved would keep a roadmap pointing at the old
    // date forever.
    const first = goalMilestones(goal, ctx(), 67);
    const persisted = { ...goal, milestones: first.milestones };
    expect(goalMilestones(persisted, ctx(), 67).source).toBe("derived");

    const moved = { ...persisted, deadline: "2027-03-31" };
    const after = goalMilestones(moved, ctx(), 67);
    expect(after.milestones[3].targetDate).toBe("2027-03-31");
    expect(after.milestones[0].targetDate).not.toBe(first.milestones[0].targetDate);
    // And the write-back sees the difference, so the stored copy is refreshed.
    expect(roadmapPatch(buildGoalRoadmap(moved, ctx()), moved, "2026-10-06T10:00:00Z")).not.toBeNull();
  });

  it("keeps a milestone the athlete wrote, once and for all", () => {
    const authored = { ...goal, milestones: [{ id: "m1", title: "First sub-19", targetDate: "2026-11-01", status: "upcoming" }] };
    const { milestones, source } = goalMilestones(authored, ctx(), 67);
    expect(source).toBe("stored");
    expect(milestones.map((m) => m.title)).toEqual(["First sub-19"]);
    // What gets persisted is the athlete's list, never a generated checkpoint
    // written over the top of it.
    const roadmap = buildGoalRoadmap(authored, ctx());
    const patch = roadmapPatch(roadmap, authored);
    expect(patch!.milestones.map((m) => m.title)).toEqual(["First sub-19"]);
    expect(patch!.milestones.some((m) => isDerivedMilestoneId(m.id))).toBe(false);
  });

  it("does not let a malformed stored milestone through", () => {
    expect(parseStoredMilestones([{ title: "" }, { id: "x" }, "nope", null])).toEqual([]);
    expect(parseStoredMilestones([{ title: "Race day", status: "whenever" }])[0].status).toBe("upcoming");
    expect(parseStoredMilestones("not json")).toEqual([]);
    expect(
      parseStoredMilestones(Array.from({ length: 30 }, (_, i) => ({ title: `m${i}` }))).length,
    ).toBe(MAX_MILESTONES);
    expect(nextMilestone([])).toBeNull();
  });
});

describe("progress", () => {
  it("compares the athlete's percentage against the pace their own deadline implies", () => {
    const progress = goalProgress(goal, ctx());
    expect(progress.percent).toBe(67);
    expect(progress.daysRemaining).toBe(86);
    expect(progress.status).toBe("ahead");
    expect(progress.source).toBe("computed");
    expect(progress.summary).toContain("Ahead of pace");
    expect(progress.summary).toContain("86 days left");
  });

  it("says behind when the pace has slipped, and how fast it needs to be", () => {
    // Same deadline, five-sixths of the way through the window, barely moved.
    const behind = goalProgress({ ...goal, created_at: "2026-07-01" }, { ...ctx(), today: "2026-12-01" });
    expect(behind.status).toBe("behind");
    expect(behind.summary).toContain("Behind pace");
    // A 5K goal's target is SMALLER than where the athlete is, so the rate is
    // the seconds to drop per week — not an em dash, and not a negative number.
    expect(behind.requiredRate).toBe("9.33 sec/wk");
    expect(behind.summary).toContain("needs about 9.33 sec/wk");
  });

  it("never claims a pace it cannot measure", () => {
    const noDeadline = goalProgress({ ...goal, deadline: null }, ctx());
    expect(noDeadline.status).toBe("unknown");
    expect(noDeadline.source).toBe("unmeasurable");
    expect(noDeadline.summary).toContain("Add a target date");

    const noTarget = goalProgress({ ...goal, target_value: null }, ctx());
    expect(noTarget.status).toBe("unknown");
    expect(noTarget.source).toBe("unmeasurable");
    expect(noTarget.summary).toContain("no number attached");

    // No start date: no line to be ahead of, so the last stored reading stands.
    const noStart = goalProgress(
      { ...goal, created_at: null, progress_status: "behind" },
      ctx(),
    );
    expect(noStart.status).toBe("behind");
    expect(noStart.source).toBe("stored");

    const nothingStored = goalProgress({ ...goal, created_at: null, progress_status: null }, ctx());
    expect(nothingStored.status).toBe("unknown");
    expect(nothingStored.source).toBe("unmeasurable");
  });

  it("treats a passed deadline as behind rather than pretending it is fine", () => {
    const late = goalProgress(goal, { ...ctx(), today: "2027-01-15" });
    expect(late.status).toBe("behind");
    expect(late.summary).toContain("target date has passed");
  });

  it("calls a finished goal done", () => {
    const done = goalProgress({ ...goal, current_value: 1080 }, ctx());
    expect(done.percent).toBe(100);
    expect(done.status).toBe("ahead");
    expect(done.summary).toContain("Done");
    expect(done.summary).toContain("1080 sec");
  });
});

// ---------------------------------------------------------------------------
// Spec case 4 — priorities and next actions
// ---------------------------------------------------------------------------

describe("priorities and next actions", () => {
  it("gives at most three priorities and at most four actions", () => {
    const roadmap = buildGoalRoadmap(
      { ...goal, created_at: "2026-07-01" },
      ctx({
        today: "2026-12-01",
        recovery: { band: "low" },
        consistency: { completed: 3, planned: 12, percent: 25 },
        competitions: [{ title: "County Champs", date: "2026-12-05" }],
      }),
    );
    expect(roadmap.priorities.length).toBeLessThanOrEqual(3);
    expect(roadmap.nextActions.length).toBeLessThanOrEqual(4);
    expect(roadmap.priorities.length).toBeGreaterThan(0);
    // Priorities name the thing to do, not the thing that is wrong.
    expect(roadmap.priorities.join(" ")).toMatch(/taper|Protect sleep|Lift the weekly rate|habit/);
  });

  it("names the next milestone and the first development area", () => {
    const roadmap = buildGoalRoadmap(goal, ctx());
    expect(roadmap.nextActions[0]).toContain("Next milestone: Reach 1110 sec");
    expect(roadmap.nextActions[0]).toContain("by 2026-12-08");
    expect(roadmap.nextActions[1]).toContain("Focus this week: aerobic capacity");
    expect(roadmap.nextActions[2]).toContain("Secondary focus: threshold work");
  });

  it("tells an athlete what is missing from an unmeasurable goal", () => {
    const roadmap = buildGoalRoadmap({ ...goal, target_value: null, deadline: null }, ctx());
    const joined = roadmap.nextActions.join(" ");
    expect(joined).toContain("Add a target number");
    expect(joined).toContain("Add a target date");
  });
});

// ---------------------------------------------------------------------------
// Spec case 5 and 11 — the roadmap updates itself, and duplicates nothing
// ---------------------------------------------------------------------------

describe("the roadmap follows the athlete's record", () => {
  it("reports a return-from-break progression while it is in force", () => {
    const roadmap = buildGoalRoadmap(goal, ctx({ adjustments: [rebuild("2026-10-04")] }));
    const influence = roadmap.influences.find((i) => i.kind === "return_from_break");
    expect(influence?.label).toBe("Easing back in");
    expect(influence?.detail).toContain("Rebuilt over three weeks");
    expect(roadmap.priorities[0]).toContain("Rebuild before you push");
  });

  it("stops reporting it once the return window has passed", () => {
    const roadmap = buildGoalRoadmap(goal, ctx({ adjustments: [rebuild("2026-06-01")] }));
    expect(roadmap.influences.some((i) => i.kind === "return_from_break")).toBe(false);
    const boundary = buildGoalRoadmap(
      goal,
      ctx({ today: "2026-06-22", adjustments: [rebuild("2026-06-01")] }),
    );
    // 21 days: still inside the window; 22 is not.
    expect(boundary.influences.some((i) => i.kind === "return_from_break")).toBe(true);
    void RETURN_INFLUENCE_DAYS;
  });

  it("names the return week the plan is actually running", () => {
    const roadmap = buildGoalRoadmap(
      goal,
      ctx({
        weeks: [
          {
            week: 3,
            sessions: [],
            returnFromBreak: {
              lifeEventId: "e1",
              weekBack: 1,
              volumePct: 45,
              intensityPct: 55,
              focus: "rebuild",
              sessions: 3,
              dropped: 1,
            },
          },
        ],
      }),
    );
    const influence = roadmap.influences.find((i) => i.label === "Return week 1");
    expect(influence?.detail).toContain("45% of the usual volume");
  });

  it("surfaces a recent break, a low recovery band, a near competition and a dip in sessions", () => {
    const roadmap = buildGoalRoadmap(
      goal,
      ctx({
        lifeEvents: [
          {
            id: "e9",
            start_date: "2026-09-20",
            end_date: "2026-09-28",
            event_type: "injury",
            activity_level: "none",
            allow_training: "no",
          },
        ],
        recovery: { band: "low" },
        competitions: [{ title: "County Champs", date: "2026-10-15" }],
        consistency: { completed: 4, planned: 12, percent: 33 },
      }),
    );
    const kinds = roadmap.influences.map((i) => i.kind);
    expect(kinds).toContain("life_event");
    expect(kinds).toContain("recovery");
    expect(kinds).toContain("competition");
    expect(kinds).toContain("consistency");
    expect(roadmap.influences.find((i) => i.kind === "recovery")?.tone).toBe("watch");
    expect(roadmap.influences.find((i) => i.kind === "competition")?.label).toBe("Competing soon");
  });

  it("says nothing when there is nothing to say", () => {
    const roadmap = buildGoalRoadmap(goal, ctx());
    expect(roadmap.influences).toEqual([]);
  });

  it("flags a roadmap nobody has touched for a fortnight", () => {
    const fresh = buildGoalRoadmap({ ...goal, roadmap_updated_at: "2026-10-04T00:00:00Z" }, ctx());
    expect(fresh.isStale).toBe(false);
    expect(fresh.staleDays).toBe(2);
    const stale = buildGoalRoadmap({ ...goal, roadmap_updated_at: "2026-09-01T00:00:00Z" }, ctx());
    expect(stale.isStale).toBe(true);
  });

  it("builds one roadmap per goal, in order", () => {
    const roadmaps = buildRoadmaps([goal, { ...goal, id: "g2", title: "100 kg squat" }], ctx());
    expect(roadmaps.map((r) => r.goalId)).toEqual(["g1", "g2"]);
    expect(roadmaps.map((r) => r.title)).toEqual(["Sub-18 5K", "100 kg squat"]);
  });
});

describe("writing a roadmap back", () => {
  it("only writes when something has actually changed", () => {
    const roadmap = buildGoalRoadmap(goal, ctx());
    const patch = roadmapPatch(roadmap, goal, "2026-10-06T10:00:00Z");
    expect(patch).not.toBeNull();
    expect(patch!.phase).toBe("build");
    expect(patch!.progress_status).toBe("ahead");
    expect(patch!.development_areas.length).toBeGreaterThan(0);
    expect(patch!.milestones.length).toBe(4);
    expect(patch!.roadmap_updated_at).toBe("2026-10-06T10:00:00Z");

    // Apply it, rebuild, and there is nothing left to write.
    const stored = { ...goal, ...patch! };
    const again = roadmapPatch(buildGoalRoadmap(stored, ctx()), stored, "2026-10-07T10:00:00Z");
    expect(again).toBeNull();
  });

  it("writes again when the record has moved", () => {
    const roadmap = buildGoalRoadmap(goal, ctx());
    const stored = { ...goal, ...roadmapPatch(roadmap, goal)! };
    const moved = buildGoalRoadmap({ ...stored, current_value: 1085 }, ctx());
    expect(moved.progress.percent).toBeGreaterThan(roadmap.progress.percent);
    expect(roadmapPatch(moved, stored)).not.toBeNull();
  });
});
