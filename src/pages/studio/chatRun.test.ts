// ============================================================================
// chatRun.test — which assistant plans may run without another approval
// ----------------------------------------------------------------------------
// The assistant can answer, research or create. Only creation plans are handed
// straight to the run button; a plan that is pure talk stays a reply. These
// tests pin that split so a new step type cannot silently make "Run" appear on
// something that creates nothing.
// ============================================================================

import { describe, expect, it } from "vitest";
import { isRunnable, type PlanStep } from "./chatRun";

describe("isRunnable", () => {
  it("accepts creation plans and rejects everything else", () => {
    expect(isRunnable([{ type: "video_ad", options: {} }] as PlanStep[])).toBe(true);
    expect(isRunnable([{ type: "image_ad", options: {} }] as PlanStep[])).toBe(true);
    expect(
      isRunnable([{ type: "competitor_research", options: {} }, { type: "campaign_analyse", options: {} }] as PlanStep[]),
    ).toBe(false);
    expect(isRunnable([])).toBe(false);
  });
});
