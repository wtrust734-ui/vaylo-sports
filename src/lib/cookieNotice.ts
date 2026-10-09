// ============================================================================
// THE DEVICE NOTICE — one key, one version, one answer
// ----------------------------------------------------------------------------
// The app shows two things at the bottom of the screen: the storage ("cookie")
// notice, and the terms re-acceptance banner. They anchor at the same corner and
// they must never both be up — two stacked cards with overlapping copy is worse
// than either alone.
//
// "One at a time" needs a single answer to "is the storage notice still owed?",
// and that answer needs to be readable from both components. It used to be
// written out twice, with `localStorage` read inline in both — which meant the
// rule could drift, and it meant the terms banner touched local storage at all.
// The terms banner is not allowed anywhere near a locally stored flag: an
// "already seen" flag in device storage would let a reinstall skip a consent
// event that never took place (see src/components/legal/TermsChangeNotice.tsx).
// Keeping the read here means the banner's source stays free of storage, which
// is enforced by termsReacceptance.test.ts.
//
// Storage being unavailable is NOT treated as "accepted". If the answer cannot
// be remembered, the notice is owed again — the same rule the notice itself
// follows, rather than deciding on the athlete's behalf.
// ============================================================================

export const COOKIE_NOTICE_KEY = "vaylo:cookie-notice";
export const COOKIE_NOTICE_VERSION = "2026-10-07";

/** True when this device still owes the storage notice an acknowledgement. */
export function cookieConsentPending(): boolean {
  try {
    return window.localStorage.getItem(COOKIE_NOTICE_KEY) !== COOKIE_NOTICE_VERSION;
  } catch {
    return true;
  }
}

/**
 * Told when the answer changes, so the two notices can hand over to each other
 * immediately.
 *
 * The terms banner is second in the queue, and it used to read this file's
 * answer during render only — so an athlete who accepted the storage notice sat
 * on a screen with neither card until something else happened to re-render the
 * banner (a navigation, a profile refresh). Subscribing makes the handover part
 * of the same interaction, which is what "one at a time" implies.
 *
 * Deliberately notification-only: no value is cached here, so every reader
 * still asks device storage rather than a module-level copy that a second tab
 * could contradict.
 */
const listeners = new Set<() => void>();

export function subscribeCookieConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records the acknowledgement. False when the write did not land. */
export function rememberCookieConsent(): boolean {
  try {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, COOKIE_NOTICE_VERSION);
    // Only on a write that landed: telling the banner to come forward after a
    // failed write would put two cards on screen at once, which is the exact
    // thing the priority rule exists to prevent.
    for (const listener of listeners) listener();
    return true;
  } catch {
    return false;
  }
}
