// Tests for the plan-export builders. These pin the wire formats (RFC 5545
// ICS, GPX 1.1) well enough that a calendar app or head unit either parses
// what we emit or these tests fail — the failure mode we care about is
// "silent junk file", which no typecheck can catch.

import { describe, expect, it } from "vitest";
import { buildPlanExport, buildPlanGpx, buildPlanIcs, planExportFilename } from "@/lib/planExport";
import type { DatedSession } from "@/lib/planSchedule";

const session = (over: Partial<DatedSession> = {}): DatedSession => ({
  id: "p1:2:3",
  planId: "p1",
  week: 2,
  day: 3,
  scheduled_date: "2026-10-21",
  title: "Interval session",
  type: "interval",
  isRest: false,
  important: true,
  ...over,
});

describe("ICS export", () => {
  it("emits a valid VCALENDAR with one VEVENT per non-rest session", () => {
    const ics = buildPlanIcs(
      [session(), session({ id: "p1:2:4", day: 4, title: "Easy run", type: "easy", isRest: true }), session({ id: "p1:3:1", week: 3, day: 1, scheduled_date: "2026-10-26", title: "Long run" })],
      "Autumn 10k block",
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2); // rest day skipped
    expect(ics).toContain("SUMMARY:Interval session");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261021");
    expect(ics).toContain("X-WR-CALNAME:Autumn 10k block");
  });

  it("escapes commas, semicolons and newlines in titles", () => {
    const ics = buildPlanIcs([session({ title: "Track, 400m; hard" })], "Plan, with; bits");
    expect(ics).toContain("SUMMARY:Track\\, 400m\\; hard");
    expect(ics).toContain("X-WR-CALNAME:Plan\\, with\\; bits");
  });

  it("uses CRLF line endings and folds lines longer than the 75-octet rule", () => {
    const ics = buildPlanIcs(
      [session({ title: "A very long session title that goes on and on ".repeat(4) })],
      "Plan",
    );
    expect(ics).toContain("\r\n");
    for (const line of ics.split("\r\n")) {
      expect(line.length + (line.startsWith(" ") ? 0 : 0)).toBeLessThanOrEqual(74);
    }
  });

  it("folds before 75 octets with the continuation space", () => {
    const ics = buildPlanIcs([session({ title: "x".repeat(150) })], "Plan");
    const descLine = ics.split("\r\n").find((l) => l.startsWith("DESCRIPTION:"));
    expect(descLine).toBeDefined();
    expect(descLine!.length).toBeLessThanOrEqual(74);
  });
});

describe("GPX export", () => {
  it("emits GPX 1.1 with a waypoint per workout", () => {
    const gpx = buildPlanGpx([session(), session({ id: "p1:2:4", day: 4, isRest: true })], "Autumn block");
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx.match(/<wpt /g)?.length).toBe(1); // rest skipped
    expect(gpx).toContain("<name>W2 Interval session</name>");
    expect(gpx).toContain("<time>2026-10-21T09:00:00Z</time>");
  });

  it("XML-escapes titles", () => {
    const gpx = buildPlanGpx([session({ title: "Tempo <hard> & fast" })], "P");
    expect(gpx).toContain("Tempo &lt;hard&gt; &amp; fast");
  });
});

describe("shared entry point", () => {
  it("buildPlanExport dispatches by format, and the filename matches", () => {
    const sess = [session()];
    expect(buildPlanExport(sess, "P", "ics")).toContain("VCALENDAR");
    expect(buildPlanExport(sess, "P", "gpx")).toContain("<gpx");
    const name = planExportFilename("ics");
    expect(name).toMatch(/^vaylo-plan-\d{4}-\d{2}-\d{2}\.ics$/);
  });
});
