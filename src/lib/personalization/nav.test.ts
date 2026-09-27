import { afterEach, describe, expect, it } from "vitest";

import {
  familiesForProfile,
  isShowAllEnabled,
  orderByRelevance,
  orderForExperience,
  setShowAllEnabled,
  shouldPersonalize,
  visibleFeatures,
  type AthleteProfile,
} from "./engine";
import { isFeatureRelevant } from "./features";
import { NAV_CATALOG } from "./nav";

const runner: AthleteProfile = { sports: ["Running"], experience: "established" };
const lifter: AthleteProfile = { sports: ["Weightlifting"], experience: "established" };
const baller: AthleteProfile = { sports: ["Football", "Basketball"], experience: "established" };
const unknown: AthleteProfile = { sports: [], experience: "new" };

afterEach(() => setShowAllEnabled(false));

describe("familiesForProfile", () => {
  it("maps sports to families", () => {
    expect(familiesForProfile(runner)).toEqual(["endurance"]);
    expect(familiesForProfile(lifter)).toEqual(["strength"]);
    expect(familiesForProfile(baller)).toEqual(["team"]);
  });

  it("fails open for unknown sports", () => {
    expect(familiesForProfile(unknown)).toEqual(["*"]);
  });
});

describe("isFeatureRelevant", () => {
  it("hides technique-first features from pure endurance athletes", () => {
    expect(isFeatureRelevant("training.form", ["endurance"])).toBe(false);
    expect(isFeatureRelevant("training.form", ["skill"])).toBe(true);
  });

  it("shows opponents only to adversarial sports", () => {
    expect(isFeatureRelevant("compete.opponents", ["team"])).toBe(true);
    expect(isFeatureRelevant("compete.opponents", ["endurance"])).toBe(false);
  });

  it("never hides universal features", () => {
    for (const key of ["training.plans", "recover.injury", "compete.challenges"] as const) {
      expect(isFeatureRelevant(key, ["endurance"])).toBe(true);
      expect(isFeatureRelevant(key, ["strength"])).toBe(true);
    }
  });
});

describe("visibleFeatures over the nav catalog", () => {
  const flatten = (groups: typeof NAV_CATALOG) => groups.flatMap((g) => g.items);

  it("gives a runner fewer items than the full catalog", () => {
    const full = flatten(NAV_CATALOG).length;
    const tailored = visibleFeatures(flatten(NAV_CATALOG), runner).length;
    expect(tailored).toBeLessThan(full);
    expect(tailored).toBeGreaterThan(full / 2); // tailored, not gutted
  });

  it("removes AR overlay and opponents for a runner, keeps them for a footballer", () => {
    const runPaths = visibleFeatures(flatten(NAV_CATALOG), runner).map((i) => i.path);
    expect(runPaths).not.toContain("/ar-overlay");
    expect(runPaths).not.toContain("/opponents");

    const footPaths = visibleFeatures(flatten(NAV_CATALOG), baller).map((i) => i.path);
    expect(footPaths).toContain("/ar-overlay");
    expect(footPaths).toContain("/opponents");
  });

  it("keeps everything for unknown sports (fail open)", () => {
    const full = flatten(NAV_CATALOG).length;
    expect(visibleFeatures(flatten(NAV_CATALOG), unknown).length).toBe(full);
  });

  it("every catalog item has a real route shape", () => {
    for (const item of flatten(NAV_CATALOG)) {
      expect(item.path.startsWith("/")).toBe(true);
      expect(item.labelKey.length).toBeGreaterThan(0);
    }
  });
});

describe("escape hatch", () => {
  it("show-all disables personalization", () => {
    setShowAllEnabled(true);
    expect(isShowAllEnabled()).toBe(true);
    expect(shouldPersonalize(runner)).toBe(false);
    setShowAllEnabled(false);
    expect(shouldPersonalize(runner)).toBe(true);
  });

  it("personalization needs a sport", () => {
    expect(shouldPersonalize(unknown)).toBe(false);
  });
});

describe("ordering", () => {
  it("new athletes see onboarding surfaces first", () => {
    const items = [
      { feature: "training.crossTraining" as const, newFirst: false, establishedFirst: true, id: "cross" },
      { feature: "training.plans" as const, newFirst: true, id: "plans" },
    ];
    const ordered = orderForExperience(items, { sports: ["Running"], experience: "new" });
    expect(ordered[0].id).toBe("plans");
  });

  it("established athletes see depth surfaces first", () => {
    const items = [
      { feature: "training.plans" as const, newFirst: true, id: "plans" },
      { feature: "training.crossTraining" as const, establishedFirst: true, id: "cross" },
    ];
    const ordered = orderForExperience(items, { sports: ["Running"], experience: "established" });
    expect(ordered[0].id).toBe("cross");
  });

  it("orderByRelevance is stable and only reorders, never removes", () => {
    const items = [
      { feature: "training.form" as const, id: "form" },
      { feature: "training.plans" as const, id: "plans" },
    ];
    const ordered = orderByRelevance(items, runner);
    expect(ordered).toHaveLength(2);
    // form is irrelevant to endurance so it should sink below plans
    expect(ordered[ordered.length - 1].id).toBe("form");
  });
});
