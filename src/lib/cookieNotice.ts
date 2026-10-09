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

/** Records the acknowledgement. False when the write did not land. */
export function rememberCookieConsent(): boolean {
  try {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, COOKIE_NOTICE_VERSION);
    return true;
  } catch {
    return false;
  }
}
