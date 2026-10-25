import { describe, expect, it } from "vitest";

import { hasOwnBackButton, shouldShowBackBar } from "./BackBar";

describe("one back control per screen", () => {
  it("shows the shell back bar on ordinary detail screens", () => {
    for (const path of ["/workouts", "/pbs", "/market", "/settings/purchases"]) {
      expect(shouldShowBackBar(path), path).toBe(true);
    }
  });

  it("does not add a second one above a screen that draws its own", () => {
    for (const path of [
      "/friends/athlete-1",
      "/admin/refunds",
      "/profile/athlete-1",
      "/challenges/abc",
      "/packs/half-marathon",
      "/learning/lesson-1",
      "/streaks",
      "/training",
    ]) {
      expect(shouldShowBackBar(path), path).toBe(false);
    }
  });

  it("keeps tab roots free of a back arrow", () => {
    for (const path of ["/", "/train", "/perform", "/profile"]) {
      expect(shouldShowBackBar(path), path).toBe(false);
    }
  });

  it("matches own-back routes by exact path or prefix, never by substring", () => {
    expect(hasOwnBackButton("/friends")).toBe(false);
    expect(hasOwnBackButton("/friends/athlete-1")).toBe(true);
    expect(hasOwnBackButton("/admin")).toBe(false);
    expect(hasOwnBackButton("/admin/refunds")).toBe(true);
  });
});
