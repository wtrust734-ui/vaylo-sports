// ============================================================================
// VAYLO HEALTH — sync engine
// ----------------------------------------------------------------------------
// Pull-based and battery-conscious: Health Connect is read only when the
// athlete taps Sync (or after connecting), never on a timer. Duplicates are
// impossible end to end (stable Health Connect record ids + DB unique
// constraint). Incremental syncs read only records newer than the stored
// cursor. Offline: state lives in localStorage, rows are written directly to
// Supabase by the signed-in athlete via self-only RLS — a failed upload simply
// advances nothing and can be retried.
//
// Privacy: no health values are logged; consent state is a version + boolean,
// never data.
//
// Consent gates the read at the ENGINE, not only at the button that calls it
// (runHealthSync refuses to pull without it). The screen was the only gate
// before, which makes a button the whole protection for a permission the
// athlete may have taken back.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";
import {
  bridgeCheckPermissions,
  bridgeRequestPermissions,
  bridgeSyncPull,
} from "./bridge";
import { HEALTH_PERMISSIONS_VERSION } from "./permissions";
import type { HealthConnectionStatus } from "./types";

const STATE_KEY = (userId: string) => `vaylo:hc:state:${userId}`;
const CONSENT_KEY = (userId: string) => `vaylo:hc:consent:${userId}`;

export interface StoredHealthState {
  lastSyncAt: string | null;
  cursorMs: number | null;
}

export function readLocalState(userId: string): StoredHealthState {
  try {
    const raw = localStorage.getItem(STATE_KEY(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredHealthState;
      return { lastSyncAt: parsed.lastSyncAt ?? null, cursorMs: parsed.cursorMs ?? null };
    }
  } catch {
    /* corrupt state = fresh start */
  }
  return { lastSyncAt: null, cursorMs: null };
}

function writeLocalState(userId: string, state: StoredHealthState) {
  try {
    localStorage.setItem(STATE_KEY(userId), JSON.stringify(state));
  } catch {
    /* private mode — sync still works, last-sync label just won't persist */
  }
}

/** Consent: has the athlete explicitly connected, and to which catalog version. */
export function readConsent(userId: string): { connected: boolean; version: number } {
  try {
    const raw = localStorage.getItem(CONSENT_KEY(userId));
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return { connected: false, version: 0 };
}

function writeConsent(userId: string, connected: boolean, version: number) {
  try {
    localStorage.setItem(CONSENT_KEY(userId), JSON.stringify({ connected, version }));
  } catch {
    /* non-fatal */
  }
}

export async function saveConnectionToServer(userId: string, connected: boolean): Promise<void> {
  try {
    const { error } = await supabase
      .from("health_sync_state")
      .upsert({ user_id: userId, connected, updated_at: new Date().toISOString() });
    // Non-fatal (the connection itself is device-local), but not silent: a
    // server row that never updates is how a second device keeps syncing after
    // this one disconnected.
    readFailed(error, "your connection status", { quiet: true });
  } catch {
    // Non-fatal: connection is device-local; server row is bookkeeping only.
  }
}

/**
 * Full disconnect: flips consent off locally AND on the server so a second
 * device stops treating the athlete as connected, and clears the stored sync
 * state so "last sync" doesn't describe a connection that no longer exists.
 *
 * Already-imported workout/sample rows are deliberately kept — deleting data
 * is a separate, explicit control on the HealthSync page. If the server write
 * fails, the local consent is still cleared, so this device stops syncing
 * either way; the server row is refreshed by the next connect.
 */
export async function disconnectHealthConnect(userId: string): Promise<void> {
  writeConsent(userId, false, HEALTH_PERMISSIONS_VERSION);
  try {
    localStorage.removeItem(STATE_KEY(userId));
  } catch {
    /* private mode */
  }
  try {
    const { error } = await supabase
      .from("health_sync_state")
      .upsert({
        user_id: userId,
        connected: false,
        last_sync_at: null,
        last_incremental_cursor: null,
        synced_workout_count: 0,
        updated_at: new Date().toISOString(),
      });
    readFailed(error, "your connection status", { quiet: true });
  } catch {
    // Local state is already cleared, which is the side that gates syncing.
  }
}

/** Server row backfills the last-sync label on new devices. */
export async function fetchServerSyncState(userId: string): Promise<StoredHealthState> {
  try {
    const { data, error } = await supabase
      .from("health_sync_state")
      .select("last_sync_at, last_incremental_cursor")
      .eq("user_id", userId)
      .maybeSingle();
    // Quiet: this backfills a "last synced" label on a new device, and the local
    // state below is the fallback either way. Logged so a server row that is
    // unreadable is not mistaken for one that does not exist.
    readFailed(error, "your sync history", { quiet: true });
    if (data) {
      return {
        lastSyncAt: data.last_sync_at ?? null,
        cursorMs: data.last_incremental_cursor ? new Date(data.last_incremental_cursor).getTime() : null,
      };
    }
  } catch {
    /* fall back to local */
  }
  return readLocalState(userId);
}

// ---------------------------------------------------------------------------
// Status resolution
// ---------------------------------------------------------------------------

export interface ResolvedStatus {
  status: HealthConnectionStatus;
  /** True when the stored consent predates the current permission catalog. */
  consentOutdated: boolean;
}

/**
 * Compute the connection status from three independent facts:
 *   • platform/SDK availability (bridge),
 *   • the athlete's explicit consent (stored),
 *   • the live permission state inside Health Connect (native check).
 * "Permission required" appears when some previously granted permission has
 * been revoked upstream — it never triggers an automatic re-prompt.
 */
export async function resolveHealthStatus(
  userId: string,
  supported: boolean,
): Promise<ResolvedStatus> {
  const consent = readConsent(userId);
  const consentOutdated = consent.connected && consent.version < HEALTH_PERMISSIONS_VERSION;

  if (!supported) return { status: "unavailable", consentOutdated };
  if (!consent.connected) return { status: "not_connected", consentOutdated };

  const perms = await bridgeCheckPermissions();
  if (!perms) return { status: "not_connected", consentOutdated };

  if (perms.missingCount > 0) {
    return { status: "permission_required", consentOutdated };
  }
  return { status: "connected", consentOutdated };
}

// ---------------------------------------------------------------------------
// Connect / sync
// ---------------------------------------------------------------------------

export interface ConnectOutcome {
  ok: boolean;
  /** User dismissed the system dialog or granted nothing. */
  declined?: boolean;
  error?: string;
}

/**
 * One explicit user action → one system permission prompt. Vaylo Sports never
 * re-prompts on its own; if the athlete declines, the status becomes
 * "not connected" and the button remains the only path to try again.
 */
export async function connectHealthConnect(userId: string): Promise<ConnectOutcome> {
  const res = await bridgeRequestPermissions();
  if (!res) return { ok: false, error: "unavailable" };
  if (res.cancelled) return { ok: false, declined: true };
  if (res.grantedCount === 0) return { ok: false, declined: true };

  writeConsent(userId, true, HEALTH_PERMISSIONS_VERSION);
  await saveConnectionToServer(userId, true);
  return { ok: true };
}

export interface SyncOutcome {
  ok: boolean;
  /** Rows that actually LANDED, not rows that were read out of Health Connect. */
  workouts: number;
  samples: number;
  error?: string;
  /**
   * Present when `error === "permission_partial"`: the Health Connect reads the
   * athlete has not granted, so the screen can name them instead of showing one
   * generic sentence. Empty when the plugin could not say which.
   */
  missing?: string[];
}

/**
 * What a thrown bridge message means.
 *
 * `permission_revoked` (exact string) is a genuine revocation: Health Connect no
 * longer grants what the athlete consented to, so stored consent is cleared and
 * the data already imported is kept.
 *
 * `permission_partial` is the different outcome the Android plugin reports when
 * it holds a strict SUBSET of the catalog. It is not a revocation — the athlete
 * said yes to most of it — so consent stays, nothing is cleared, and the reads
 * that are missing travel back to the screen. Before the plugin distinguished
 * the two, a 5-of-6 grant walked past its all-or-nothing check, threw on the
 * first ungranted read, and came back as "permissions were revoked. Reconnect to
 * resume syncing.": an athlete who had just granted five permissions was told
 * they had revoked access, and the stored consent was flipped off.
 *
 * The missing reads may arrive as JSON (`permission_partial:["steps"]`) or as a
 * plain list (`permission_partial:steps,sleep`). Both are accepted; an
 * unparseable payload still counts as partial, just without names.
 *
 * BOTH fields are read, and that is deliberate. This app's one-argument rejects
 * put the code in the message (`call.reject("permission_revoked")`), while the
 * two-argument form that the partial case needs — because it also carries the
 * list — puts the code in `code` and keeps the message for the payload. Reading
 * only `.message` looked at the human sentence and never saw the marker, so a
 * partial grant fell through to `sync_failed` and the athlete was told only that
 * a sync did not complete.
 */
export function permissionOutcome(error: unknown): { kind: "revoked" | "partial" | null; missing: string[] } {
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";

  if (code === "permission_revoked" || message === "permission_revoked") {
    return { kind: "revoked", missing: [] };
  }

  // The marker may sit in the message (the one-argument form this app used
  // first) or in the code (the current two-argument form). The LIST, when there
  // is one, always follows the marker in the field that carries it — parsing a
  // field that does not contain the marker is how "Missing Health Connect
  // permissions: steps, sleep session" became the permission name "nnect
  // permissions: steps".
  const MARKER = "permission_partial";
  const marked = message.includes(MARKER) ? message : "";
  if (!marked && !code.includes(MARKER)) return { kind: null, missing: [] };

  const raw = marked.slice(marked.indexOf(MARKER) + MARKER.length).replace(/^[:=]\s*/, "").trim();
  if (!raw) return { kind: "partial", missing: [] };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { kind: "partial", missing: parsed.filter((p): p is string => typeof p === "string") };
    }
  } catch {
    /* not JSON — fall through to the list form */
  }
  return {
    kind: "partial",
    missing: raw.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean),
  };
}

/**
 * Initial sync = cursor null (everything available); incremental = records
 * newer than the stored cursor. Duplicate-proof: (user, source, record id)
 * unique at the DB, plus an ON CONFLICT no-op per row.
 */
export async function runHealthSync(userId: string): Promise<SyncOutcome> {
  // Consent is checked HERE, not only by the button that calls this. A revoked
  // consent is a statement about what may be read, so the read has to depend on
  // it rather than on which screen the athlete happened to reach.
  if (!readConsent(userId).connected) {
    return { ok: false, workouts: 0, samples: 0, error: "not_connected" };
  }

  const state = readLocalState(userId);
  let totalWorkouts = 0;
  let totalSamples = 0;
  let cursor = state.cursorMs;
  let hadFailure: string | null = null;
  let missingPermissions: string[] = [];

  try {
    // Paginate through everything pending before touching the cursor, so a
    // mid-sync crash never skips records.
    for (let page = 0; page < 10; page++) {
      let batch;
      try {
        batch = await bridgeSyncPull(cursor, 200);
      } catch (e) {
        const permission = permissionOutcome(e);
        if (permission.kind === "revoked") {
          // Permissions were revoked between syncs: keep data, flip consent off.
          writeConsent(userId, false, HEALTH_PERMISSIONS_VERSION);
          await saveConnectionToServer(userId, false).catch(() => undefined);
          return { ok: false, workouts: totalWorkouts, samples: totalSamples, error: "permission_revoked" };
        }
        if (permission.kind === "partial") {
          // A partial grant is not a revocation: consent stays exactly as the
          // athlete left it, and the reads that are missing are reported.
          missingPermissions = permission.missing;
          hadFailure = "permission_partial";
          break;
        }
        hadFailure = "sync_failed";
        break;
      }
      if (!batch) {
        hadFailure = hadFailure ?? "unavailable";
        break;
      }

      const rows = batch.workouts.map((w) => ({
        user_id: userId,
        source: "health_connect",
        source_record_id: w.sourceRecordId,
        title: w.title,
        activity_type: w.activityType,
        start_time: w.startTime,
        end_time: w.endTime,
        duration_seconds: w.durationSeconds,
        distance_meters: w.distanceMeters,
        active_calories: w.activeCalories,
        heart_rate_avg: w.heartRateAvg,
        heart_rate_max: w.heartRateMax,
        heart_rate_min: w.heartRateMin,
        steps: w.steps,
      }));

      const sampleRows = batch.samples.map((s) => ({
        user_id: userId,
        source: "health_connect",
        source_record_id: s.sourceRecordId,
        metric: s.metric,
        start_time: s.startTime,
        end_time: s.endTime,
        value: s.value,
        unit: s.unit,
        stage: s.stage,
      }));

      // Chunked upserts; ON CONFLICT DO UPDATE keeps the freshest copy of a
      // record that changed upstream without duplicating it.
      //
      // Counted per CHUNK that landed, not per row that was read. The totals used
      // to be added AFTER the loops as `rows.length`, so a chunk that failed
      // still counted every row inside it: the screen reported sessions that were
      // never stored, and `synced_workout_count` recorded them as synced. A count
      // that overstates is the same defect as copy that overstates.
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await supabase
          .from("health_workouts")
          .upsert(chunk, { onConflict: "user_id,source,source_record_id" });
        if (error) {
          hadFailure = "upload_failed";
          readFailed(error, "your synced workouts", { quiet: true });
          break;
        }
        totalWorkouts += chunk.length;
      }
      for (let i = 0; i < sampleRows.length; i += 100) {
        const chunk = sampleRows.slice(i, i + 100);
        const { error } = await supabase
          .from("health_samples")
          .upsert(chunk, { onConflict: "user_id,source,source_record_id" });
        if (error) {
          hadFailure = "upload_failed";
          readFailed(error, "your synced samples", { quiet: true });
          break;
        }
        totalSamples += chunk.length;
      }
      if (batch.latestCursorMs != null && (cursor == null || batch.latestCursorMs > cursor)) {
        cursor = batch.latestCursorMs;
      }
      if (!batch.hasMore || hadFailure) break;
    }

    // Cursor + last-sync persist together, only after a pass with no upload
    // failure — a failed sync is simply retried from the old cursor.
    if (!hadFailure) {
      const next: StoredHealthState = {
        lastSyncAt: new Date().toISOString(),
        cursorMs: cursor,
      };
      writeLocalState(userId, next);
      const { error: stateError } = await supabase
        .from("health_sync_state")
        .upsert({
          user_id: userId,
          connected: true,
          last_sync_at: next.lastSyncAt,
          last_incremental_cursor: next.cursorMs != null ? new Date(next.cursorMs).toISOString() : null,
          synced_workout_count: totalWorkouts,
        });
      // The local write already happened, so sync still works from this device;
      // the server row is what a second device reads.
      readFailed(stateError, "your sync history", { quiet: true });
    }

    return {
      ok: !hadFailure,
      workouts: totalWorkouts,
      samples: totalSamples,
      error: hadFailure ?? undefined,
      missing: missingPermissions.length ? missingPermissions : undefined,
    };
  } catch {
    return {
      ok: false,
      workouts: totalWorkouts,
      samples: totalSamples,
      error: "sync_failed",
      missing: missingPermissions.length ? missingPermissions : undefined,
    };
  }
}
