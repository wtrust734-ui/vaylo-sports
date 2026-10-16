// ============================================================================
// PLAN EXPORT — take your plan with you
// ----------------------------------------------------------------------------
// The "funnel in, funnel out" half of the ecosystem pitch: Vaylo is the brain,
// the athlete's calendar and head unit are everywhere else. ICS drops the
// plan into any calendar app; GPX carries workouts to Garmin-class devices.
//
// Both builders are pure string functions over the plan's DATED sessions
// (from planSchedule.flattenPlan), which is the module that already knows how
// to place generated weeks on real calendar days and how to mark rest days,
// so nothing here duplicates scheduling math — and nothing here talks to the
// network, which is what makes the export verifiable and offline.
// ============================================================================

import type { DatedSession } from "@/lib/planSchedule";

/** What an athlete picked when exporting. */
export type PlanExportFormat = "ics" | "gpx";

/** Pad to the widths RFC 5545 / ICS demands. */
const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** YYYY-MM-DD (local day key) -> ICS UTC-ish floating timestamp at 09:00. */
const icsStamp = (dayKey: string): string => {
  const d = new Date(`${dayKey}T09:00:00`);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T` +
    `${pad(d.getHours())}${pad(d.getMinutes())}00`
  );
};

/** Fold long lines per RFC 5545 (75 octets, CRLF + leading space). */
const foldLine = (line: string): string => {
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 0) {
    chunks.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return chunks.join("\r\n");
};

const escapeIcs = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

const icalUid = (session: DatedSession): string =>
  `vaylo-${session.id}@vaylosports.app`;

/**
 * Build an .ics file from dated plan sessions. Non-rest sessions become
 * all-day floating events (no timezone math to get wrong on import); rest
 * days are skipped on purpose — a calendar full of "Rest" invitations is
 * noise, and the plan screen already shows them.
 */
export function buildPlanIcs(
  sessions: readonly DatedSession[],
  planTitle: string
): string {
  const workout = sessions.filter((s) => !s.isRest);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vaylo Sports//Training Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(planTitle)}`,
  ];
  for (const s of workout) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icalUid(s)}`,
      `DTSTAMP:${icsStamp(s.scheduled_date)}`,
      `DTSTART;VALUE=DATE:${s.scheduled_date.replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(s.title)}`,
      `DESCRIPTION:${escapeIcs(
        `Vaylo Sports — ${s.type}. Week ${s.week} of the plan. Open Vaylo Sports to log this session.`,
      )}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

const gpxEscape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const gpxTime = (dayKey: string): string => `${dayKey}T09:00:00Z`;

/**
 * Build a .gpx of the plan's workouts. GPX has no native "planned workout"
 * concept, so each session is written as a waypoint named for the session —
 * the convention Garmin devices surface on the calendar/cue-sheet side, and
 * the reason the waypoints carry type and week in their description.
 */
export function buildPlanGpx(
  sessions: readonly DatedSession[],
  planTitle: string
): string {
  const workout = sessions.filter((s) => !s.isRest);
  const header =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Vaylo Sports" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <metadata>\n    <name>${gpxEscape(planTitle)}</name>\n` +
    `    <desc>${gpxEscape(`Training plan export — ${workout.length} planned sessions`)}</desc>\n` +
    `  </metadata>\n`;
  const body = workout
    .map(
      (s) =>
        `  <wpt lat="0" lon="0">\n` +
        `    <name>${gpxEscape(`W${s.week} ${s.title}`)}</name>\n` +
        `    <desc>${gpxEscape(`${s.type} — scheduled ${s.scheduled_date}`)}</desc>\n` +
        `    <time>${gpxTime(s.scheduled_date)}</time>\n` +
        `  </wpt>\n`,
    )
    .join("");
  return header + body + `</gpx>\n`;
}

/** One entry point for the UI: pick the builder, get a downloadable string. */
export function buildPlanExport(
  sessions: readonly DatedSession[],
  planTitle: string,
  format: PlanExportFormat
): string {
  return format === "ics" ? buildPlanIcs(sessions, planTitle) : buildPlanGpx(sessions, planTitle);
}

/** Suggested filename, e.g. `vaylo-plan-2026-10-16.ics`. */
export function planExportFilename(format: PlanExportFormat): string {
  const d = new Date();
  return `vaylo-plan-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${format}`;
}
