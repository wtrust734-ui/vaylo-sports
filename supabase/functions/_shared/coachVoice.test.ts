// Guard-rails for the coach voice map. Lives beside the shared module so the
// functions typecheck project picks it up via vitest include patterns.

import { describe, expect, it } from "vitest";

import { coachVoiceDirective, familyForCoach } from "./coachVoice";

describe("familyForCoach", () => {
  it("maps onboarding sports to the right families", () => {
    expect(familyForCoach("Running")).toBe("endurance");
    expect(familyForCoach("Triathlon")).toBe("endurance");
    expect(familyForCoach("Football")).toBe("team");
    expect(familyForCoach("Basketball")).toBe("team");
    expect(familyForCoach("Rugby")).toBe("team");
    expect(familyForCoach("Tennis")).toBe("skill");
    expect(familyForCoach("Weightlifting")).toBe("strength");
    expect(familyForCoach("Climbing")).toBe("strength");
    expect(familyForCoach("MMA / Boxing")).toBe("combat");
  });

  it("handles comma-separated sport lists (primary sport wins)", () => {
    expect(familyForCoach("Running, Weightlifting")).toBe("endurance");
  });

  it("falls back to multi for unknown or empty sports", () => {
    expect(familyForCoach("")).toBe("multi");
    expect(familyForCoach(null)).toBe("multi");
    expect(familyForCoach("Quidditch")).toBe("multi");
  });

  it("is case-insensitive and whitespace tolerant", () => {
    expect(familyForCoach("  running ")).toBe("endurance");
  });
});

describe("coachVoiceDirective", () => {
  it("returns a distinct directive per family", () => {
    const voices = new Set(
      (["endurance", "team", "skill", "strength", "combat", "multi"] as const).map(coachVoiceDirective)
    );
    expect(voices.size).toBe(6);
  });

  it("never returns an empty directive", () => {
    expect(coachVoiceDirective("Running").length).toBeGreaterThan(40);
    expect(coachVoiceDirective("Quidditch").length).toBeGreaterThan(40);
  });

  it("keeps safety language in the combat voice", () => {
    // The combat directive must never encourage unsafe weight-cutting.
    const voice = coachVoiceDirective("MMA / Boxing").toLowerCase();
    expect(voice).toContain("never advise dehydration");
  });
});
