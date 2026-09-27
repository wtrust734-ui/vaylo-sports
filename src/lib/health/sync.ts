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
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
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
    await supabase
      .from("health_sync_state")
      .upsert({ user_id: userId, connected, updated_at: new Date().toISOString() });
  } catch {
    // Non-fatal: connection is device-local; server row is bookkeeping only.
  }
}

/** Server row backfills the last-sync label on new devices. */
export async function fetchServerSyncState(userId: string): Promise<StoredHealthState> {
  try {
    const { data } = await supabase
      .from("health_sync_state")
      .select("last_sync_at, last_incremental_cursor")
      .eq("user_id", userId)
      .maybeSingle();
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
  workouts: number;
  samples: number;
  error?: string;
}

/**
 * Initial sync = cursor null (everything available); incremental = records
 * newer than the stored cursor. Duplicate-proof: (user, source, record id)
 * unique at the DB, plus an ON CONFLICT no-op per row.
 */
export async function runHealthSync(userId: string): Promise<SyncOutcome> {
  const state = readLocalState(userId);
  let totalWorkouts = 0;
  let totalSamples = 0;
  let cursor = state.cursorMs;
  let hadFailure: string | null = null;

  try {
    // Paginate through everything pending before touching the cursor, so a
    // mid-sync crash never skips records.
    for (let page = 0; page < 10; page++) {
      let batch;
      try {
        batch = await bridgeSyncPull(cursor, 200);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "permission_revoked") {
          // Permissions were revoked between syncs: keep data, flip consent off.
          writeConsent(userId, false, HEALTH_PERMISSIONS_VERSION);
          await saveConnectionToServer(userId, false).catch(() => undefined);
          return { ok: false, workouts: totalWorkouts, samples: totalSamples, error: "permission_revoked" };
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
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase
          .from("health_workouts")
          .upsert(rows.slice(i, i + 100), { onConflict: "user_id,source,source_record_id" });
        if (error) {
          hadFailure = "upload_failed";
          break;
        }
      }
      for (let i = 0; i < sampleRows.length; i += 100) {
        const { error } = await supabase
          .from("health_samples")
          .upsert(sampleRows.slice(i, i + 100), { onConflict: "user_id,source,source_record_id" });
        if (error) {
          hadFailure = "upload_failed";
          break;
        }
      }

      totalWorkouts += rows.length;
      totalSamples += sampleRows.length;
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
      await supabase
        .from("health_sync_state")
        .upsert({
          user_id: userId,
          connected: true,
          last_sync_at: next.lastSyncAt,
          last_incremental_cursor: next.cursorMs != null ? new Date(next.cursorMs).toISOString() : null,
          synced_workout_count: totalWorkouts,
        });
    }

    return {
      ok: !hadFailure,
      workouts: totalWorkouts,
      samples: totalSamples,
      error: hadFailure ?? undefined,
    };
  } catch {
    return { ok: false, workouts: totalWorkouts, samples: totalSamples, error: "sync_failed" };
  }
}
