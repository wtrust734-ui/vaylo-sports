import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import {
  NAV_CATALOG,
  QUICK_ACTIONS,
  ROUTE_UNLOCKS,
  isRouteEntitled,
  unlockForPath,
  visibleByEntitlement,
} from "./nav";

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
  it("keeps the Form tab for everyone: its content is filtered, its door is not", () => {
    // This used to assert the opposite — form hidden from pure endurance, on the
    // reading that "technique" is a skill-sport word. The rule was retired with
    // the Form pass: the tab is free and personalises what is INSIDE it by sport
    // family (src/lib/formDrills.ts — a runner reads running drills and is never
    // handed a footballer's), so hiding the whole tab only hid the free drill
    // library from the athletes who train technique most days of the week.
    for (const family of ["endurance", "team", "skill", "strength", "combat", "multi"] as const) {
      expect(isFeatureRelevant("training.form", [family]), `${family} cannot open the Form tab`).toBe(true);
    }
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
    // /skills is priced for skill, team, combat and multi-sport athletes and is
    // hidden from pure endurance. /form is no longer in this set: it became a
    // universal tab, and it is the one that personalises its content instead.
    const runPaths = visibleFeatures(flatten(NAV_CATALOG), runner).map((i) => i.path);
    expect(runPaths).not.toContain("/skills");
    expect(runPaths).toContain("/form");

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
      { feature: "perform.skills" as const, id: "skills" },
      { feature: "training.plans" as const, id: "plans" },
    ];
    const ordered = orderByRelevance(items, runner);
    expect(ordered).toHaveLength(2);
    // skills is irrelevant to endurance so it should sink below plans. (This
    // pinned `training.form` until form became a universal tab, which left it
    // relevant to every athlete and therefore no longer a sink.)
    expect(ordered[ordered.length - 1].id).toBe("skills");
  });
});

// ---------------------------------------------------------------------------
// Paid screens are ABSENT until they are owned
// ---------------------------------------------------------------------------
// The behaviour this pins: an athlete who has not bought Mental Gym or Injury
// Management does not have those rows in their navigation at all. A padlock on a
// menu row is an advert; the Market has a section for that. `hasFeature` is the
// same fact the Market and each feature's own paywall read, and it is true for
// Unlimited as well as a bought unlock.

describe("entitlement filtering over the nav catalog", () => {
  const flat = NAV_CATALOG.flatMap((g) => g.items);
  const ownsNone = () => false;
  const unlimited = () => true;
  const ownsMental = (feature: string) => feature === "mental_gym";
  const pathsFor = (hasFeature: (f: string) => boolean) =>
    visibleByEntitlement(flat, hasFeature).map((i) => i.path);

  it("drops every paid route for an athlete who owns none of them", () => {
    const shown = pathsFor(ownsNone);
    expect(shown).not.toContain("/mental");
    expect(shown).not.toContain("/injury");
  });

  it("shows a paid route once its own unlock is owned, and only that one", () => {
    const shown = pathsFor(ownsMental);
    expect(shown).toContain("/mental");
    expect(shown).not.toContain("/injury");
  });

  it("shows every paid route to Unlimited", () => {
    const shown = pathsFor(unlimited);
    for (const path of Object.keys(ROUTE_UNLOCKS)) expect(shown).toContain(path);
  });

  it("keeps the free surfaces, including the Market that sells the unlocks", () => {
    const shown = pathsFor(ownsNone);
    expect(shown).toContain("/market");
    expect(shown).toContain("/training");
    expect(shown).toContain("/nutrition");
  });

  it("never gates a quick action", () => {
    // The bottom nav's "+" sheet has no filtering of its own, so nothing paid
    // may be added to it: it would be the one surface that still shows a
    // purchase the athlete does not own.
    expect(visibleByEntitlement(QUICK_ACTIONS, ownsNone)).toHaveLength(QUICK_ACTIONS.length);
  });

  it("keeps the permanent bottom nav free of gated routes", () => {
    // BottomNav's tabs are hard-coded (Home, Train, Perform, Profile) and are
    // not filtered, so a paid route must never be added there.
    const source = readFileSync(
      join(resolve(__dirname, "..", "..", ".."), "src", "components", "layout", "BottomNav.tsx"),
      "utf8",
    );
    for (const path of Object.keys(ROUTE_UNLOCKS)) {
      expect(source.includes(`path: "${path}"`), `${path} is paid and cannot live in the bottom nav`).toBe(false);
    }
  });

  it("gates the catalogue item and the route map with the same key", () => {
    for (const [path, feature] of Object.entries(ROUTE_UNLOCKS)) {
      const item = flat.find((i) => i.path === path);
      expect(item, `${path} is gated but is not in the nav catalogue`).toBeTruthy();
      expect(item!.unlock).toBe(feature);
    }
    // ...and the other way round: an item that declares an unlock must be in the
    // map, or a hub tile for that route would still be shown.
    for (const item of flat) {
      if (!item.unlock) continue;
      expect(unlockForPath(item.path), `${item.path} declares an unlock the route map does not know`)
        .toBe(item.unlock);
    }
  });

  it("matches a sub-route to the paid screen that owns it", () => {
    expect(unlockForPath("/injury/123")).toBe("injury_management");
    expect(unlockForPath("/mental/")).toBe("mental_gym");
    expect(isRouteEntitled("/injury/123", ownsNone)).toBe(false);
    expect(isRouteEntitled("/training", ownsNone)).toBe(true);
    expect(isRouteEntitled("/nutrition", ownsNone)).toBe(true);
  });
});
