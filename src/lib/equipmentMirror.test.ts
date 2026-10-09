// Guards the equipment mirror that generate-plan imports at boot.
//
// Why this test exists: the plan model is told what equipment the athlete has
// from `supabase/functions/_shared/equipment.ts`, and the athlete picks from
// `src/config/equipment.ts`. Those are two copies of the same catalogue in two
// runtimes that cannot import each other. If they drift, the app offers a
// facility the prompt never mentions — or worse, the prompt describes a cue for
// an id the picker no longer produces. The failure is silent: the plan is still
// generated, it just prescribes the wrong thing.
//
// So this imports both and compares them field by field. Editing one without
// the other fails here rather than in an athlete's training week.

import { describe, expect, it } from "vitest";

import * as app from "@/config/equipment";
import * as edge from "../../supabase/functions/_shared/equipment";

describe("equipment catalogue mirror", () => {
  it("declares exactly the same ids, in the same order", () => {
    expect(edge.EQUIPMENT.map((e) => e.id)).toEqual(app.EQUIPMENT.map((e) => e.id));
  });

  it("agrees on every label, group and plan cue", () => {
    for (const item of app.EQUIPMENT) {
      const other = edge.EQUIPMENT.find((e) => e.id === item.id);
      expect(other, `${item.id} exists in the app but not in the edge mirror`).toBeTruthy();
      expect(other!.label, `${item.id} label differs`).toBe(item.label);
      expect(other!.group, `${item.id} group differs`).toBe(item.group);
      expect(other!.planCue, `${item.id} planCue differs`).toBe(item.planCue);
    }
  });

  it("normalises the same way, including dropping unknown ids", () => {
    const input = ["pool_25m", "bike", "not_a_real_facility", 42, "pool_25m"];
    expect(edge.normaliseEquipment(input)).toEqual(app.normaliseEquipment(input));
    expect(edge.normaliseEquipment(input)).toEqual(["pool_25m", "bike"]);
    // Anything that is not an array is "not stated", never a crash.
    for (const bad of [null, undefined, "pool_25m", {}, 7]) {
      expect(edge.normaliseEquipment(bad)).toEqual([]);
      expect(app.normaliseEquipment(bad)).toEqual([]);
    }
  });

  it("produces the same directive for the same input", () => {
    for (const ids of [[], ["none"], ["pool_25m"], ["pool_25m", "bike"], ["none", "bike"]] as const) {
      expect(edge.equipmentDirective([...ids])).toBe(app.equipmentDirective([...ids]));
    }
  });

  it("never permits equipment when the athlete said they have none", () => {
    // The load-bearing safety property. "none" must not be listed as available,
    // and the directive must forbid gym/pool/bike/track work outright.
    const directive = edge.equipmentDirective(["none", "bike"]);
    expect(directive).toMatch(/no equipment/i);
    expect(directive).toMatch(/Do not prescribe gym, pool, bike or track sessions/i);
    expect(directive).not.toContain("A bike is available");
  });

  it("tells the model the pool is a real facility, not an assumption", () => {
    const directive = edge.equipmentDirective(["pool_25m"]);
    expect(directive).toContain("25 m or longer pool");
    expect(directive).toContain("swim cross-training");
    expect(directive).toMatch(/Do NOT prescribe any session requiring equipment that is not on this list/);
  });
});
