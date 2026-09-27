// ============================================================================
// usePendingJoin — remember a challenge invite across the signup wall
// ----------------------------------------------------------------------------
// A logged-out visitor on /c/:id taps "Join", creates an account, and lands in
// the app. The invite must survive that journey: the id is stashed in
// localStorage and consumed once by Auth.tsx after the session exists.
// ============================================================================

const KEY = "vaylo_pending_join";

export function stashPendingJoin(challengeId: string) {
  try {
    localStorage.setItem(KEY, challengeId);
  } catch {
    /* private mode — invite simply won't auto-join */
  }
}

/** Returns the stashed challenge id (once) or null. Always clears. */
export function consumePendingJoin(): string | null {
  try {
    const id = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return id;
  } catch {
    return null;
  }
}
