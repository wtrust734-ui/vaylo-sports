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
  connectHealthConnect,
  disconnectHealthConnect,
  fetchServerSyncState,
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
  deleting: boolean;
  managePermissions: () => Promise<void>;
  clearError: () => void;
}

export function useHealthConnect(): UseHealthConnect {
  const { user } = useAuth();
  const [status, setStatus] = useState<HealthConnectionStatus>("checking");
  const [apiStatus, setApiStatus] = useState<HealthApiStatus>("unknown");
  const [syncState, setSyncState] = useState<StoredHealthState>({ lastSyncAt: null, cursorMs: null });
  const [consentOutdated, setConsentOutdated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      const local = readLocalState(user.id);
      const server = await fetchServerSyncState(user.id);
      setSyncState({
        lastSyncAt: local.lastSyncAt ?? server.lastSyncAt,
        cursorMs: local.cursorMs ?? server.cursorMs,
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
    try {
      // Revocation of the upstream Health Connect grants is not possible from
      // the app — the athlete manages those in Health Connect itself (the
      // Manage button). This stops Vaylo reading: consent cleared locally and
      // on the server, cursor reset, so no further sync runs.
      await disconnectHealthConnect(user.id);
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
      // Erase the rows Vaylo imported for this athlete. Each table is scoped
      // to the signed-in user, so this can never touch another account.
      for (const table of ["health_workouts", "health_samples"] as const) {
        const { error: deleteError } = await supabase
          .from(table)
          .delete()
          .eq("user_id", user.id);
        if (deleteError) throw new Error(deleteError.message);
      }
      // Reset the sync cursor so the next connect starts clean.
      const { error: resetError } = await supabase.from("health_sync_state").upsert({
        user_id: user.id,
        connected: false,
        last_sync_at: null,
        last_incremental_cursor: null,
        synced_workout_count: 0,
      });
      if (resetError) throw new Error(resetError.message);
      try {
        localStorage.removeItem(`vaylo:hc:state:${user.id}`);
      } catch {
        /* private mode: nothing stored to clear */
      }
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
    managePermissions,
    clearError: () => setError(null),
  };
}
