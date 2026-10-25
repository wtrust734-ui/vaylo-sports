// ============================================================================
// useHealthConnect — the only hook the UI needs
// ----------------------------------------------------------------------------
// Composes platform availability, connection status and the sync engine into
// one small API. Never prompts for permissions implicitly: requestPermissions
// runs only from the explicit Connect button press.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  bridgeAvailability,
  bridgeOpenSettings,
} from "@/lib/health/bridge";
import {
  clearImportedFlag,
  connectHealthConnect,
  disconnectHealthConnect,
  fetchServerSyncState,
  hasImportedData,
  readLocalState,
  resolveHealthStatus,
  runHealthSync,
  type StoredHealthState,
} from "@/lib/health/sync";
import type { HealthConnectionStatus } from "@/lib/health/types";

export type HealthApiStatus = "unavailable" | "update_required" | "available" | "unknown";

export interface UseHealthConnect {
  status: HealthConnectionStatus;
  apiStatus: HealthApiStatus;
  /** The last sync run's persisted outcome — succeeded / failed / idle /
   *  in_progress. A connection says nothing about whether data ever arrived,
   *  and this is the axis that tells the sheet which action is honest:
   *  first import, retry after failure, or manual resync of new data. */
  syncStatus: StoredHealthState["syncStatus"];
  /** Stored last-sync info (local first, backfilled from the server row). */
  syncState: StoredHealthState;
  consentOutdated: boolean;
  checking: boolean;
  connecting: boolean;
  syncing: boolean;
  error: string | null;
  connect: () => Promise<void>;
  sync: () => Promise<void>;
  /** Stops syncing everywhere and clears this device's stored sync state. */
  disconnect: () => Promise<void>;
  disconnecting: boolean;
  /** Erases the workouts and samples imported from Health Connect. Separate from disconnecting. */
  deleteImported: () => Promise<boolean>;
  /** True once this account has imported Health Connect rows. Survives a
   *  disconnect, so "Delete imported data" stays reachable after it —
   *  disconnecting deliberately keeps what was imported. */
  hasImported: boolean;
  deleting: boolean;
  managePermissions: () => Promise<void>;
  clearError: () => void;
}

export function useHealthConnect(): UseHealthConnect {
  const { user } = useAuth();
  const [status, setStatus] = useState<HealthConnectionStatus>("checking");
  const [apiStatus, setApiStatus] = useState<HealthApiStatus>("unknown");
  const [syncState, setSyncState] = useState<StoredHealthState>({
    lastSyncAt: null,
    cursorMs: null,
    syncStatus: "idle",
  });
  const [consentOutdated, setConsentOutdated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasImported, setHasImported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus("unavailable");
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const availability = await bridgeAvailability();
      setApiStatus(availability.status);
      const resolved = await resolveHealthStatus(user.id, availability.supported);
      setStatus(resolved.status);
      setConsentOutdated(resolved.consentOutdated);
      setHasImported(hasImportedData(user.id));
      const local = readLocalState(user.id);
      const server = await fetchServerSyncState(user.id);
      setSyncState({
        lastSyncAt: local.lastSyncAt ?? server.lastSyncAt,
        cursorMs: local.cursorMs ?? server.cursorMs,
        // This device's own record of the outcome wins when it has one (it
        // includes this session's runs); the server row backfills everywhere
        // else. `syncStatus` never falls back to the stale in_progress of a
        // crashed run — that resolves to failed/idle below.
        syncStatus:
          server.syncStatus === "in_progress" && local.syncStatus !== "in_progress"
            ? local.syncStatus
            : (local.syncStatus !== "idle" ? local.syncStatus : server.syncStatus ?? "idle"),
      });
    } finally {
      setChecking(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!user || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const outcome = await connectHealthConnect(user.id);
      if (!outcome.ok) {
        if (!outcome.declined) setError(outcome.error ?? "connect_failed");
        // Declined: no error toast — the status card says "Not connected";
        // we never nag. Refresh silently so the UI reflects reality.
      }
      await refresh();
    } finally {
      setConnecting(false);
    }
  }, [user, connecting, refresh]);

  const sync = useCallback(async () => {
    if (!user || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const outcome = await runHealthSync(user.id);
      if (!outcome.ok) {
        setError(
          outcome.error === "permission_revoked"
            ? "Health Connect permissions were revoked. Reconnect to resume syncing."
            : "Sync didn't complete. Your data wasn't changed — try again.",
        );
      }
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [user, syncing, refresh]);

  const disconnect = useCallback(async () => {
    if (!user || disconnecting) return;
    setDisconnecting(true);
    setError(null);
    try {
      // This now revokes the Android grant itself (VayloHealthConnect.disconnect)
      // before clearing local/server consent. Clearing the flag alone left the
      // system grant alive, which is why the sheet snapped back to "connected".
      await disconnectHealthConnect(user.id);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't disconnect Health Connect. Try again from the Health Connect app.",
      );
      // Re-read so the UI shows the grant that is still live rather than a
      // stale "connected" or "not connected" label.
      await refresh();
    } finally {
      setDisconnecting(false);
    }
  }, [user, disconnecting, refresh]);

  const deleteImported = useCallback(async (): Promise<boolean> => {
    if (!user || deleting) return false;
    setDeleting(true);
    setError(null);
    try {
      // Erase every row Vaylo imported for this athlete. Each delete is
      // scoped to the signed-in user, so this can never touch another account.
      // Samples first (they reference a workout), then the staged workouts,
      // then any workout-log rows mirrored from Health Connect. A failure is
      // reported instead of being swallowed: "Delete imported data" that
      // leaves rows behind is worse than an honest error.
      const samplesDelete = await supabase
        .from("health_samples")
        .delete()
        .eq("user_id", user.id);
      if (samplesDelete.error) throw new Error(samplesDelete.error.message);

      const workoutsDelete = await supabase
        .from("health_workouts")
        .delete()
        .eq("user_id", user.id);
      if (workoutsDelete.error) throw new Error(workoutsDelete.error.message);

      // Mirrored log rows exist only for sources that ran the import runner;
      // Health Connect currently stages into health_workouts, but a row with
      // this source must still be erased if a mirror ever wrote one.
      const mirroredDelete = await supabase
        .from("workouts")
        .delete()
        .eq("user_id", user.id)
        .eq("source", "health_connect");
      if (mirroredDelete.error) throw new Error(mirroredDelete.error.message);

      // Remove the bookkeeping row entirely, rather than keeping a row that
      // still says how many workouts were imported. The next connect creates a
      // clean one; a deleted row cannot make a fresh device think there is
      // still a connection.
      const { error: resetError } = await supabase
        .from("health_sync_state")
        .delete()
        .eq("user_id", user.id);
      if (resetError) throw new Error(resetError.message);
      try {
        localStorage.removeItem(`vaylo:hc:state:${user.id}`);
        // Consent stays with the live grant; deleting imported data is not a
        // disconnect. It is cleared only if the grant itself is gone.
      } catch {
        /* private mode: nothing stored to clear */
      }
      // The rows are gone, so the "imported data remains" memory has to go with
      // them or the delete control would stay on screen for nothing.
      clearImportedFlag(user.id);
      setHasImported(false);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the imported data.");
      return false;
    } finally {
      setDeleting(false);
    }
  }, [user, deleting, refresh]);

  const managePermissions = useCallback(async () => {
    await bridgeOpenSettings();
  }, []);

  return {
    status,
    apiStatus,
    syncState,
    syncStatus: syncState.syncStatus,
    consentOutdated,
    checking,
    connecting,
    syncing,
    error,
    connect,
    sync,
    disconnect,
    disconnecting,
    deleteImported,
    deleting,
    hasImported,
    managePermissions,
    clearError: () => setError(null),
  };
}
