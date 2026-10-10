import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CloudOff, CloudUpload, Loader2, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  dismissFailures,
  pendingConflicts,
  pendingFailures,
  resolveConflict,
  subscribeToQueue,
  type QueuedFailure,
  type QueuedWrite,
} from "@/lib/offlineQueue";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useAuth } from "@/contexts/AuthContext";
import { syncNeedsAttention, type SyncState, type SyncTone } from "@/lib/syncStatus";

/**
 * The app's one offline and sync surface.
 *
 * This banner previously told the athlete that "cached plans, workouts and
 * routines still work. New logs sync when you reconnect." Neither half was
 * true: there was no cache and no queue, so an offline log was simply lost.
 * The offline write queue (src/lib/offlineQueue.ts) fixed the second half, and
 * the copy was scoped to exactly the one write path that used it.
 *
 * That path is gone. The workout log screen was removed on 2026-10-05, so
 * nothing queued a write and the banner became a drain indicator with nothing
 * to drain — its own render guard said so.
 *
 * Both halves are true again as of Phase 5, and the banner is the place that
 * says so:
 *
 *   • WRITES QUEUE. Life events and plan adjustments always did; Phase 5 adds
 *     import requests and imported-session corrections. The copy counts
 *     "changes", not "workouts", because those are the things that queue.
 *   • READS ARE CACHED. src/lib/offlineCache.ts keeps the snapshots the offline
 *     screens need, so "saved on this device" is a checkable claim rather than
 *     reassurance.
 *
 * Four states, one derivation: `useSyncStatus` owns the state machine
 * (src/lib/syncStatus.ts) and this component only renders it, so the banner,
 * a screen footnote and a settings row can never disagree about whether the
 * athlete's session is safe. When the server moved a row out from under an
 * offline edit, the choice of which version to keep is offered here, in place —
 * a conflict announced but unactionable would be worse than not noticing it.
 */
const TONE: Record<SyncTone, string> = {
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive text-destructive-foreground",
  ok: "bg-emerald-600 text-white",
  muted: "bg-card text-foreground border-b border-border",
};

/** "sleep_quality" → "sleep quality", for a field name a person can read. */
const humanField = (field: string) => field.replace(/_/g, " ");
const humanTable = (table: string) => table.replace(/_/g, " ");

/**
 * Why a change was given up on, in the athlete's terms.
 *
 * The server's own message is shown beside this where there is one: a
 * constraint name is what support will ask for, and paraphrasing it would only
 * lose information. `overflow` has no server message, because no server was
 * involved — the queue filled up on the device.
 */
const FAILURE_NOTE: Record<QueuedFailure["reason"], string> = {
  rejected: "the server refused it",
  row_missing: "it was deleted before it could be sent",
  overflow: "the device was offline so long that the queue filled up and this was the oldest change",
};

const OfflineBanner = () => {
  const { user } = useAuth();
  const sync = useSyncStatus(user?.id ?? null);
  const [conflicted, setConflicted] = useState<QueuedWrite[]>(() => pendingConflicts());
  // Writes the app gave up on. Read here rather than in useSyncStatus because
  // it is a notice about a specific change, not a state of the connection.
  const [failed, setFailed] = useState<QueuedFailure[]>(() => pendingFailures());
  const [resolving, setResolving] = useState<string | null>(null);
  // "Synced" is a transient confirmation, not a permanent badge: a status row
  // that never changes is one people stop reading.
  const [flashSynced, setFlashSynced] = useState(false);
  // The last sync state seen, so only a TRANSITION into "synced" flashes. The
  // last successful drain is persisted, so a relaunch resolves straight to
  // "synced" — flashing then would drop a banner over the app on every launch,
  // which is the opposite of the confirmation this is for.
  const previousState = useRef<SyncState | null>(null);

  useEffect(
    () =>
      subscribeToQueue(() => {
        setConflicted(pendingConflicts());
        // Dead letters live in the same module and notify through the same
        // listener set, so one subscription keeps both counts honest — a second
        // mechanism would be a second thing to forget to update.
        setFailed(pendingFailures());
      }),
    [],
  );

  useEffect(() => {
    const previous = previousState.current;
    previousState.current = sync.state;
    if (previous === null || sync.state !== "synced") return;
    setFlashSynced(true);
    const timer = window.setTimeout(() => setFlashSynced(false), 2600);
    return () => window.clearTimeout(timer);
  }, [sync.state]);

  // Render when there is something to act on or know. Offline alone qualifies:
  // Phase 5 asks for an explicit offline indicator, and with a real write queue
  // and a real snapshot cache, "saved on this device" is true.
  // A dead letter is its own reason to render: it happens while online, with an
  // empty queue and a "synced" state, which is precisely when the athlete would
  // otherwise never find out that a logged session did not land.
  const visible = syncNeedsAttention(sync.state) || sync.pending > 0 || flashSynced || failed.length > 0;
  if (!visible) return null;

  const Icon =
    sync.state === "offline"
      ? CloudOff
      : sync.state === "error"
        ? AlertTriangle
        : sync.state === "synced"
          ? Check
          : sync.pending > 0
            ? CloudUpload
            : Loader2;

  const decide = async (id: string, choice: "mine" | "theirs") => {
    setResolving(id);
    try {
      await resolveConflict(id, choice);
      setConflicted(pendingConflicts());
      sync.retry();
    } finally {
      setResolving(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -40 }}
        animate={{ y: 0 }}
        exit={{ y: -40 }}
        // `fixed top-0` puts this outside the body's inset padding, so it has
        // to carry its own. `pt-safe-t` was a dead class (defined nowhere
        // since the root rule landed) and the banner's text sat under the
        // status bar whenever the app went offline.
        className={`fixed top-0 left-0 right-0 z-[70] max-h-[70vh] overflow-y-auto px-4 py-2 pt-[calc(var(--vaylo-inset-top)+0.5rem)] text-xs font-semibold shadow-lg ${TONE[sync.copy.tone]}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center justify-center gap-2 text-center">
          <Icon size={14} className={sync.state === "syncing" ? "animate-spin" : undefined} />
          <span>{sync.copy.label}</span>
          <span className="font-normal opacity-90">{sync.copy.detail}</span>
        </div>

        {conflicted.length > 0 && (
          <ul className="mx-auto mt-2 max-w-[560px] space-y-2 text-left font-normal">
            {conflicted.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-current/25 bg-background/20 px-3 py-2"
              >
                <p className="text-xs font-semibold">
                  {humanTable(item.table)}
                  {item.conflict?.fields.length
                    ? ` · ${item.conflict.fields.map(humanField).join(", ")}`
                    : ""}
                </p>
                <p className="mt-0.5 text-[11px] opacity-90">
                  {item.conflict?.reason === "baseline_unreadable"
                    ? "This couldn't be checked against your account, so it hasn't been sent."
                    : "Changed here and on another device."}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={resolving === item.id}
                    onClick={() => void decide(item.id, "mine")}
                    className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    Keep this device
                  </button>
                  <button
                    type="button"
                    disabled={resolving === item.id}
                    onClick={() => void decide(item.id, "theirs")}
                    className="rounded-md border border-current/40 px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60"
                  >
                    Keep the other one
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {failed.length > 0 && (
          <div className="mx-auto mt-2 max-w-[560px] text-left font-normal">
            <p className="text-xs font-semibold">
              {failed.length === 1
                ? "One change could not be saved"
                : `${failed.length} changes could not be saved`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {failed.slice(0, 3).map((item) => (
                <li key={`${item.id}:${item.failedAt}`} className="text-[11px] opacity-90">
                  {humanTable(item.table)} — {FAILURE_NOTE[item.reason]}
                  {item.message ? ` (${item.message})` : ""}
                </li>
              ))}
            </ul>
            {failed.length > 3 && (
              <p className="mt-0.5 text-[11px] opacity-80">
                and {failed.length - 3} more
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                dismissFailures();
                setFailed(pendingFailures());
              }}
              className="mt-2 rounded-md border border-current/40 px-2.5 py-1 text-[11px] font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {sync.copy.action === "retry" && conflicted.length === 0 && failed.length === 0 && (
          <div className="mt-1 flex justify-center">
            <button
              type="button"
              onClick={sync.retry}
              disabled={sync.busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-current/40 px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60"
            >
              <RefreshCw size={11} />
              Retry
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default OfflineBanner;
