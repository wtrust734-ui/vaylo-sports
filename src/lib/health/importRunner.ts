// ============================================================================
// VAYLO HEALTH — historical import runner
// ----------------------------------------------------------------------------
// The I/O half of the import. `importHistory.ts` decides what a row should look
// like; this reads the staged activities, writes them to `workouts` and records
// what happened.
//
// Two things here carry the weight of the specification:
//
//   1. THE BRIDGE. Staged activities live in `health_workouts`, which only the
//      Health screen ever read. Writing them into `workouts` — the table Phase
//      2's return-from-break context, Phase 3's recovery load, Phase 4's roadmap
//      and the feed all query — is what makes an imported session count as
//      training rather than as a row in a staging area. From the database up,
//      there is no difference between an imported session and a typed one except
//      `source`, `external_id` and `imported_at`.
//
//   2. AN IMPORT THAT SURVIVES BEING STARTED OFFLINE. The request is itself a
//      queued write, so an athlete who taps Import in a dead spot gets a real
//      record of the intent that runs when the connection returns — not an
//      error toast and a lost tap. `runQueuedImports` is the other end of that.
//
// Nothing here fabricates: a provider that is not configured, a token that
// expired and a fetch that failed are all reported as what they are, and the
// import row keeps the reason.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";
import { insertOrQueue, isNetworkError, newId, updateOrQueue } from "../offlineQueue";
import { ageFromDob } from "../age";
import { localDateKey } from "../dates";
import {
  MAX_IMPORT_PAGES,
  STRAVA_PAGE_SIZE,
  importCaveats,
  importSummaryLine,
  importWindowSpec,
  isLikelyManualDuplicate,
  toWorkoutInsert,
  windowStart,
  type ExistingWorkout,
  type ImportWindow,
  type ImportedWorkoutInsert,
  type StagedActivity,
} from "./importHistory";
import {
  buildStartingAnalysis,
  type AnalysisGoal,
  type AnalysisSession,
  type StartingAnalysis,
} from "./startingAnalysis";

/**
 * The one integration this phase implements. The catalog holds fourteen; the
 * edge function has working activity mappers for strava, fitbit and oura, and
 * Strava is the one this flow is built and tested against end to end.
 */
export const IMPORT_SOURCE = "strava";

/** How far back the analysis reads when it describes the athlete's training. */
const ANALYSIS_LOOKBACK_DAYS = 180;

export type ImportStatus = "queued" | "running" | "completed" | "partial" | "failed";

export interface ImportRun {
  id: string;
  source: string;
  status: ImportStatus;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  note: string | null;
  windowStart: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportOutcome {
  ok: boolean;
  /** True when the request was recorded and will run on reconnect. */
  queued: boolean;
  importId: string | null;
  imported: number;
  updated: number;
  skipped: number;
  /** True when the provider had more history than one run could carry. */
  capped: boolean;
  summary: string | null;
  caveats: string[];
  analysis: StartingAnalysis | null;
  /** A machine reason for a failure, for branching in the UI. */
  error?:
    | "not_configured"
    | "token_expired"
    | "fetch_failed"
    /**
     * Vaylo Sports' own import service refused the request, so the provider was
     * never reached. Kept distinct from `fetch_failed` because telling an
     * athlete "Strava didn't answer" when the fault is ours is a lie about
     * somebody else's service.
     */
    | "service_error"
    | "unreachable"
    | "write_failed";
}

const emptyOutcome = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({
  ok: false,
  queued: false,
  importId: null,
  imported: 0,
  updated: 0,
  skipped: 0,
  capped: false,
  summary: null,
  caveats: [],
  analysis: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Reading staged activities, and the workouts they might duplicate
// ---------------------------------------------------------------------------

/** `health_workouts` in pages, so a long history is not truncated by a limit. */
async function readStaged(userId: string, source: string): Promise<StagedActivity[]> {
  const page = 1000;
  const rows: StagedActivity[] = [];
  for (let offset = 0; offset < MAX_IMPORT_PAGES * STRAVA_PAGE_SIZE; offset += page) {
    const { data, error } = await supabase
      .from("health_workouts")
      .select(
        "source, source_record_id, title, activity_type, start_time, end_time, duration_seconds, distance_meters, active_calories, heart_rate_avg",
      )
      .eq("user_id", userId)
      .eq("source", source)
      .eq("deleted", false)
      .order("start_time", { ascending: false })
      .range(offset, offset + page - 1);
    if (error) throw error;
    const batch = (data ?? []) as StagedActivity[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

/**
 * The athlete's own sessions across the same span, for duplicate detection.
 *
 * Bounded to the window the import covers, because the comparison is per-day and
 * a year of manual rows would be fetched to answer a question about last month.
 */
async function readManualSessions(userId: string, fromIso: string): Promise<ExistingWorkout[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, started_at, completed_at, duration_minutes, sport, type, source")
    .eq("user_id", userId)
    .gte("started_at", fromIso)
    .limit(2000);
  // A failed read here is "unknown", not "no history" — and read as empty it
  // makes every session the athlete already has look new, so the import writes
  // it a second time and the load and streak counts take it twice. Same
  // treatment as readStaged above: stop the run.
  if (readFailed(error, "the sessions you already have", { quiet: true })) throw error;
  const rows = (data ?? []) as ExistingWorkout[];
  return rows.filter((r) => !r.source || r.source === "manual");
}

/** External ids already stored for a source, so "new" and "refreshed" can be told apart. */
async function readKnownExternalIds(userId: string, source: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("workouts")
    .select("external_id")
    .eq("user_id", userId)
    .eq("source", source)
    .not("external_id", "is", null)
    .limit(10000);
  // This read is the whole of "new" versus "refreshed". Failed and treated as
  // empty, every activity already imported from this source is imported again as
  // new. Stop the run rather than duplicate the athlete's history.
  if (readFailed(error, "the activities already imported from this source", { quiet: true })) throw error;
  return new Set(
    ((data ?? []) as { external_id: string | null }[])
      .map((r) => r.external_id)
      .filter((v): v is string => !!v),
  );
}

export interface MirrorResult {
  imported: number;
  updated: number;
  skipped: number;
}

/**
 * Writes every staged activity for a source into `workouts`.
 *
 * The upsert's conflict target is `(user_id, source, external_id)`, so running
 * this twice updates the same rows rather than duplicating them — the guarantee
 * holds in the database, not in this function's memory. An activity the athlete
 * already logged by hand is skipped instead, because the database cannot know
 * that a manual row and a watch recording are the same session.
 */
export async function mirrorImportedWorkouts(
  userId: string,
  source: string = IMPORT_SOURCE,
): Promise<MirrorResult> {
  const staged = await readStaged(userId, source);
  if (!staged.length) return { imported: 0, updated: 0, skipped: 0 };

  const earliest = staged.reduce((min, r) => (r.start_time < min ? r.start_time : min), staged[0].start_time);
  const [manual, known] = await Promise.all([
    readManualSessions(userId, earliest),
    readKnownExternalIds(userId, source),
  ]);

  const importedAt = new Date().toISOString();
  const payload: ImportedWorkoutInsert[] = [];
  let skipped = 0;

  for (const activity of staged) {
    // A provider resending an activity only updates the source_record_id we
    // already hold; the duplicate pass is for rows the athlete typed.
    if (!known.has(activity.source_record_id) && isLikelyManualDuplicate(activity, manual)) {
      skipped++;
      continue;
    }
    const insert = toWorkoutInsert(activity, userId, importedAt);
    if (!insert) {
      skipped++;
      continue;
    }
    payload.push(insert);
  }

  const updated = payload.filter((r) => known.has(r.external_id)).length;
  const inserted = payload.length - updated;

  for (let i = 0; i < payload.length; i += 100) {
    const { error } = await supabase
      .from("workouts")
      .upsert(payload.slice(i, i + 100), { onConflict: "user_id,source,external_id" });
    if (error) throw error;
  }

  return { imported: inserted, updated, skipped };
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/**
 * Every session in the lookback window, imported and hand-logged alike.
 *
 * Exported because it is the ONE reader of "the athlete's logged sessions":
 * the starting analysis and Phase 6's insights both read `workouts` the same
 * way, and a second copy of this query is how two screens start disagreeing
 * about what a session is. `completed` is the filter — a planned session lives
 * in `plan_events`, not here.
 */
export async function readAnalysisSessions(userId: string): Promise<AnalysisSession[]> {
  const since = new Date(Date.now() - ANALYSIS_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("workouts")
    .select("started_at, completed_at, sport, type, title, duration_minutes, distance_km, session_load, source")
    .eq("user_id", userId)
    .eq("completed", true)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1000);
  // Reported, not thrown: this feeds the starting analysis and the insights
  // screen, where an error page is worse than a quiet one. But "0 sessions in the
  // last 28 days" must not be the app's answer to a failed read, so the console
  // records which of the two it was.
  readFailed(error, "your training sessions", { quiet: true });

  return ((data ?? []) as {
    started_at: string | null;
    completed_at: string | null;
    sport: string | null;
    type: string | null;
    title: string | null;
    duration_minutes: number | null;
    distance_km: number | null;
    session_load: number | null;
    source: string | null;
  }[])
    .map((row): AnalysisSession | null => {
      const stamp = row.started_at ?? row.completed_at;
      // A row with no timestamp cannot be placed on a day, and a day is the unit
      // every part of the analysis works in, so it is dropped rather than dated
      // to today.
      if (!stamp) return null;
      return {
        date: localDateKey(new Date(stamp)),
        sport: row.sport ?? row.type ?? "Training",
        title: row.title,
        durationMinutes: row.duration_minutes,
        distanceKm: row.distance_km,
        load: row.session_load,
        source: row.source ?? "manual",
      };
    })
    .filter((s): s is AnalysisSession => s !== null);
}

async function readGoals(userId: string): Promise<AnalysisGoal[]> {
  const { data, error } = await supabase
    .from("outcome_goals")
    .select("title, category, metric_unit, current_value, target_value, deadline")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);
  readFailed(error, "your goals", { quiet: true });
  return (data ?? []) as AnalysisGoal[];
}

async function readAge(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("date_of_birth, sport")
    .eq("user_id", userId)
    .maybeSingle();
  // Null already means "date of birth unknown", which the age caps read as the
  // conservative default. A failed read must not be mistaken for a missing date
  // of birth without at least leaving a trace: the server recomputes its own age
  // from the profile, but this copy decides what the athlete is shown.
  readFailed(error, "your profile", { quiet: true });
  return ageFromDob((data?.date_of_birth as string | null) ?? null);
}

/**
 * The starting analysis of the record as it stands right now.
 *
 * Separate from the stored snapshot on purpose. The stored copy is what the
 * athlete was shown when they imported, and it is what a later offline session
 * and the guardian view should read; this is what the analysis looks like
 * against today's training, which is what the screen needs when there is no
 * stored one — an athlete with forty logged sessions is owed a reading of them,
 * not an empty state because they never ran an import.
 */
export async function computeStartingAnalysis(userId: string): Promise<StartingAnalysis> {
  const [sessions, goals, age] = await Promise.all([
    readAnalysisSessions(userId),
    readGoals(userId),
    readAge(userId),
  ]);
  return buildStartingAnalysis({ sessions, goals, age });
}

/**
 * Builds the starting analysis from what is actually recorded, and stores it on
 * the import row.
 *
 * Stored deliberately: the parent view and a later offline session should read
 * the same words the athlete was shown. An analysis of a starting point is not
 * supposed to change quietly underneath them.
 */
export async function buildAndStoreAnalysis(
  userId: string,
  importId: string,
): Promise<StartingAnalysis> {
  const analysis = await computeStartingAnalysis(userId);

  await updateOrQueue("workout_imports", importId, {
    analysis: analysis as unknown as Record<string, unknown>,
  });

  return analysis;
}

// ---------------------------------------------------------------------------
// Running an import
// ---------------------------------------------------------------------------

interface EdgeHistoryResponse {
  ok?: boolean;
  imported?: number;
  pages?: number;
  capped?: boolean;
  note?: string;
  error?: string;
}

/** An open (queued or running) run for a source, so jobs cannot stack. */
async function findOpenRun(userId: string, source: string): Promise<ImportRun | null> {
  const { data, error } = await supabase
    .from("workout_imports")
    .select("id, source, status, imported_count, updated_count, skipped_count, note, window_start, created_at, completed_at")
    .eq("user_id", userId)
    .eq("source", source)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed read reads as "no run open", which is exactly the answer that lets
  // a second job for the same source start on top of the first.
  readFailed(error, "your import history", { quiet: true });
  return data ? toRun(data) : null;
}

const toRun = (row: Record<string, unknown>): ImportRun => ({
  id: row.id as string,
  source: row.source as string,
  status: (row.status as ImportStatus) ?? "queued",
  importedCount: (row.imported_count as number) ?? 0,
  updatedCount: (row.updated_count as number) ?? 0,
  skippedCount: (row.skipped_count as number) ?? 0,
  note: (row.note as string | null) ?? null,
  windowStart: (row.window_start as string | null) ?? null,
  createdAt: row.created_at as string,
  completedAt: (row.completed_at as string | null) ?? null,
});

export async function loadImportRuns(userId: string, limit = 5): Promise<ImportRun[]> {
  const { data, error } = await supabase
    .from("workout_imports")
    .select("id, source, status, imported_count, updated_count, skipped_count, note, window_start, created_at, completed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  // The Health screen renders this list as "what has been imported", so an empty
  // list after a failed read tells the athlete their history was never imported.
  readFailed(error, "your import history", { quiet: true });
  return ((data ?? []) as Record<string, unknown>[]).map(toRun);
}

/** The most recent stored analysis, for a screen that is read offline. */
export async function loadStoredAnalysis(
  userId: string,
): Promise<{ run: ImportRun; analysis: StartingAnalysis } | null> {
  const { data, error } = await supabase
    .from("workout_imports")
    .select("id, source, status, imported_count, updated_count, skipped_count, note, window_start, created_at, completed_at, analysis")
    .eq("user_id", userId)
    .not("analysis", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Null means "no stored analysis yet", which the screen renders as "import
  // your history and we will describe how you train". A failed read must not be
  // presented as that invitation.
  readFailed(error, "your stored analysis", { quiet: true });
  if (!data?.analysis) return null;
  return {
    run: toRun(data as unknown as Record<string, unknown>),
    // Stored as jsonb, so the shape is asserted rather than inferred. The value
    // was written by `buildAndStoreAnalysis` from this same type.
    analysis: data.analysis as unknown as StartingAnalysis,
  };
}

/**
 * Runs one recorded import: ask the provider, mirror what came back, then
 * describe it.
 *
 * Every failure keeps the reason on the row, so the screen can say which of
 * "not set up yet", "reconnect your account" and "the request failed" happened
 * instead of a generic failure.
 */
async function executeRun(
  userId: string,
  importId: string,
  window: ImportWindow,
): Promise<ImportOutcome> {
  await updateOrQueue("workout_imports", importId, { status: "running" });


  const spec = importWindowSpec(window);
  const start = windowStart(window);
  const { data, error } = await supabase.functions.invoke("wearable-oauth", {
    body: {
      action: "history",
      provider: IMPORT_SOURCE,
      // The window is resolved in the athlete's own calendar HERE, and the
      // instant it resolved to is what the server is given — so the two cannot
      // disagree about what "the last six months" means. `months` rides along
      // only as a fallback for a caller with no opinion.
      since: start ? start.toISOString() : null,
      months: spec.months,
    },
  });

  if (error) {
    // A connectivity failure is not a verdict: the row goes back to `queued` so
    // the retry happens on reconnect rather than needing the athlete to tap again.
    const offline = isNetworkError(error) || /failed to fetch|network/i.test(error.message ?? "");
    // A status means something answered. Supabase reports a non-2xx from our own
    // edge function as an error whose `context` is the response — that is the
    // import service refusing, not the provider, and the difference decides
    // which sentence the athlete reads.
    const status =
      (error as { context?: { status?: number }; status?: number })?.context?.status ??
      (error as { status?: number })?.status ??
      null;
    const refusedByService = !offline && typeof status === "number" && status > 0;

    const reason: ImportOutcome["error"] = offline
      ? "unreachable"
      : refusedByService
        ? "service_error"
        : "fetch_failed";

    await updateOrQueue("workout_imports", importId, {
      status: offline ? "queued" : "failed",
      note: offline ? "waiting for a connection" : reason,
      completed_at: offline ? null : new Date().toISOString(),
    });
    return emptyOutcome({ importId, queued: offline, error: reason });
  }

  const response = (data ?? {}) as EdgeHistoryResponse;
  if (response.error === "not_configured") {
    await updateOrQueue("workout_imports", importId, {
      status: "failed",
      note: "not_configured",
      completed_at: new Date().toISOString(),
    });
    return emptyOutcome({ importId, error: "not_configured" });
  }
  if (response.error === "token_expired") {
    await updateOrQueue("workout_imports", importId, {
      status: "failed",
      note: "token_expired",
      completed_at: new Date().toISOString(),
    });
    return emptyOutcome({ importId, error: "token_expired" });
  }

  let mirrored: MirrorResult;
  try {
    mirrored = await mirrorImportedWorkouts(userId, IMPORT_SOURCE);
  } catch (e) {
    const offline = isNetworkError(e);
    await updateOrQueue("workout_imports", importId, {
      status: offline ? "queued" : "failed",
      note: offline ? "waiting for a connection" : "the import could not be saved",
    });
    return emptyOutcome({
      importId,
      queued: offline,
      error: offline ? "unreachable" : "write_failed",
    });
  }

  const analysis = await buildAndStoreAnalysis(userId, importId);
  const capped = !!response.capped;
  const total = mirrored.imported + mirrored.updated;

  const { data: span, error: spanError } = await supabase
    .from("workouts")
    .select("started_at")
    .eq("user_id", userId)
    .eq("source", IMPORT_SOURCE)
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // The span dates the analysis. Null spans the window to "now", so a failed
  // read here quietly changes what every caveat in that analysis is measured
  // against — worth a trace even though the run continues.
  readFailed(spanError, "the span of your imported sessions", { quiet: true });

  const summary = importSummaryLine(
    total,
    window,
    span?.started_at ? localDateKey(new Date(span.started_at)) : null,
    analysis.lastDate,
  );
  const caveats = importCaveats(mirrored.skipped, capped);

  // "partial" when some sessions landed but the provider or the write path did
  // not finish — a real outcome, and not rounded up to completed.
  const status: ImportStatus =
    total === 0 && mirrored.skipped > 0 ? "partial" : response.ok === false ? "partial" : "completed";

  await updateOrQueue("workout_imports", importId, {
    status,
    imported_count: mirrored.imported,
    updated_count: mirrored.updated,
    skipped_count: mirrored.skipped,
    note: response.note ?? null,
    completed_at: new Date().toISOString(),
  });

  return {
    ok: true,
    queued: false,
    importId,
    imported: mirrored.imported,
    updated: mirrored.updated,
    skipped: mirrored.skipped,
    capped,
    summary,
    caveats,
    analysis,
  };
}

/**
 * Starts an import of the athlete's history.
 *
 * Records the intent first (through the offline queue, so it survives a dead
 * spot), then runs it. Re-queueing reuses an open row rather than creating a
 * second job for the same source.
 */
export async function requestHistoryImport(
  userId: string,
  window: ImportWindow = "6m",
): Promise<ImportOutcome> {
  const open = await findOpenRun(userId, IMPORT_SOURCE);
  if (open?.status === "running") {
    // Already in flight: do not start a second one on top of it.
    return emptyOutcome({ importId: open.id, queued: true });
  }
  if (open) return executeRun(userId, open.id, window);

  const id = newId();
  const start = windowStart(window);
  const queued = await insertOrQueue("workout_imports", {
    id,
    user_id: userId,
    source: IMPORT_SOURCE,
    window_start: start ? start.toISOString() : null,
    window_end: new Date().toISOString(),
    status: "queued",
  });

  if (!queued.ok) {
    return emptyOutcome({ error: "write_failed" });
  }
  if (queued.queued) {
    // The request itself is now queued. Nothing was lost; it runs on reconnect.
    return emptyOutcome({ ok: true, queued: true, importId: id });
  }

  return executeRun(userId, id, window);
}

/**
 * Runs every import that was queued while offline. Call on reconnect.
 *
 * The window a queued job should use is not stored on the row, so the default is
 * re-derived from the row's own `window_start` — which is what the athlete
 * actually chose — by finding the preset that produced it.
 */
export async function runQueuedImports(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("workout_imports")
    .select("id, window_start")
    .eq("user_id", userId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);
  // A failed read means queued imports do not run this time round, which the
  // athlete experiences as nothing happening at all.
  readFailed(error, "your queued imports", { quiet: true });

  const rows = (data ?? []) as { id: string; window_start: string | null }[];
  let done = 0;
  for (const row of rows) {
    const outcome = await executeRun(userId, row.id, windowFromStoredStart(row.window_start));
    if (outcome.ok) done++;
  }
  return done;
}

/** The preset that best explains a stored window start; defaults to the safest. */
export function windowFromStoredStart(stored: string | null): ImportWindow {
  if (!stored) return "all";
  const target = Date.parse(stored);
  if (!Number.isFinite(target)) return "6m";
  let best: ImportWindow = "6m";
  let bestGap = Infinity;
  for (const candidate of ["3m", "6m", "12m"] as ImportWindow[]) {
    const start = windowStart(candidate);
    if (!start) continue;
    const gap = Math.abs(start.getTime() - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}
