import { describe, expect, it } from "vitest";

import { familyPriorityFor, orderByFamily, wantsSportBank } from "./challengeSuggestions";
import type { AthleteProfile } from "./engine";

describe("familyPriorityFor", () => {
  it("puts distance first for endurance athletes", () => {
    expect(familyPriorityFor(["Running"])[0]).toBe("distance");
    expect(familyPriorityFor(["Cycling", "Swimming"])[0]).toBe("distance");
  });

  it("puts count first for team/strength/combat athletes", () => {
    expect(familyPriorityFor(["Football"])[0]).toBe("count");
    expect(familyPriorityFor(["Weightlifting"])[0]).toBe("count");
    expect(familyPriorityFor(["MMA / Boxing"])[0]).toBe("count");
  });

  it("falls back to multi for unknown sports", () => {
    expect(familyPriorityFor(["Quidditch"])).toEqual(familyPriorityFor([]));
  });
});

describe("orderByFamily", () => {
  const suggestions = [
    { title: "a", type: "count" },
    { title: "b", type: "distance" },
    { title: "c", type: "duration" },
  ];

  it("promotes distance suggestions for a runner (stable)", () => {
    const ordered = orderByFamily(suggestions, ["Running"]);
    expect(ordered[0].title).toBe("b");
    expect(ordered).toHaveLength(3); // reorder, never remove
  });

  it("reorders per family priority for team athletes (duration > distance)", () => {
    const ordered = orderByFamily(suggestions, ["Football"]);
    // team priority is count > duration > distance, so authored distance sinks
    expect(ordered.map((s) => s.title)).toEqual(["a", "c", "b"]);
  });

  it("applies the multi priority for unknown families", () => {
    expect(orderByFamily(suggestions, []).map((s) => s.title)).toEqual(["a", "c", "b"]);
  });
});

describe("wantsSportBank", () => {
  it("is true only when a family is known", () => {
    expect(wantsSportBank({ sports: ["Running"], experience: "new" })).toBe(true);
    expect(wantsSportBank({ sports: [], experience: "new" })).toBe(false);
    expect(wantsSportBank({ sports: ["Quidditch"], experience: "established" })).toBe(false);
  });
});
