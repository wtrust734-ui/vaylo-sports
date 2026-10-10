// ============================================================================
// useHealthConnect — the only hook the UI needs
// ----------------------------------------------------------------------------
// Composes platform availability, connection status and the sync engine into
// one small API. Never prompts for permissions implicitly: requestPermissions
// runs only from the explicit Connect button press.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
    managePermissions,
    clearError: () => setError(null),
  };
}
