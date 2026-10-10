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

  it("shows a sport-specific surface only to the sports it is priced for", () => {
    // Pinned `compete.opponents` until that surface was removed on 2026-10-08.
    // Same shape, on a feature that still ships: visible to the families it is
    // priced for, hidden from a pure endurance athlete.
    expect(isFeatureRelevant("perform.skills", ["team"])).toBe(true);
    expect(isFeatureRelevant("perform.skills", ["endurance"])).toBe(false);
  });

  it("shows PBs only to PB sports: runners see it, cricketers and lifters do not", () => {
    expect(isFeatureRelevant("training.pbs", ["endurance"])).toBe(true);
    expect(isFeatureRelevant("training.pbs", ["multi"])).toBe(true);
    expect(isFeatureRelevant("training.pbs", ["team"])).toBe(false);
    expect(isFeatureRelevant("training.pbs", ["strength"])).toBe(false);
    expect(isFeatureRelevant("training.pbs", ["skill"])).toBe(false);
    expect(isFeatureRelevant("training.pbs", ["combat"])).toBe(false);
  });

  it("maps Cricket to the team family, so cricketers never see the PBs tab", () => {
    expect(familiesForProfile({ sports: ["Cricket"], experience: "established" })).toEqual(["team"]);
    const paths = visibleFeatures(
      NAV_CATALOG.flatMap((g) => g.items),
      { sports: ["Cricket"], experience: "established" },
    ).map((i) => i.path);
    expect(paths).not.toContain("/pbs");
    const runPaths = visibleFeatures(
      NAV_CATALOG.flatMap((g) => g.items),
      runner,
    ).map((i) => i.path);
    expect(runPaths).toContain("/pbs");
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

  // Technique-only surfaces stay hidden from pure endurance athletes. (This
  // used to assert the same about the AR overlay, which was a simulated preview
  // rather than a working feature and has been taken out of the nav catalog.)
  it("removes technique-first analysis for a runner, keeps it for a footballer", () => {
    // Second assertion used to pin /opponents, removed with that surface on
    // 2026-10-08. /skills carries the same meaning: priced for skill, team,
    // combat and multi-sport athletes, hidden from pure endurance.
    const runPaths = visibleFeatures(flatten(NAV_CATALOG), runner).map((i) => i.path);
    expect(runPaths).not.toContain("/form");
    expect(runPaths).not.toContain("/skills");

    const footPaths = visibleFeatures(flatten(NAV_CATALOG), baller).map((i) => i.path);
    expect(footPaths).toContain("/form");
    expect(footPaths).toContain("/skills");
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
      { feature: "training.pbs" as const, newFirst: false, establishedFirst: true, id: "pbs" },
      { feature: "training.plans" as const, newFirst: true, id: "plans" },
    ];
    const ordered = orderForExperience(items, { sports: ["Running"], experience: "new" });
    expect(ordered[0].id).toBe("plans");
  });

  it("established athletes see depth surfaces first", () => {
    const items = [
      { feature: "training.plans" as const, newFirst: true, id: "plans" },
      { feature: "training.pbs" as const, establishedFirst: true, id: "pbs" },
    ];
    const ordered = orderForExperience(items, { sports: ["Running"], experience: "established" });
    expect(ordered[0].id).toBe("pbs");
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
