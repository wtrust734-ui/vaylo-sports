// ============================================================================
// SEASON FEED — one calendar file for the athlete's season
// ----------------------------------------------------------------------------
// The event-loop play made portable: an athlete's season is their plan plus
// their races. This module merges both into a single ICS file so "subscribe to
// your season" works in whatever calendar they already live in — the same
// loop that pushes them back into the app (a race approaching) also reaches
// them on the surface they check most.
//
// Reuses buildPlanIcs for the wire format; the only work here is merging two
// sources and naming events distinctly so a race is never mistaken for a
// training session.
// ============================================================================

import { buildPlanIcs } from "@/lib/planExport";
import type { DatedSession } from "@/lib/planSchedule";

export interface SeasonRace {
  /** life_events.start_date (YYYY-MM-DD). */
  date: string;
  title: string;
}

/**
 * Build the season ICS. Plan sessions keep their own titles; races are
 * prefixed so they stand out, and multi-day races occupy one all-day event
 * (the season file is a view, not the source of truth for race logistics).
 */
export function buildSeasonIcs(
  planTitle: string,
  sessions: readonly DatedSession[],
  races: readonly SeasonRace[],
): string {
  const raceEvents = races.map(
    (r): DatedSession => ({
      id: `race:${r.date}:${r.title}`,
      planId: "races",
      week: 0,
      day: 0,
      scheduled_date: r.date,
      title: `🏁 ${r.title}`,
      type: "competition",
      isRest: false,
      important: true,
    }),
  );
  return buildPlanIcs([...sessions, ...raceEvents], planTitle);
}
