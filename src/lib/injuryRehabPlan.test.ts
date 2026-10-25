import { describe, expect, it } from "vitest";

import { buildInjuryRehabPlan } from "./injuryRehabPlan";
import {
  MOBILITY_PLAN_MARKER,
  renderInjuryProtocol,
  splitStoredProtocol,
} from "./injuryPlan";

const build = (overrides: Partial<Parameters<typeof buildInjuryRehabPlan>[0]> = {}) =>
  buildInjuryRehabPlan({
    bodyPart: "Knee",
    severity: 4,
    notes: "Sore going down stairs",
    sport: "Football",
    trainingDaysPerWeek: 4,
    ...overrides,
  });

describe("buildInjuryRehabPlan", () => {
  it("writes three weeks of mobility work with a pain rule on every item", () => {
    const result = build();
    expect(result.plan).not.toBeNull();
    const plan = result.plan!;
    expect(plan.weeks).toHaveLength(3);
    for (const week of plan.weeks) {
      expect(week.items.length).toBeGreaterThanOrEqual(3);
      for (const item of week.items) {
        expect(item.work.length).toBeGreaterThan(0);
        expect(item.painRule.length).toBeGreaterThan(0);
      }
      expect(week.progressWhen.length).toBeGreaterThan(0);
      expect(week.stopIf.length).toBeGreaterThan(0);
    }
    // The drills are mobility/rehab for the site, not training sessions.
    const work = plan.weeks.flatMap((w) => w.items.map((i) => i.work)).join(" ");
    expect(work).toContain("Heel slides");
    expect(work).toContain("Quad set");
    expect(work).not.toMatch(/deload|periodisation|tempo run/i);
  });

  it("works around the athlete's training week instead of replacing it", () => {
    const plan = build().plan!;
    expect(plan.summary).toContain("4-day training week");
    expect(plan.summary).toContain("Football");
    const labels = plan.weeks[0]!.items.map((item) => item.label);
    expect(labels).toContain("Before your training session");
    expect(labels).toContain("On your non-training days");
  });

  it("keeps the athlete's own note in the brief", () => {
    const plan = build({ notes: "Only hurts on stairs" }).plan!;
    expect(plan.summary).toContain("Only hurts on stairs");
  });

  it("refuses a report that needs a clinician first", () => {
    const severe = build({ severity: 9 });
    expect(severe.plan).toBeNull();
    expect(severe.reason).toMatch(/clinician/i);

    const symptoms = build({ severity: 3, notes: "I can't bear weight on it at all" });
    expect(symptoms.plan).toBeNull();
  });

  it("uses the area's own red flags", () => {
    const knee = build({ bodyPart: "Knee" }).plan!;
    const back = build({ bodyPart: "Lower Back", notes: "" }).plan!;
    expect(knee.redFlags.join(" ")).toMatch(/locks or gives way/i);
    expect(back.redFlags.join(" ")).toMatch(/bladder or bowel/i);
  });

  it("stores as a plan the screen can tell apart from the free scaffold AND the paid one", () => {
    const plan = build().plan!;
    const stored = renderInjuryProtocol(plan, "mobility");
    // Its own marker: this plan is free and made on the device, so it must not
    // be presented as the AI-written plan the athlete paid for.
    expect(stored.startsWith(MOBILITY_PLAN_MARKER)).toBe(true);
    expect(stored).toMatch(/Week 1:/);
    expect(stored).toMatch(/qualified physiotherapist/i);
    const read = splitStoredProtocol(stored);
    expect(read.kind).toBe("mobility");
    expect(read.personalised).toBe(false);
    expect(read.lines.length).toBeGreaterThan(3);
    // The marker line is never one of the rendered lines.
    expect(read.lines.some((line) => line.startsWith(MOBILITY_PLAN_MARKER))).toBe(false);
  });
});
