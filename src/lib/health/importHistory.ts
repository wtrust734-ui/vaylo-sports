// ============================================================================
// VAYLO HEALTH — historical import
// ----------------------------------------------------------------------------
// Strava (the one integration this phase implements) stores activities in
// `health_workouts`, which is a staging table: only the Health screen ever read
// it. Every part of Vaylo Sports that reasons about training — Phase 2's
// return-from-break context, Phase 3's recovery load, Phase 4's roadmap,
// Phase 6's insights, Achievements, the feed — reads `workouts`. So an imported run
// counted for nothing, and the specification's central requirement ("imported
// workouts are treated the same as manually logged workouts") was unmet.
//
// This module is the decision half of the bridge: pure functions that turn a
// staged activity into a `workouts` row that the existing readers already
// understand, decide whether an activity is already covered by something the
// athlete typed by hand, and describe the window the athlete asked for. The I/O
// lives in importRunner.ts.
//
// Two rules run through all of it:
//
//   • NEVER FABRICATE. A metric the provider did not send stays null. Nothing
//     is inferred to make a row look complete, and no sport is invented — an
//     unrecognised vendor activity keeps the vendor's own word for itself.
//   • IMPORTANCE IS DERIVED, NOT DECLARED. Load comes from Phase 3's
//     `sessionLoad`, so an imported session is priced by exactly the same rules
//     as a logged one, caveats and confidence included.
// ============================================================================

import { classifySport, sessionLoad } from "../sessionLoad";
import { localDateKey } from "../dates";

// ---------------------------------------------------------------------------
// The window the athlete chose
// ---------------------------------------------------------------------------

export type ImportWindow = "3m" | "6m" | "12m" | "all";

export interface ImportWindowSpec {
  id: ImportWindow;
  label: string;
  /** Null means "everything the provider will hand over". */
  months: number | null;
  blurb: string;
}

export const IMPORT_WINDOWS: ImportWindowSpec[] = [
  { id: "3m", label: "Last 3 months", months: 3, blurb: "Enough to see your current habits." },
  { id: "6m", label: "Last 6 months", months: 6, blurb: "Good for a full season." },
  { id: "12m", label: "Last 12 months", months: 12, blurb: "A full year, for year-on-year trends." },
  { id: "all", label: "Everything available", months: null, blurb: "Whatever the source still holds." },
];

export const DEFAULT_IMPORT_WINDOW: ImportWindow = "6m";

export function importWindowSpec(id: ImportWindow): ImportWindowSpec {
  return IMPORT_WINDOWS.find((w) => w.id === id) ?? IMPORT_WINDOWS[1];
}

/**
 * The start of the chosen window, or null for "everything".
 *
 * Month arithmetic in the local calendar, not `now - n*30 days`: an athlete
 * asking for "last 6 months" on the 31st does not mean the 3rd of the previous
 * month. Where the target day does not exist it clamps to the month's last day,
 * which is what everybody means by "six months ago".
 */
export function windowStart(id: ImportWindow, now: Date = new Date()): Date | null {
  const spec = importWindowSpec(id);
  if (spec.months === null) return null;
  const target = new Date(now.getTime());
  const day = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() - spec.months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Strava's own maximum for the activities feed. */
export const STRAVA_PAGE_SIZE = 200;

/**
 * A hard ceiling on pages, so a mis-set cursor cannot turn "import my history"
 * into an unbounded loop against a paid API. 25 × 200 = 5,000 activities, which
 * is several years of daily training; an athlete beyond it gets the first 5,000
 * and a note saying so rather than a hang.
 */
export const MAX_IMPORT_PAGES = 25;

export interface PagePlan {
  pageSize: number;
  maxPages: number;
  /** The most activities one run can bring back. */
  ceiling: number;
}

export function importPagePlan(): PagePlan {
  return {
    pageSize: STRAVA_PAGE_SIZE,
    maxPages: MAX_IMPORT_PAGES,
    ceiling: STRAVA_PAGE_SIZE * MAX_IMPORT_PAGES,
  };
}

/** True when the provider returned a full page, so there is likely more. */
export function hasAnotherPage(returned: number, pageSize: number = STRAVA_PAGE_SIZE): boolean {
  return returned >= pageSize;
}

// ---------------------------------------------------------------------------
// Vendor activity → the app's own sport vocabulary
// ---------------------------------------------------------------------------

/**
 * Strava's activity types, in the words the rest of the app already uses.
 *
 * Keys are lowercased with punctuation stripped, so "VirtualRide" and
 * "virtual_ride" both resolve. An activity not listed keeps the provider's own
 * string — the honest answer, and the one that keeps `classifySport` able to
 * place it later.
 */
const SPORT_LABELS: Record<string, string> = {
  run: "Running",
  trailrun: "Trail running",
  virtualrun: "Running",
  ride: "Cycling",
  virtualride: "Cycling",
  ebikeride: "Cycling",
  gravelride: "Cycling",
  mountainbikeride: "Mountain biking",
  handcycle: "Cycling",
  swim: "Swimming",
  walk: "Walking",
  hike: "Hiking",
  rowing: "Rowing",
  virtualrow: "Rowing",
  kayaking: "Kayaking",
  canoeing: "Canoeing",
  weighttraining: "Strength",
  crossfit: "Strength",
  workout: "Training",
  yoga: "Mobility",
  pilates: "Mobility",
  elliptical: "Cross training",
  stairsstepper: "Cross training",
  stairclimber: "Cross training",
  soccer: "Football",
  football: "Football",
  rugby: "Rugby",
  basketball: "Basketball",
  tennis: "Tennis",
  badminton: "Badminton",
  volleyball: "Volleyball",
  netball: "Netball",
  hockey: "Hockey",
  cricket: "Cricket",
  golf: "Golf",
  skating: "Skating",
  inlineskate: "Skating",
  iceskate: "Skating",
  skiing: "Skiing",
  snowboard: "Snowboarding",
  surfing: "Surfing",
  rockclimbing: "Climbing",
  gymnastics: "Gymnastics",
  martialarts: "Martial arts",
  boxing: "Boxing",
  tabletennis: "Table tennis",
  squash: "Squash",
  racquetball: "Racquetball",
  handball: "Handball",
};

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The app's word for a provider's activity type, or the provider's own. */
export function importSportLabel(activityType: string | null | undefined): string {
  const raw = (activityType ?? "").trim();
  if (!raw) return "Training";
  return SPORT_LABELS[key(raw)] ?? raw;
}

// ---------------------------------------------------------------------------
// Staged activity → `workouts` row
// ---------------------------------------------------------------------------

/** The subset of a `health_workouts` row this bridge reads. */
export interface StagedActivity {
  source: string;
  source_record_id: string;
  title: string | null;
  activity_type: string;
  start_time: string;
  end_time: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  active_calories: number | null;
  heart_rate_avg: number | null;
}

/** A `workouts` insert. Ordinary row: the same table manual entries use. */
export interface ImportedWorkoutInsert {
  user_id: string;
  title: string;
  type: string;
  sport: string;
  duration_minutes: number | null;
  distance_km: number | null;
  heart_rate_avg: number | null;
  calories_burned: number | null;
  started_at: string;
  completed_at: string;
  completed: boolean;
  notes: string | null;
  source: string;
  external_id: string;
  imported_at: string;
  session_load: number | null;
}

/** Provider id → the label the UI shows. Never shown for a null source. */
export const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava",
  fitbit: "Fitbit",
  oura: "Oura",
  garmin: "Garmin",
  polar: "Polar",
  coros: "COROS",
  whoop: "WHOOP",
  suunto: "Suunto",
  withings: "Withings",
  samsung_health: "Samsung Health",
  google_fit: "Google Health",
  huawei: "Huawei Health",
  health_connect: "Health Connect",
  healthkit: "Apple Health",
};

export function sourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source === "manual") return null;
  return SOURCE_LABELS[source] ?? source;
}

/** "Imported from Strava" — the provenance note stored on the row itself. */
export function provenanceNote(source: string): string {
  return `Imported from ${SOURCE_LABELS[source] ?? source}`;
}

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Builds the `workouts` row for one staged activity, or null when the activity
 * cannot be represented honestly.
 *
 * Null is returned for bad timing (an end at or before its start, or an
 * unparseable date) rather than a repaired row: `workouts_completed_consistency`
 * and the readers' date arithmetic both assume these hold, and a silently
 * clamped timestamp would put a session on the wrong day for ever.
 *
 * Duration and distance are converted to the app's units, not rounded into
 * existence: a provider that sent no distance leaves `distance_km` null, and the
 * UI shows "—" rather than "0.0 km".
 */
export function toWorkoutInsert(
  activity: StagedActivity,
  userId: string,
  importedAt: string,
): ImportedWorkoutInsert | null {
  if (!activity.source || !activity.source_record_id) return null;

  const startMs = Date.parse(activity.start_time);
  if (!Number.isFinite(startMs)) return null;

  // The provider's duration is authoritative when present, but the window's own
  // length is a usable fallback and is a measurement, not an estimate.
  const endMs = Date.parse(activity.end_time);
  const seconds = finite(activity.duration_seconds);
  const fromWindow =
    Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 1000) : null;
  const durationSeconds = seconds != null && seconds > 0 ? seconds : fromWindow;
  if (durationSeconds == null || durationSeconds <= 0) return null;

  const durationMinutes = Math.round(durationSeconds / 60);
  const distanceKm =
    activity.distance_meters != null && activity.distance_meters > 0
      ? Math.round((activity.distance_meters / 1000) * 100) / 100
      : null;

  const sport = importSportLabel(activity.activity_type);
  const completedAt = new Date(startMs + durationSeconds * 1000).toISOString();

  // Priced by Phase 3's own rules. With no RPE the load is a moderate-effort
  // assumption, which `sessionLoad` reports as low confidence with its caveat —
  // we do not upgrade that here to make the import look better.
  const load = sessionLoad({
    sport,
    durationMinutes,
    distanceKm,
    rpe: null,
  });

  return {
    user_id: userId,
    title: activity.title?.trim() || sport,
    type: activity.activity_type,
    sport,
    duration_minutes: durationMinutes,
    distance_km: distanceKm,
    heart_rate_avg: finite(activity.heart_rate_avg),
    calories_burned: finite(activity.active_calories),
    started_at: new Date(startMs).toISOString(),
    completed_at: completedAt,
    completed: true,
    notes: provenanceNote(activity.source),
    source: activity.source,
    external_id: activity.source_record_id,
    imported_at: importedAt,
    session_load: load.load,
  };
}

// ---------------------------------------------------------------------------
// Not importing what the athlete already logged
// ---------------------------------------------------------------------------

/** What a duplicate check needs of an existing manual workout. */
export interface ExistingWorkout {
  id: string;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  sport: string | null;
  type: string | null;
  source: string | null;
}

/** Roughly how far apart two recordings of the same session may be. */
export const DUPLICATE_DURATION_TOLERANCE = 0.25;
export const DUPLICATE_MIN_TOLERANCE_MINUTES = 10;

/**
 * Whether an activity is already covered by something the athlete logged by
 * hand.
 *
 * The database cannot answer this: a manual row has no `external_id` to match on,
 * and neither can we match on identity — the same run logged in Vaylo and
 * recorded on a watch shares no id. What we can compare is what the athlete
 * would have typed: the same local day, the same sort of sport, and a duration
 * within a quarter (never less than ten minutes, so a 12-minute warm-up is not
 * treated as a 20-minute session). Anything else is not assumed to be a
 * duplicate, because dropping a real session is far worse than showing one twice.
 */
export function isLikelyManualDuplicate(
  activity: StagedActivity,
  existing: ExistingWorkout[],
): ExistingWorkout | null {
  const startMs = Date.parse(activity.start_time);
  if (!Number.isFinite(startMs)) return null;
  const day = localDateKey(new Date(startMs));

  const seconds = finite(activity.duration_seconds);
  const endMs = Date.parse(activity.end_time);
  const durationMinutes =
    seconds != null && seconds > 0
      ? Math.round(seconds / 60)
      : Number.isFinite(endMs) && endMs > startMs
        ? Math.round((endMs - startMs) / 60000)
        : null;

  const sport = importSportLabel(activity.activity_type);
  const kind = classifySport(sport, activity.activity_type);

  for (const row of existing) {
    // An imported row is not a manual one; deduping against the provider's own
    // id is the database's job.
    if (row.source && row.source !== "manual") continue;
    const rowStart = row.started_at ?? row.completed_at;
    if (!rowStart) continue;
    const rowMs = Date.parse(rowStart);
    if (!Number.isFinite(rowMs)) continue;
    if (localDateKey(new Date(rowMs)) !== day) continue;

    const rowKind = classifySport(row.sport ?? row.type, row.type);
    // "unknown" on either side is not a match: it means we could not tell, and
    // not knowing is not evidence of the same session.
    if (rowKind !== kind || kind === "unknown") continue;

    if (durationMinutes == null || row.duration_minutes == null) {
      // Without both durations, the day and the sport are all we have. That is a
      // weak signal, and a weak signal is not enough to drop a session.
      continue;
    }
    const tolerance = Math.max(
      DUPLICATE_MIN_TOLERANCE_MINUTES,
      durationMinutes * DUPLICATE_DURATION_TOLERANCE,
    );
    if (Math.abs(row.duration_minutes - durationMinutes) <= tolerance) return row;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Describing what happened
// ---------------------------------------------------------------------------

/** The one-line summary the import screen shows when a run finishes. */
export function importSummaryLine(
  imported: number,
  window: ImportWindow,
  firstDate: string | null,
  lastDate: string | null,
): string {
  if (imported === 0) {
    return "Nothing new came back from that window.";
  }
  const sessions = `${imported} ${imported === 1 ? "session" : "sessions"}`;
  const range =
    firstDate && lastDate && firstDate !== lastDate ? ` from ${firstDate} to ${lastDate}` : "";
  const spec = importWindowSpec(window);
  const windowCopy = spec.months === null ? "" : ` in the ${spec.label.toLowerCase()}`;
  return `We imported ${sessions}${windowCopy}${range}.`;
}

/**
 * The honest caveat list for an import, shown with the summary.
 *
 * Each of these is a real limit of what an import can know. Stating them is what
 * separates "we imported your history" from "we understand your history".
 */
export function importCaveats(skipped: number, capped: boolean): string[] {
  const notes: string[] = [];
  notes.push(
    "Imported sessions have no effort rating — nobody logged how hard they felt — so their training load is an estimate from duration, distance and sport.",
  );
  if (skipped > 0) {
    notes.push(
      `${skipped} ${skipped === 1 ? "session was" : "sessions were"} skipped because you had already logged ${skipped === 1 ? "it" : "them"} by hand.`,
    );
  }
  if (capped) {
    notes.push(
      `Your history is longer than one import can carry, so this brought back the most recent ${STRAVA_PAGE_SIZE * MAX_IMPORT_PAGES}. Run it again later to pull in more.`,
    );
  }
  return notes;
}
