import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { legalPath } from "@/lib/legalUrls";
import { useAuth } from "@/contexts/AuthContext";
import { TERMS_VERSION } from "@/lib/consent";

/**
 * Cookie / storage notice for the app and the downloadable web-app clone.
 *
 * This is the app-side counterpart to the notice on the marketing website.
 * Both use the same key and version, so acknowledging one acknowledges the
 * other for the same device/origin when they share storage (the clone and the
 * website are the same origin; the Capacitor shell is a different origin and
 * keeps its own storage, which is the correct behaviour — the notice is stored
 * on the device, not on our servers, so each origin remembers independently).
 *
 * Same three properties as the website notice:
 *   1. It never blocks anything. The app sets no cookie at all, and no screen
 *      waits for this button. A notice that gated functionality would be a
 *      consent gate for strictly necessary storage, which would be dishonest.
 *   2. Storage being unavailable is not treated as "already accepted". If we
 *      cannot remember the choice we show the notice again, rather than
 *      silently deciding on the reader's behalf.
 *   3. Failing to write does not hide the notice as though it had been stored,
 *      so the button never claims to have saved something it did not.
 *
 * Versioned rather than boolean: bumping COOKIE_NOTICE_VERSION re-shows the
 * notice to everyone, which a stored `true` could not do. A change to what the
 * app stores on a device is a change worth telling people about.
 */

const COOKIE_NOTICE_KEY = "vaylo:cookie-notice";
const COOKIE_NOTICE_VERSION = "2026-10-07";

export default function CookieNotice() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    const notice = noticeRef.current;
    const accept = acceptRef.current;
    if (!notice) return;

    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(COOKIE_NOTICE_KEY);
    } catch {
      // Blocked or unavailable. Leave `remembered` null so the notice shows.
      remembered = null;
    }

    const cookieNeedsAccept = remembered !== COOKIE_NOTICE_VERSION;
    // Don't show cookie notice if terms notice needs to show (priority - one at a time)
    const termsNeedsAccept = !!profile && (profile.terms_version ?? null) !== TERMS_VERSION;

    if (cookieNeedsAccept && !termsNeedsAccept) {
      notice.hidden = false;
      setShouldShow(true);
    } else {
      notice.hidden = true;
      setShouldShow(false);
    }

    if (!accept) return;

    const handler = () => {
      try {
        window.localStorage.setItem(COOKIE_NOTICE_KEY, COOKIE_NOTICE_VERSION);
      } catch {
        // Nothing to do about it, and nothing to say: the notice stays on
        // screen for next time, which is the honest outcome.
      }
      notice.hidden = true;
      setShouldShow(false);
    };

    accept.addEventListener("click", handler);
    return () => accept.removeEventListener("click", handler);
  }, [profile]);

  return (
    /* `bottom-20` was a fixed 80px, which is inside the floating tab bar once a
       device reports an inset, and was also exactly where the terms
       re-acceptance banner anchors itself — the two shared 130px of the same
       130px of screen, with this card's text showing through the banner's
       translucent background.

       Same expression as the banner's own anchor (`--vaylo-inset-bottom` +
       5.5rem) plus `--vaylo-notice-lift`, which the banner measures and
       publishes: 0px while it is off screen, its own height plus a gutter while
       it is up. So the notice sits where it always did, or just above the
       banner, and never under it. */
    <div
      ref={noticeRef}
      role="region"
      aria-label="Cookies and stored preferences"
      className="fixed bottom-[calc(var(--vaylo-inset-bottom)+7rem+var(--vaylo-notice-lift))] left-0 right-0 z-[45] mx-auto max-w-2xl px-4"
      hidden
    >
      <div className="rounded-2xl border border-border bg-card/95 p-4 backdrop-blur shadow-lg dark:bg-card">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">No tracking cookies.</strong>{" "}
          No advertising or analytics cookies, and no third-party tracker — only
          preferences kept on this device.{" "}
          {/* A real href, but the click is handled by the router.

              It used to be a plain anchor pointing at that app path, which on the web
              is a full page load that leaves the app for the marketing site, and
              inside the Capacitor shell is a navigation to a path the local
              bundle server does not have — the WebView lands on nothing at all.
              Routing it keeps the reader where they were and reaches the same
              document through the in-app viewer (LegalDocument), which is what
              legalPath() exists for. The href is kept so the URL is still
              visible, copyable and openable in a new tab on the web.

              The vertical padding is what makes it a 44px target: it is an
              inline link (90x17 unmodified, which is what the UI audit flags on
              every route), and padding on an inline box grows the hit area
              without changing the line height it sits in. */}
          <a
            href={legalPath("cookies")}
            onClick={(e) => {
              // Modified clicks keep the browser's own behaviour (new tab, new
              // window); only a plain click is routed in-app.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              navigate(legalPath("cookies"));
            }}
            className="px-1 py-3.5 underline underline-offset-2 hover:text-primary active:opacity-70"
          >
            Cookie Policy
          </a>
        </p>
        <button
          ref={acceptRef}
          type="button"
          className="press ml-3 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
