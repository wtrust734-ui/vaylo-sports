import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORM_DRILLS,
  drillsForFamilies,
  foundationDrills,
  isSportUnknown,
  sportDrillsFor,
  type DrillFamily,
} from "./formDrills";

// ============================================================================
// THE DRILL LIBRARY, AND WHAT AN ATHLETE IS ALLOWED TO SEE
// ----------------------------------------------------------------------------
// Two contracts live here, and they are the whole feature:
//
//   1. Every drill carries real instruction. The tab's promise is that it tells
//      you what a movement is and how to do it, so a drill without steps or cues
//      is a broken promise, not a missing field.
//   2. A drill tagged for one sport family never shows to another. A runner's
//      Form tab lists running work and the shared foundations — never somebody
//      else's sport — while the foundations show to everyone.
//
// The third contract is in nav.test.ts: /form is reachable by every athlete.
// ============================================================================

const FAMILIES: DrillFamily[] = ["endurance", "team", "skill", "strength", "combat", "multi"];

describe("the drill library", () => {
  it("gives every drill real instruction, not a title and a shrug", () => {
    for (const drill of FORM_DRILLS) {
      expect(drill.families.length, `${drill.id} is for nobody`).toBeGreaterThan(0);
      expect(drill.what.trim().length, `${drill.id} has no "what it is"`).toBeGreaterThan(10);
      expect(drill.why.trim().length, `${drill.id} has no "why it helps"`).toBeGreaterThan(10);
      expect(drill.steps.length, `${drill.id} has no how-to`).toBeGreaterThanOrEqual(2);
      expect(drill.cues.length, `${drill.id} has no cues`).toBeGreaterThanOrEqual(2);
      for (const step of drill.steps) expect(step.trim().length).toBeGreaterThan(5);
      for (const cue of drill.cues) expect(cue.trim().length).toBeGreaterThan(3);
    }
  });

  it("uses one id per drill, so React keys and links cannot collide", () => {
    const ids = FORM_DRILLS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every sport family the app can classify, bar the unknown bucket", () => {
    // `multi` is the "Other" bucket — it fails open onto the whole library and
    // has no drills of its own, which is the point: there is no "Other" sport to
    // write drills for.
    for (const family of ["endurance", "team", "skill", "strength", "combat"] as const) {
      expect(
        FORM_DRILLS.some((d) => d.families.includes(family)),
        `no drill is written for the ${family} family`,
      ).toBe(true);
    }
  });
});

describe("what a sport family is shown", () => {
  it("gives a runner running drills and never another sport's", () => {
    const ids = drillsForFamilies(["endurance"]).map((d) => d.id);
    expect(ids).toContain("a-skips");
    expect(ids).toContain("cadence-ladder");
    // The drills that belong to somebody else, by the sport they are written for.
    expect(ids).not.toContain("split-step");
    expect(ids).not.toContain("agility-ladder");
    expect(ids).not.toContain("squat-form");
    expect(ids).not.toContain("stance-and-guard");
  });

  it("gives a lifter lifting drills and never another sport's", () => {
    const ids = drillsForFamilies(["strength"]).map((d) => d.id);
    expect(ids).toContain("squat-form");
    expect(ids).toContain("deadlift-setup");
    expect(ids).not.toContain("a-skips");
    expect(ids).not.toContain("sprawl");
    expect(ids).not.toContain("serve-toss");
  });

  it("shows the foundations to everyone", () => {
    for (const family of FAMILIES) {
      const ids = drillsForFamilies([family]).map((d) => d.id);
      for (const drill of foundationDrills()) {
        expect(ids, `${family} is missing the foundation ${drill.id}`).toContain(drill.id);
      }
    }
    expect(foundationDrills().length).toBeGreaterThan(0);
  });

  it("never leaks a single-family drill into a different family's list", () => {
    for (const family of FAMILIES) {
      for (const drill of sportDrillsFor([family])) {
        expect(
          drill.families,
          `${drill.id} is shown to ${family} but is written for ${drill.families.join("/")}`,
        ).toContain(family);
      }
    }
  });

  it("gives a two-sport athlete both sports, and each drill only once", () => {
    const ids = drillsForFamilies(["endurance", "skill"]).map((d) => d.id);
    expect(ids).toContain("a-skips"); // running
    expect(ids).toContain("serve-toss"); // tennis
    expect(ids).not.toContain("squat-form"); // neither sport
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fails open for an unknown sport instead of showing an empty tab", () => {
    expect(isSportUnknown([])).toBe(true);
    expect(isSportUnknown(["*"])).toBe(true);
    expect(isSportUnknown(["multi"])).toBe(true); // the "Other" bucket
    expect(drillsForFamilies([])).toHaveLength(FORM_DRILLS.length);
    expect(drillsForFamilies(["multi"])).toHaveLength(FORM_DRILLS.length);
    // ...and a classifiable sport is not treated as unknown.
    expect(isSportUnknown(["endurance"])).toBe(false);
    expect(drillsForFamilies(["endurance"]).length).toBeLessThan(FORM_DRILLS.length);
  });
});

describe("the Form screen", () => {
  const page = readFileSync(
    join(resolve(__dirname, "..", ".."), "src", "pages", "FormAnalysis.tsx"),
    "utf8",
  );

  it("gets its drills from the library rather than a list of its own", () => {
    // A second copy of the catalog on the screen is how the personalisation gets
    // lost: the page would render whatever it happened to hold, for everyone.
    expect(page).toMatch(/from "@\/lib\/formDrills"/);
    expect(page).toMatch(/drillsForFamilies|sportDrillsFor|foundationDrills/);
    expect(page).not.toMatch(/drillCategories/);
  });

  it("filters by the athlete's own families", () => {
    expect(page).toMatch(/usePersonalization|useAthleteProfile/);
  });
});
