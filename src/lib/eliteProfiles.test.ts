import { describe, expect, it } from "vitest";
import {
  ELITE_GROUPS,
  ELITE_GROUPS_WITH_PROFILES,
  ELITE_PROFILES,
  groupForSport,
  profilesInGroup,
} from "./eliteProfiles";

/**
 * The comparison list is data, so its invariants are what is worth pinning:
 * unique targets, every group populated, the overall score derived rather than
 * hand-typed, and the athlete's own sport resolving to a real group.
 */
describe("elite comparison profiles", () => {
  it("has a target for essentially every sport the app ships", () => {
    expect(ELITE_PROFILES.length).toBeGreaterThanOrEqual(50);
    // Every group the picker offers must actually contain someone, or the chip
    // is a dead end.
    for (const g of ELITE_GROUPS_WITH_PROFILES) {
      expect(profilesInGroup(g.group).length, `${g.group} is empty`).toBeGreaterThan(0);
    }
    expect(ELITE_GROUPS_WITH_PROFILES.length).toBeGreaterThanOrEqual(10);
  });

  it("uses one stable, unique id per target", () => {
    const ids = ELITE_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names a real athlete with a verifiable credential, never a placeholder", () => {
    for (const p of ELITE_PROFILES) {
      expect(p.name.trim().length, `${p.id} has no athlete`).toBeGreaterThan(2);
      expect(p.event.trim().length, `${p.id} has no event`).toBeGreaterThan(1);
      expect(p.credential.trim().length, `${p.id} has no credential`).toBeGreaterThan(10);
      expect(p.country.trim().length, `${p.id} has no country`).toBeGreaterThan(1);
      expect(p.credential, `${p.id} still reads like a stub`).not.toMatch(/lorem|tbd|todo/i);
    }
  });

  it("derives overall_vpr from the six indices so it can never drift", () => {
    for (const p of ELITE_PROFILES) {
      const s = p.profile;
      const mean = Math.round(
        (s.speed_index + s.power_index + s.endurance_capacity + s.repeatability + s.skill_consistency + s.reaction_efficiency) / 6,
      );
      expect(s.overall_vpr, `${p.id} overall mismatch`).toBe(mean);
      for (const v of [s.speed_index, s.power_index, s.endurance_capacity, s.repeatability, s.skill_consistency, s.reaction_efficiency]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("puts every profile in a declared group", () => {
    const groups = new Set(ELITE_GROUPS.map((g) => g.group));
    for (const p of ELITE_PROFILES) {
      expect(groups.has(p.group), `${p.id} has an undeclared group`).toBe(true);
    }
  });

  it("opening on the athlete's own sport lands on a real group", () => {
    // The whole point of the widening: an 800m runner must not open on a
    // marathoner's or a Formula 1 driver's target.
    expect(groupForSport("Running")).toBe("Athletics");
    expect(groupForSport("Swimming")).toBe("Swimming");
    expect(groupForSport("Football")).toBe("Team sports");
    expect(groupForSport("Gym/Weightlifting")).toBe("Strength sports");
    expect(groupForSport("MMA")).toBe("Combat sports");
    // An unknown sport still resolves to a populated group, never to nothing.
    expect(groupForSport("Quidditch")).toBe(ELITE_PROFILES[0].group);
    expect(groupForSport(null)).toBe(ELITE_PROFILES[0].group);
  });

  it("covers the middle-distance events, not only the marathon", () => {
    const events = profilesInGroup("Athletics").map((p) => p.event);
    for (const e of ["800m", "1500m", "5000m", "10000m", "Marathon"]) {
      expect(events, `${e} has no benchmark`).toContain(e);
    }
  });
});
