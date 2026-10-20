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
import { isString } from "@/lib/typeUtils";

export type PermissionOutcome =
  | { kind: "partial"; missing: string[] }
  | { kind: "revoked"; missing: string[] }
  | { kind: null; missing: string[] };

export function permissionOutcome(input: unknown): PermissionOutcome {
  const source = typeof input === "string"
    ? input
    : (input as Record<string, unknown> | undefined);

  if (source === undefined || source === null) {
    return { kind: null, missing: [] };
  }

  // Whole-permission-list emptiness: two call sites, both stay "revoked",
  // which clears stored consent and is what the plugin special-cases in Kotlin.
  if (
    typeof source === "string" &&
    (source === "permission_revoked" || source === "permission_revoked:")
  ) {
    return { kind: "revoked", missing: [] };
  }

  const code = (source as { code?: unknown }).code ?? undefined;
  const message = (source as { message?: unknown }).message ?? undefined;

  if (code === "permission_revoked" || typeof message === "string" && message === "permission_revoked") {
    return { kind: "revoked", missing: [] };
  }

  // The plugin also carries a plain one-argument form (message only) and a
  // JSON-array form: ["steps","sleep"].
  if (typeof message === "string") {
    const partial = message.match(/permission_partial:(.*)/);
    if (partial) {
      const missing = partial[1].trim();
      // JSON list: ["steps","sleep"]
      if (missing.startsWith("[") && missing.endsWith("]")) {
        try {
          const parsed = JSON.parse(missing.slice(1, -1)) as unknown[];
          return {
            kind: "partial",
            missing: parsed.filter(isString).map((name) => name.trim()).filter(Boolean),
          } as PermissionOutcome;
        } catch {
          // Not a valid list — this message carries no names we can trust.
          return { kind: "partial", missing: [] };
        }
      }
      // Plain comma-joined list: steps,sleep session
      const plain = missing.split(",").map((name) => name.trim()).filter(Boolean);
      return { kind: "partial", missing: plain.length > 0 ? plain : [] };
    }
  }

  if (code === "permission_partial") {
    return { kind: "partial", missing: [] };
  }

  // Anything that is not a recognised permissions outcome is returned as
  // `kind: null` so a sync or availability failure cannot be read as permissions.
  return { kind: null, missing: [] };
}

const STATE_KEY = (userId: string) => `vaylo:hc:state:${userId}`;
const CONSENT_KEY = (userId: string) => `vaylo:hc:consent:${userId}`;

/** The sync axis, persisted on health_sync_state and mirrored locally. */
export type HealthSyncStatus = "idle" | "in_progress" | "succeeded" | "failed";

export interface StoredHealthState {
  lastSyncAt: string | null;
  cursorMs: number | null;
  /** The engine's last declared outcome. Deliberately separate from a mere
   *  connection: a connected account says nothing about whether data ever
   *  arrived, and a previous success says nothing about a request that is
   *  failing right now. */
  syncStatus: HealthSyncStatus |
    /* Older stored rows predate this field. */
    null;
}

const EMPTY_STATE: StoredHealthState = { lastSyncAt: null, cursorMs: null, syncStatus: "idle" };

export function readLocalState(userId: string): StoredHealthState {
  try {
    const raw = localStorage.getItem(STATE_KEY(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredHealthState;
      return {
        lastSyncAt: parsed.lastSyncAt ?? null,
        cursorMs: parsed.cursorMs ?? null,
        syncStatus: parsed.syncStatus ?? "idle",
      };
    }
  } catch {
    /* corrupt state = fresh start */
  }
  return EMPTY_STATE;
}

function writeLocalState(userId: string, state: StoredHealthState) {
  try {
    localStorage.setItem(STATE_KEY(userId), JSON.stringify(state));
  } catch {
    /* private mode — sync still works, last-sync label just won't persist */
  }
}

/** Mirror sync_status/sync_error into the server row so a second device and a
 *  refresh see the same state this device saw. Best-effort by design: the row
 *  is bookkeeping, and a failed write must not turn a healthy import into an
 *  error report. */
async function persistServerSyncStatus(
  userId: string,
  patch: { sync_status: HealthSyncStatus; sync_error?: string | null },
): Promise<void> {
  try {
    await supabase.from("health_sync_state").upsert({
      user_id: userId,
      ...patch,
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* the local state below stays the source this device acts on */
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
    await supabase
      .from("health_sync_state")
      .upsert({
        user_id: userId,
        connected: false,
        last_sync_at: null,
        last_incremental_cursor: null,
        synced_workout_count: 0,
        sync_status: "idle",
        sync_error: null,
        updated_at: new Date().toISOString(),
      });
  } catch {
    // Local state is already cleared, which is the side that gates syncing.
  }
}

/**
 * The server row's CONNECTED flag — the account-level truth.
 *
 * Consent stored in localStorage is per-device, so on a second device (or
 * anywhere storage was cleared) the athlete whom the server records as
 * connected used to read as "not connected" and was offered the full initial
 * setup a second time — the redundant setup flow this module exists to
 * prevent. Disconnect and permission revocation both write connected=false
 * here, so the row is exactly the fact "this account is connected at account
 * level", wherever it is checked from.
 */
export async function fetchServerConnected(userId: string): Promise<boolean | null> {
  try {
    const { data } = await supabase
      .from("health_sync_state")
      .select("connected")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data.connected === true;
    return null; // no row yet — never synced from anywhere
  } catch {
    return null; // unreadable is unresolved, never a lie in either direction
  }
}

/** Server row backfills the last-sync label on new devices. */
export async function fetchServerSyncState(userId: string): Promise<StoredHealthState> {
  try {
    const { data } = await supabase
      .from("health_sync_state")
      .select("last_sync_at, last_incremental_cursor, sync_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      return {
        lastSyncAt: data.last_sync_at ?? null,
        cursorMs: data.last_incremental_cursor ? new Date(data.last_incremental_cursor).getTime() : null,
        syncStatus: (data.sync_status as HealthSyncStatus | null) ?? "idle",
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
  // The account-level truth outranks this device's memory ONLY as a fallback
  // for the connected question: a row written by another device (or surviving
  // cleared storage) means the athlete is connected, and repeating the whole
  // initial setup flow on them is the redundant setup this must prevent. A
  // row that says NOT connected never overrides a locally-connected device's
  // consent — the local side is stronger evidence of a live grant, and the
  // disconnect path clears both.
  if (!consent.connected) {
    const serverConnected = await fetchServerConnected(userId);
    if (serverConnected !== true) {
      return { status: !supported ? "unavailable" : "not_connected", consentOutdated: false };
    }
  }
  const consentOutdated = consent.connected && consent.version < HEALTH_PERMISSIONS_VERSION;

  if (!supported) return { status: "unavailable", consentOutdated };

  const perms = await bridgeCheckPermissions();
  if (!perms) {
    // The native check is the one fact that separates "connected" from
    // "revoked". Unreadable (bridge absent) is NOT proof of disconnection —
    // but on a supported build it is also not a state we can sync from, so
    // the honest reading is permission_required (reconnect path), never a
    // green "connected".
    return consent.connected
      ? { status: "permission_required", consentOutdated }
      : { status: "not_connected", consentOutdated };
  }

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
  /** Present when the first import was kicked off or completed with the grant. */
  initialSync?: SyncOutcome | null;
}

/**
 * One explicit user action → one system permission prompt → one first import.
 *
 * The grant used to end the flow: the sheet re-rendered "connected" with the
 * promise that a first sync would import recent sessions, except nothing had
 * ever been written to run it. Any athlete who closed the sheet without also
 * finding and pressing "Sync now" stayed connected and unsynchronised, and
 * every later visit re-presented the same half-finished setup — the redundant
 * flow this is fixing. The initial import is the second half of connect and
 * runs behind the same engine lock the manual action uses, so an athlete who
 * taps Sync now on the state-change re-render joins the run in flight instead
 * of starting a second one.
 */
export async function connectHealthConnect(userId: string): Promise<ConnectOutcome> {
  const res = await bridgeRequestPermissions();
  if (!res) return { ok: false, error: "unavailable" };
  if (res.cancelled) return { ok: false, declined: true };
  if (res.grantedCount === 0) return { ok: false, declined: true };

  writeConsent(userId, true, HEALTH_PERMISSIONS_VERSION);
  await saveConnectionToServer(userId, true);

  // The first import. A failed first attempt is a retry state on the sheet,
  // not a lost connection: the grant stands, the cursor stays null, and the
  // next run starts from the beginning of whatever is on the device.
  const initialSync = await runHealthSync(userId);
  return { ok: initialSync.ok, error: initialSync.error, initialSync };
}

export interface SyncOutcome {
  ok: boolean;
  workouts: number;
  samples: number;
  error?: string;
}

/**
 * One engine run per account, app-wide.
 *
 * Every surface that can start a sync holds its own `useHealthConnect()`
 * instance, each with its own `syncing` flag — two components (or two mounts
 * of one) were two independent yes-buttons, and both would run the pull and
 * the upload side by side. The uploads themselves are idempotent (upsert on a
 * stable record id), so corruption was never the risk; the cost was two full
 * pulls and two conflicting orphan 'in_progress' writes. This lock makes the
 * second caller JOIN the run in flight instead of starting a second one.
 */
const inFlight = new Map<string, Promise<SyncOutcome>>();

/**
 * Initial sync = cursor null (everything available); incremental = records
 * newer than the stored cursor. Duplicate-proof: (user, source, record id)
 * unique at the DB, plus an ON CONFLICT no-op per row.
 */
export async function runHealthSync(userId: string): Promise<SyncOutcome> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const run = performHealthSync(userId).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, run);
  return run;
}

async function performHealthSync(userId: string): Promise<SyncOutcome> {
  const state = readLocalState(userId);
  // Claim the run on the server row, too. A SECOND DEVICE checking
  // `sync_status` sees in_progress and can show one shared state instead of
  // racing this run with its own pull; the claim is refreshed on every
  // attempt, never treated as a hard lock — a row stuck at in_progress means
  // a crashed device, and the next honest attempt reclaims it.
  await persistServerSyncStatus(userId, { sync_status: "in_progress" });
  // Local mirror first so UI reads stay consistent even if the write races.
  writeLocalState(userId, { ...state, syncStatus: "in_progress" });
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
          // Permissions were revoked between syncs: keep data, flip consent
          // off, and close the claim so no row stays in_progress forever.
          writeConsent(userId, false, HEALTH_PERMISSIONS_VERSION);
          await saveConnectionToServer(userId, false).catch(() => undefined);
          await persistServerSyncStatus(userId, { sync_status: "failed", sync_error: "permission_revoked" });
          writeLocalState(userId, { lastSyncAt: state.lastSyncAt, cursorMs: state.cursorMs, syncStatus: "failed" });
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
    // failure — a failed sync is simply retried from the old cursor. The
    // outcome is persisted in BOTH directions: success so the UI can say
    // "synchronised" instead of re-offering setup, failure so the retry
    // affordance survives navigation, refresh and a second device.
    if (!hadFailure) {
      const next: StoredHealthState = {
        lastSyncAt: new Date().toISOString(),
        cursorMs: cursor,
        syncStatus: "succeeded",
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
          sync_status: "succeeded",
          sync_error: null,
        });
    } else {
  // didFail write: cursor unchanged (the failed pass never advanced it),
  // lastSyncAt unchanged (no honest timestamp to claim), status failed.
  await persistServerSyncStatus(userId, { sync_status: "failed", sync_error: hadFailure });
  writeLocalState(userId, { lastSyncAt: state.lastSyncAt, cursorMs: state.cursorMs, syncStatus: "failed" });
    }

    return {
      ok: !hadFailure,
      workouts: totalWorkouts,
      samples: totalSamples,
      error: hadFailure ?? undefined,
    };
  } catch {
    // A thrown engine failure means the claim or the terminal write could
    // also have thrown. Close the order: failed status persisted best-effort,
    // local mirror updated, cursor untouched — never a stuck in_progress.
    await persistServerSyncStatus(userId, { sync_status: "failed", sync_error: "sync_failed" }).catch(() => undefined);
    try {
      writeLocalState(userId, { lastSyncAt: state.lastSyncAt, cursorMs: state.cursorMs, syncStatus: "failed" });
    } catch {
      /* private mode */
    }
    return { ok: false, workouts: totalWorkouts, samples: totalSamples, error: "sync_failed" };
  }
}
