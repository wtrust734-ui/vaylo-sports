// ============================================================================
// USER-SCOPED LOCAL STORAGE
// ----------------------------------------------------------------------------
// Some caches deliberately live in localStorage (they must survive a reload
// without a network round trip). Keys that are NOT namespaced by user id would
// leak one athlete's data into another's session on a shared device, so every
// such key is registered here and wiped on sign-out / account switch.
// ============================================================================

/** Keys owned by the app that hold per-user data without a uid in the name. */
export const USER_SCOPED_STORAGE_KEYS = [
  "vaylo_rpe_log_v1", // legacy RPE log (its only reader was deleted 2026-10-06; the key stays so sign-out still clears it)
  "vaylo_trigger_prefs_v1", // daily-check dedup state (streak/workout nudges)
  "vaylo_pending_referral", // un-redeemed invite code
  "vaylo_pending_join", // un-consumed challenge invite
] as const;

/** Prefixes of keys that embed the user id (vaylo_arcade_best_<uid>_<game>). */
export const USER_SCOPED_STORAGE_PREFIXES = ["vaylo_arcade_best_"] as const;

/**
 * Removes every user-scoped key. Called on sign-out and account switch so a
 * shared device never shows athlete A's RPE history, pending invites or arcade
 * records to athlete B. Safe to call repeatedly; storage failures are ignored
 * (private mode) — the server, not the cache, is the source of truth.
 */
export function clearUserLocalState(): void {
  try {
    for (const key of USER_SCOPED_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && USER_SCOPED_STORAGE_PREFIXES.some((p) => key.startsWith(p))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
