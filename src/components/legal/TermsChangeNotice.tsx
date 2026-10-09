import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { legalPath } from "@/lib/legalUrls";
import { TERMS_VERSION, recordTermsAcceptance } from "@/lib/consent";
import { cookieConsentPending, subscribeCookieConsent } from "@/lib/cookieNotice";

// ============================================================================
// TERMS RE-ACCEPTANCE NOTICE
// ----------------------------------------------------------------------------
// Section 17 of the Terms says that a material change will be shown to the
// athlete in the app and that they will be asked to accept it. Nothing did that
// until this component existed: `profiles.terms_version` recorded what somebody
// agreed to once, and then never moved, so a version bump changed what the
// athlete was bound by without them ever being told.
//
// What it is not:
//
//   * Not a gate. It sits above the tab bar, never covers a screen, and never
//     blocks a route. The Terms already say that continuing to use the app means
//     accepting the current version; what was missing was telling the athlete and
//     giving them the choice, not a wall in front of their own training data.
//   * Not a nag. It disappears the moment it is accepted, and it cannot be
//     dismissed without accepting — a banner that can be swiped away teaches
//     people to swipe it away, and then it protects nobody.
//   * Not a signing ceremony. There is nothing to sign: one tap stamps the
//     version, at which point the record is accurate again.
//
// Why "behind" is computed rather than stored: the athlete's own profile is the
// only source of truth about what they accepted, so a device that has been
// offline since before the change asks for the same thing as a fresh install.
// A locally stored "I already saw this" flag would let a reinstall skip a
// consent event that never happened.
// ============================================================================

const TermsChangeNotice = () => {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [saving, setSaving] = useState(false);
  // Set on a successful write so the banner leaves immediately; the single
  // profile refetch after the write is the durable fix, not a per-render fetch.
  // While the banner is open, re-fetching profile repeatedly is wasted work and
  // re-asks the same thing: the only question to answer is whether the
  // acceptance landed, and that is true once the write has gone through.
  const [accepted, setAccepted] = useState(false);
  // Shown only when the write was attempted and did not land. There is no
  // spinner-forever state: either the version is on record, or the athlete is
  // told it is not and can press again.
  const [error, setError] = useState("");

  /* The banner publishes the room it needs, so the other bottom-anchored
     notice in the app can sit above it rather than under it.

     `CookieNotice` is `position: fixed` at the same corner and the same
     z-ladder (z-45 under this banner's z-65), and neither component knows the
     other exists. At 390x844 the banner occupies 431-756px and the notice
     626-764px: 130px of the notice was painted underneath the banner's
     translucent card, with its text showing through the banner's own copy.

     Nothing static can fix that, because the height is not static: the body
     copy wraps differently at 320px and at 1440px, and the button row folds to
     two rows on a narrow phone. So this measures itself and writes the result
     to `--vaylo-notice-lift` (declared at 0px in index.css), which the notice
     adds to its own floor offset. Removing the override on unmount puts the
     notice back exactly where it was.

     `shown` duplicates the conditions below because the effect has to be
     declared unconditionally: hooks cannot sit after an early return. */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const shown = !!profile && !accepted && (profile.terms_version ?? null) !== TERMS_VERSION;
  useEffect(() => {
    const el = wrapRef.current;
    const root = document.documentElement;
    const clear = () => root.style.removeProperty("--vaylo-notice-lift");
    if (!shown || !el) {
      clear();
      return;
    }
    // Height plus a gutter, not the banner's own offset: the notice's floor
    // offset is built from the same expression this banner uses, so all it
    // needs on top of that is the banner's height and the gap above it.
    const publish = () =>
      root.style.setProperty("--vaylo-notice-lift", Math.ceil(el.getBoundingClientRect().height) + 8 + "px");
    publish();
    if (typeof ResizeObserver === "undefined") return clear;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [shown]);

  // Does the storage notice still need an answer? If so it goes first, and this
  // banner waits — deliberately, rather than both stacking in the same corner.
  // The read lives in src/lib/cookieNotice.ts, NOT here: this component must
  // never touch device storage for its own state, because a locally remembered
  // "already accepted" flag is exactly how a reinstall skips a consent event
  // (termsReacceptance.test.ts asserts the absence of storage in this file).
  //
  // Read into state and SUBSCRIBED to, rather than read once per render: this
  // banner is second in the queue, so the moment that matters is the one where
  // the athlete answers the storage notice while this is already mounted. A
  // plain read left the corner empty until something unrelated re-rendered the
  // banner — a navigation, or a profile refresh — which on a quiet screen is a
  // long wait to be told about a Terms change.
  const [cookieNeedsAccept, setCookieNeedsAccept] = useState(cookieConsentPending);
  useEffect(() => subscribeCookieConsent(() => setCookieNeedsAccept(cookieConsentPending())), []);

  // No profile yet (signed out, or the row is still loading) means nothing is
  // known about what this person accepted, and asking on a guess would be worse
  // than asking a second later.
  if (!profile || accepted) return null;

  // A null `terms_version` is "never recorded", which is behind by definition —
  // that is the state of every account created before the columns existed.
  const recorded = profile.terms_version ?? null;
  // Don't show cookie notice if terms notice needs to be shown (one at a time)
  if (cookieNeedsAccept) return null;
  if (recorded === TERMS_VERSION) return null;

  const accept = async () => {
    setSaving(true);
    setError("");
    try {
      // Order matters: stamp first, then refetch, so the banner only disappears
      // because the record agrees with it rather than because a timer passed.
      // `recordTermsAcceptance` reports whether the row was written, and a "no"
      // leaves the prompt exactly where it was — a consent the athlete believes
      // they gave and we cannot evidence is worse than an unaccepted banner.
      const written = await recordTermsAcceptance();
      if (!written) {
        setError(
          "We could not save that just now. Nothing has changed on your account — please try again.",
        );
        return;
      }
      setAccepted(true);
      // Single refetch after the write, awaited so the order the test pins is
      // the order that runs: stamp the version, then re-read the profile. The
      // banner no longer re-fetches on every render while it is up; the only
      // thing that can change while it is up is whether the acceptance landed,
      // and that is either already on record or it is not.
      await refreshProfile();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      role="status"
      aria-live="polite"
      /* Above the tab bar's z-50 and clear of it: bottom-anchored content has to
         clear the floating bar's own height plus the device inset, or the
         Accept button ends up underneath the navigation. On large screens the
         bar is not rendered, so the offset is small. */
      className="fixed inset-x-3 bottom-[calc(var(--vaylo-inset-bottom)+5.5rem)] z-[65] lg:inset-x-auto lg:right-6 lg:bottom-6 lg:max-w-md"
    >
      <div className="rounded-2xl border border-primary/40 bg-card/95 p-4 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3">
          <FileText size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">We have updated the Terms of Service</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              You accepted
              {recorded ? (
                <>
                  {" "}
                  <span className="font-medium text-foreground">version {recorded}</span>
                </>
              ) : (
                " an earlier version"
              )}
              . Version {TERMS_VERSION} adds standard contract terms — separability, the
              whole agreement, and events outside our control. Nothing about what we
              collect, or who we share it with, has changed.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void accept()}
                className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                ) : (
                  <Check size={12} aria-hidden />
                )}
                I accept version {TERMS_VERSION}
              </button>
              <button
                type="button"
                onClick={() => navigate(legalPath("terms"))}
                className="press inline-flex min-h-[44px] items-center rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-foreground"
              >
                Read the Terms
              </button>
              <button
                type="button"
                onClick={() => navigate("/settings/delete-account")}
                className="inline-flex min-h-[44px] items-center px-1 text-xs text-muted-foreground underline underline-offset-2 active:opacity-70"
              >
                Or delete your account
              </button>
            </div>

            {error && (
              <p role="alert" className="mt-2 text-[11px] leading-relaxed text-destructive">
                {error}
              </p>
            )}

            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              You can keep using Vaylo Sports without pressing this, but the version above
              is the one that applies, and you can read or export your data at any time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsChangeNotice;
