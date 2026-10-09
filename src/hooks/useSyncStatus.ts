// ============================================================================
// useSyncStatus — the app's one answer to "is my training safe?"
// ----------------------------------------------------------------------------
// Wires the two halves together: the offline write queue (what is still waiting)
// and connectivity (whether it can go anywhere), through the pure derivation in
// lib/syncStatus.ts. Screens never compute a state themselves — they render what
// this returns, so the banner, a settings row and a screen footnote cannot
// disagree about whether the athlete's session has been saved.
//
// Reconnecting does real work: queued writes replay, and any import that was
// started while offline runs. Both are idempotent, so a reconnect that fires
// twice — which it does, between the `online` event and the next mount — is
// harmless.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  flushQueue,
  pendingConflicts,
  pendingWrites,
  subscribeToQueue,
} from "@/lib/offlineQueue";
import { runQueuedImports } from "@/lib/health/importRunner";
import {
  EMPTY_SYNC_FACTS,
  deriveSyncState,
  syncStatusCopy,
  type SyncCopy,
  type SyncFacts,
  type SyncState,
} from "@/lib/syncStatus";

const LAST_SYNCED_KEY = "vaylo.sync.lastSyncedAt.v1";

function readLastSynced(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNCED_KEY);
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLastSynced(at: number) {
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(at));
  } catch {
    /* private mode: the label just won't survive a relaunch */
  }
}

export interface SyncStatus extends SyncFacts {
  state: SyncState;
  copy: SyncCopy;
  /** Replays the queue and runs anything queued while offline. */
  retry: () => void;
  /** True while a drain is in flight, for disabling buttons. */
  busy: boolean;
}

export function useSyncStatus(userId?: string | null): SyncStatus {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pending, setPending] = useState(() => pendingWrites().length);
  const [conflicts, setConflicts] = useState(() => pendingConflicts().length);
  const [flushing, setFlushing] = useState(false);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(readLastSynced);
  const inFlight = useRef(false);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // The queue is the source of truth for what is waiting; subscribing keeps the
  // badge honest when a write is added or a conflict is created elsewhere.
  useEffect(
    () =>
      subscribeToQueue((queue) => {
        setPending(queue.length);
        setConflicts(queue.filter((w) => !!w.conflict).length);
      }),
    [],
  );

  const drain = useCallback(async () => {
    if (inFlight.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    inFlight.current = true;
    setFlushing(true);
    try {
      const uid = userIdRef.current;
      if (uid) {
        // An import started offline is a queued row, not a lost tap.
        try {
          await runQueuedImports(uid);
        } catch {
          /* reported through the queue's own state below */
        }
      }
      const before = pendingWrites().length;
      await flushQueue();
      const after = pendingWrites().length;
      if (after === 0) {
        const now = Date.now();
        setLastSyncedAt(now);
        writeLastSynced(now);
        setLastErrorAt(null);
      } else if (after >= before) {
        // Nothing drained and something is still waiting: it did not work.
        setLastErrorAt(Date.now());
      }
    } catch {
      setLastErrorAt(Date.now());
    } finally {
      inFlight.current = false;
      setFlushing(false);
    }
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void drain();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    // A launch straight into a dead spot that regains signal a second later is
    // the normal case; waiting for a fresh `online` event would strand the queue.
    const timer = window.setTimeout(() => void drain(), 1200);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearTimeout(timer);
    };
  }, [drain]);

  const facts: SyncFacts = {
    ...EMPTY_SYNC_FACTS,
    online,
    pending,
    conflicts,
    flushing,
    lastErrorAt,
    lastSyncedAt,
  };
  const state = deriveSyncState(facts);

  return {
    ...facts,
    state,
    copy: syncStatusCopy(state, facts),
    retry: () => void drain(),
    busy: flushing,
  };
}
