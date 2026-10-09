// ============================================================================
// BREAK VISIBILITY WIRING — an active availability window is visible outside
// /availability (2026-10-06 audit, finding B1)
// ----------------------------------------------------------------------------
// The bug was pure wiring: `life_events` had a live row, `/availability`
// rendered it, and the two surfaces an athlete actually lands on — the
// dashboard card and the plan screen — said "No training plan yet" with no
// mention of the holiday. Same pattern as phase6Wiring: the behaviour spans
// files, so the contract is pinned across them.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../.." + p), "utf8");

const SURFACES = [
  "/src/components/dashboard/DailyTrainingCard.tsx",
  "/src/pages/Training.tsx",
];

describe("active break is visible where the athlete lands", () => {
  it("gives both surfaces the same reader and the same banner", () => {
    for (const f of SURFACES) {
      expect(read(f), `${f} must render the break banner`).toContain("<ActiveBreakBanner");
      expect(read(f), `${f} must read today's window`).toContain("useActiveBreak");
    }
  });

  it("shows the banner BEFORE the no-plan empty state, not instead of it", () => {
    // The failure mode was an empty state that answered a question the athlete
    // did not have ("create a plan") while the real situation went unsaid.
    for (const f of SURFACES) {
      const src = read(f);
      expect(src.indexOf("ActiveBreakBanner event="), `${f}: banner before empty state`).toBeLessThan(
        src.indexOf("No training plan yet"),
      );
    }
  });

  it("routes the banner to /availability, where a break is managed", () => {
    expect(read("/src/components/ActiveBreakBanner.tsx")).toContain('to="/availability"');
  });

  it("reads only the signed-in athlete's window covering today", () => {
    const hook = read("/src/hooks/useActiveBreak.ts");
    expect(hook).toContain('.eq("user_id", user.id)');
    expect(hook).toContain('.lte("start_date", today)');
    expect(hook).toContain('.gte("end_date", today)');
  });

  it("lets a training-stopping window win an overlap", () => {
    // Several windows can cover one day (travel on top of a busy period). A
    // banner reading "busy period" while the athlete has the flu would
    // understate the very thing it exists to say.
    expect(read("/src/hooks/useActiveBreak.ts")).toContain('allow_training === "no"');
  });
});
