// ============================================================================
// BACK BAR — one back affordance for every detail screen
// ----------------------------------------------------------------------------
// Tab roots have the bottom navigation, so a back button there would point at
// nothing. Every OTHER screen is reached by drilling in from somewhere, and
// until now the only way back was the Android hardware button or the browser
// gesture — which is not discoverable on a phone, and is not available at all
// to somebody in the web build who arrived from a shared link.
//
// So this renders once, in the app shell, for every route that is neither a tab
// root nor one of the screens that already draws its own control. Those nine
// are listed in OWN_BACK_ROUTES below: a static list rather than a registry the
// screens opt into, because a registry needs an edit in each of nine lazy route
// chunks and the failure mode of forgetting one is a second "Back" stacked
// directly above the first — a visible bug, in a screen nobody re-checks.
//
// Where it goes when there is nowhere to go back to: a cold load of a deep link
// (a shared challenge, a notification) has no previous entry, and navigate(-1)
// there would either do nothing or leave the site. React Router marks the
// initial history entry with key "default", so that is the test — when there is
// genuinely no history, the bar goes to the app's home instead, which is the
// screen the athlete would have arrived at anyway.
// ============================================================================

import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { isTabRoot } from "./TabShell";

/**
 * Screens that already render their own back control, so the global bar must
 * not appear above them. Route *prefixes*: "/profile/" also covers
 * /profile/:username, which draws its own floating back button.
 */
export const OWN_BACK_ROUTES = [
  "/challenges/",
  "/coach",
  "/settings/delete-account",
  "/packs/",
  "/learning/",
  "/mental",
  "/profile/",
  "/safety",
  "/subscription",
] as const;

/** True when this pathname belongs to a screen that draws its own back control. */
export const hasOwnBackButton = (pathname: string): boolean =>
  OWN_BACK_ROUTES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix,
  );

/** True when the shell should render the shared back bar for this pathname. */
export const shouldShowBackBar = (pathname: string): boolean =>
  !isTabRoot(pathname) && !hasOwnBackButton(pathname);

const BackBar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  if (!shouldShowBackBar(location.pathname)) return null;

  // React Router gives the very first history entry the key "default". If we
  // are on it, there is nothing behind us to return to.
  const canGoBack = location.key !== "default";

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)]">
      <button
        type="button"
        data-page-back
        onClick={() => (canGoBack ? navigate(-1) : navigate("/"))}
        className="group inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.05] py-2 pl-3 pr-4 text-[13px] font-semibold text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.25)] will-change-transform hover:border-white/[0.18] hover:bg-white/[0.09] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-[0.96] motion-reduce:transform-none"
        style={{
          // ONE transition for every property the button changes on hover and
          // press. The old version transitioned colour only, so the tap gave
          // no feedback at all until the next screen arrived — the thing that
          // makes a back button feel unsmooth rather than look it. No
          // `transition-colors` utility here: it would overwrite the transform
          // half and the press would snap.
          transition:
            "transform 140ms cubic-bezier(0.4, 0, 0.2, 1), border-color 180ms ease, background-color 180ms ease, color 180ms ease",
        }}
        aria-label={canGoBack ? "Go back" : "Go to the home screen"}
      >
        <ArrowLeft
          size={16}
          aria-hidden
          // The chevron leans the way the tap will go — the directional cue
          // that makes a back press read as movement rather than a click.
          className="transition-transform duration-200 ease-out group-active:-translate-x-0.5 motion-reduce:transition-none"
        />
        Back
      </button>
    </div>
  );
};

export default BackBar;