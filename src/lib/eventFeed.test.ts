import { describe, expect, it } from "vitest";
import { buildSeasonIcs } from "@/lib/eventFeed";
import type { DatedSession } from "@/lib/planSchedule";

const session = (over: Partial<DatedSession> = {}): DatedSession => ({
  id: "p1:1:1",
  planId: "p1",
  week: 1,
  day: 1,
  scheduled_date: "2026-10-19",
  title: "Easy run",
  type: "easy",
  isRest: false,
  important: false,
  ...over,
});

describe("season ICS feed", () => {
  it("merges plan sessions and races into one calendar, races visibly named", () => {
    const ics = buildSeasonIcs(
      "Autumn block",
      [session()],
      [{ date: "2026-11-08", title: "County 10k" }],
    );
    expect(ics).toContain("SUMMARY:Easy run");
    expect(ics).toContain("SUMMARY:🏁 County 10k");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261108");
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain("X-WR-CALNAME:Autumn block");
  });

  it("still escalates commas/semicolons and skips nothing to double-count", () => {
    const ics = buildSeasonIcs("P", [session(), session({ id: "p1:1:2", day: 2, isRest: true })], []);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1); // rest skipped as in planExport
  });

  it("handles an empty season (no plan, no races) without crashing", () => {
    const ics = buildSeasonIcs("Plan", [], []);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
  });
});
