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
  it("never hides a purchased surface, and still tailors optional depth", () => {
    // training.form and recover.nutrition are PAID surfaces (Form Analysis,
    // Nutrition Pack). This test used to pin the opposite — /form hidden from a
    // pure endurance athlete — and that is exactly how a priced feature became
    // unfindable: the Market quoted its price and the athlete's own nav removed
    // the way to it. Personalisation may order a purchasable surface, never
    // remove it. /skills is optional depth, not a product, and stays tailored.
    expect(isFeatureRelevant("training.form", ["endurance"])).toBe(true);
    expect(isFeatureRelevant("training.form", ["skill"])).toBe(true);
    expect(isFeatureRelevant("recover.nutrition", ["skill"])).toBe(true);
    expect(isFeatureRelevant("perform.skills", ["endurance"])).toBe(false);
  });

  it("shows a sport-specific surface only to the sports it is priced for", () => {
    // Pinned `compete.opponents` until that surface was removed on 2026-10-08.
    // Same shape, on a feature that still ships: visible to the families it is
    // priced for, hidden from a pure endurance athlete.
    expect(isFeatureRelevant("perform.skills", ["team"])).toBe(true);
    expect(isFeatureRelevant("perform.skills", ["endurance"])).toBe(false);
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

  it("keeps the shop reachable in every athlete's nav, and still tailors depth", () => {
    const runPaths = visibleFeatures(flatten(NAV_CATALOG), runner).map((i) => i.path);
    // Paid surfaces — see the note in features.ts. A runner could not reach
    // /form or /nutrition before, while both were priced in the Market.
    expect(runPaths).toContain("/form");
    expect(runPaths).toContain("/nutrition");
    // Optional depth is still tailored: skill analytics is not a product.
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
      // A family-scoped surface, so the runner's ordering has something to move:
      // optional depth sinks, universal surfaces stay put. (This used
      // training.form, which is universal now — a universal feature has nothing
      // to sink relative to.)
      { feature: "perform.skills" as const, id: "skills" },
      { feature: "training.plans" as const, id: "plans" },
    ];
    const ordered = orderByRelevance(items, runner);
    expect(ordered).toHaveLength(2);
    // skills is irrelevant to endurance so it should sink below plans
    expect(ordered[ordered.length - 1].id).toBe("skills");
  });
});
