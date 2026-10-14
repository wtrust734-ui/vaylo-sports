// ============================================================================
// SYNC STATUS — one state, derived from facts
// ----------------------------------------------------------------------------
// The specification names four states to represent: Offline, Syncing, Synced and
// Sync error. They are not four independent booleans — connectivity, the queue,
// and whether the last attempt failed all describe the same situation from
// different angles, and letting a screen pick one is how an app tells an athlete
// "Synced" while three workouts sit in a queue.
//
// So there is exactly one derivation, here, pure and testable, and every surface
// (banner, settings row, screen footnote) renders whatever it returns. The
// priority order below is the whole design:
//
//   1. a conflict the athlete must resolve outranks everything — nothing else
//      they see is true until it is resolved;
//   2. offline outranks "syncing", because claiming to be syncing with no
//      connection is the specific lie this module exists to prevent;
//   3. an error outranks a queue count, because a failing send is not progress;
//   4. only when nothing is pending may the app say "Synced". An app that has
//      never synced anything says so, rather than claiming success by default.
// ============================================================================

export type SyncState = "idle" | "offline" | "syncing" | "synced" | "error";

export interface SyncFacts {
  /** navigator.onLine, as observed — a hint, not a guarantee. */
  online: boolean;
  /** Writes waiting in the offline queue. */
  pending: number;
  /** Queued edits that need the athlete to choose a side. */
  conflicts: number;
  /** A replay is running right now. */
  flushing: boolean;
  /** When the last send attempt failed, if it did. */
  lastErrorAt: number | null;
  /** When the queue last drained cleanly, if it ever has. */
  lastSyncedAt: number | null;
}

export const EMPTY_SYNC_FACTS: SyncFacts = {
  online: true,
  pending: 0,
  conflicts: 0,
  flushing: false,
  lastErrorAt: null,
  lastSyncedAt: null,
};

/** The single source of truth for which of the four states applies. */
export function deriveSyncState(facts: SyncFacts): SyncState {
  if (facts.conflicts > 0) return "error";
  if (!facts.online) return "offline";
  if (facts.flushing) return "syncing";
  if (facts.pending > 0 && facts.lastErrorAt !== null) return "error";
  if (facts.pending > 0) return "syncing";
  if (facts.lastSyncedAt !== null) return "synced";
  // Online, nothing pending, nothing ever sent: there is no honest claim of
  // success to make, so make none.
  return "idle";
}

export type SyncTone = "muted" | "ok" | "warning" | "danger";

export interface SyncCopy {
  label: string;
  detail: string;
  tone: SyncTone;
  /** "retry" renders a tappable retry control; null renders a static chip. */
  action: "retry" | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The words for a state.
 *
 * Every one of these is a statement about THIS DEVICE, not about the server, and
 * the offline copy says where the data is ("saved on this device") rather than
 * what failed. An athlete in a gym needs to know their set was kept, not which
 * request the network dropped.
 */
export function syncStatusCopy(state: SyncState, facts: SyncFacts): SyncCopy {
  switch (state) {
    case "offline":
      return {
        label: "Offline",
        detail:
          facts.pending > 0
            ? `${plural(facts.pending, "change", "changes")} saved on this device — ${facts.pending === 1 ? "it" : "they"} will sync when you reconnect.`
            : "You can keep logging. Everything you record is saved on this device.",
        tone: "warning",
        action: null,
      };
    case "syncing":
      return {
        label: "Syncing…",
        detail:
          facts.pending > 0
            ? `${plural(facts.pending, "change", "changes")} on the way to your account.`
            : "Sending your changes.",
        tone: "muted",
        action: null,
      };
    case "synced":
      return {
        label: "Synced",
        detail: "Everything you've logged is saved to your account.",
        tone: "ok",
        action: null,
      };
    case "error":
      if (facts.conflicts > 0) {
        return {
          label: "Sync needs you",
          detail: `${plural(facts.conflicts, "edit", "edits")} also changed on another device. Choose which to keep.`,
          tone: "danger",
          action: "retry",
        };
      }
      return {
        label: "Sync error",
        detail: `${plural(facts.pending, "change", "changes")} couldn't be sent. Tap to try again.`,
        tone: "danger",
        action: "retry",
      };
    default:
      return {
        label: "Saved on device",
        detail: "Your training is stored here and backed up when you're online.",
        tone: "muted",
        action: null,
      };
  }
}

/** True when the state is worth putting in front of the athlete unprompted. */
export function syncNeedsAttention(state: SyncState): boolean {
  return state === "offline" || state === "error";
}

/**
 * How long after launch the "Synced" confirmation stays silent.
 *
 * The queue drains ~1.2s after every launch, so without this the app drops a
 * green "Synced" banner over the home screen on every single open — a
 * confirmation for work the athlete did not do, arriving exactly when they
 * are orienting. Nobody opens an app to be told nothing happened.
 */
export const BOOT_FLASH_GRACE_MS = 8000;

/** True while the launch is still fresh enough that a sync flash is boot noise. */
export function inBootGrace(mountedAtMs: number, nowMs: number): boolean {
  return nowMs - mountedAtMs < BOOT_FLASH_GRACE_MS;
}
