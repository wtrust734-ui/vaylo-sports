// ============================================================================
// The rules that decide what an athlete pays for and what gets rewritten.
// The splice is the dangerous one: a plan that is edited into the wrong week is
// still a plan that renders, so nothing downstream would catch it.
// ============================================================================

import { describe, expect, it } from "vitest";

import { FEATURE_COSTS } from "@/config/credits";
import {
  MAX_EDIT_INSTRUCTION,
  editCost,
  editCostKey,
  spliceEditedWeeks,
  validateEditInstruction,
  weeksForEdit,
} from "./planEdit";

type Week = { week: number; sessions: { day: number; title: string }[] };

const week = (n: number, title = `Week ${n}`): Week => ({
  week: n,
  sessions: [{ day: 1, title }],
});

const plan: Week[] = [week(1, "Base 1"), week(2, "Base 2"), week(3, "Build 1"), week(4, "Deload")];

describe("what an edit costs", () => {
  it("bills a week edit and a whole-plan edit to different features", () => {
    expect(editCostKey("week")).toBe("plan_edit");
    expect(editCostKey("plan")).toBe("plan_edit_full");
    expect(editCost("week")).toBe(FEATURE_COSTS.plan_edit);
    expect(editCost("plan")).toBe(FEATURE_COSTS.plan_edit_full);
  });

  it("keeps editing cheaper than replacing the plan", () => {
    // The whole point of the feature: an athlete who cannot afford to change a
    // plan they already paid for abandons it instead. A whole-plan edit priced
    // at or above a fresh 4-week plan is a worse deal than starting again.
    expect(editCost("week")).toBeLessThan(editCost("plan"));
    expect(editCost("plan")).toBeLessThan(FEATURE_COSTS.training_plan_week * 4);
  });
});

describe("the instruction", () => {
  it("trims, and rejects what is not an instruction", () => {
    expect(validateEditInstruction("  swap Thursday for a swim  ")).toEqual({
      ok: true,
      instruction: "swap Thursday for a swim",
    });
    for (const empty of ["", "   ", "\n", null, undefined]) {
      expect(validateEditInstruction(empty).ok).toBe(false);
    }
    // A single letter is not a request.
    expect(validateEditInstruction("a").ok).toBe(false);
  });

  it("bounds the length at the same limit the server enforces", () => {
    const atLimit = "x".repeat(MAX_EDIT_INSTRUCTION);
    expect(validateEditInstruction(atLimit).ok).toBe(true);
    expect(validateEditInstruction("x".repeat(MAX_EDIT_INSTRUCTION + 1)).ok).toBe(false);
  });
});

describe("which weeks get sent", () => {
  it("sends one week for a week edit, chosen by number, not by position", () => {
    const shuffled = [week(4, "Deload"), week(1, "Base 1"), week(3, "Build 1")];

    expect(weeksForEdit(shuffled, "week", 1)).toEqual([week(1, "Base 1")]);
    expect(weeksForEdit(shuffled, "week", 4)).toEqual([week(4, "Deload")]);
    // A week that is not in the plan sends nothing — the server rejects it
    // rather than an edit being charged for a week that does not exist.
    expect(weeksForEdit(shuffled, "week", 9)).toEqual([]);
  });

  it("sends the whole plan for a whole-plan edit", () => {
    expect(weeksForEdit(plan, "plan", 1)).toHaveLength(4);
  });
});

describe("splicing the answer back in", () => {
  it("replaces by week number and leaves the rest alone", () => {
    const edited = [week(3, "Build 1 — knee-friendly")];
    const { plan: next, replaced } = spliceEditedWeeks(plan, edited, "week", 3);

    expect(replaced).toEqual([3]);
    expect(next[2].sessions[0].title).toBe("Build 1 — knee-friendly");
    // Untouched weeks are the SAME objects: nothing was cloned or renumbered.
    expect(next[0]).toBe(plan[0]);
    expect(next[3]).toBe(plan[3]);
    expect(next.map((w) => w.week)).toEqual([1, 2, 3, 4]);
  });

  it("is immune to the model returning weeks in a different order", () => {
    // This is the failure the whole design is for: the plan must not shift.
    const edited = [week(4, "Deload two"), week(2, "Base 2 two"), week(1, "Base 1 two")];
    const { plan: next } = spliceEditedWeeks(plan, edited, "plan", 1);

    expect(next.map((w) => w.sessions[0].title)).toEqual([
      "Base 1 two",
      "Base 2 two",
      "Build 1",
      "Deload two",
    ]);
  });

  it("refuses a week edit that tries to change a week it was not asked about", () => {
    // A rogue or confused response must not be able to rewrite next month.
    const edited = [week(3, "edited"), week(4, "edited too")];
    const { plan: next, replaced } = spliceEditedWeeks(plan, edited, "week", 3);

    expect(replaced).toEqual([3]);
    expect(next[3]).toBe(plan[3]);
  });

  it("never changes the number of weeks", () => {
    const edited = [week(3, "edited"), week(99, "invented")];
    const { plan: next, orphans } = spliceEditedWeeks(plan, edited, "plan", 1);

    expect(next).toHaveLength(plan.length);
    expect(next.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    // The invented week is reported rather than silently added.
    expect(orphans).toEqual([99]);
  });

  it("ignores junk instead of throwing on it", () => {
    const { plan: next, replaced } = spliceEditedWeeks(plan, [null, "week 2", 7, {}] as unknown[], "plan", 1);
    expect(next).toEqual(plan);
    expect(replaced).toEqual([]);
  });
});
