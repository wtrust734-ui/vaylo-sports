/**
 * The pathname prefix the app is mounted under, for React Router.
 *
 * Why this exists
 * ---------------
 * The app has three homes and each needs a different answer:
 *
 *   - the Android WebView (`capacitor://localhost/`), built with base "/" and
 *     routed with a HashRouter, so there is no server path to strip;
 *   - a root-mounted web host, where base is "/" and the answer is "";
 *   - the marketing site, which serves this same bundle from /play/, where the
 *     answer is "/play".
 *
 * Without a basename, mounting at /play/ produces a specific and quiet failure:
 * the document loads, assets resolve (Vite rewrote them for the base), and the
 * app renders — but the router compares the full path "/play/training" against
 * its route table, matches nothing, and shows the 404 screen. A refresh on any
 * deep link inside the preview lands on Not Found while in-app navigation from
 * the home screen works, which is exactly the class of bug that only shows up
 * once it is deployed.
 *
 * The value comes from Vite's own `base`, not from a second environment
 * variable, so the asset URLs and the router can never disagree about where the
 * app lives.
 */

/**
 * Vite always exposes BASE_URL, including as "/" for the two root mounts, so
 * there is no undefined case to handle. The `?? "/"` is only a guard for tests
 * that import this module outside a Vite context.
 */
const base = import.meta.env.BASE_URL ?? "/";

/**
 * React Router wants a basename with no trailing slash, and wants "" rather
 * than "/" for a root mount — it strips the basename from the pathname before
 * matching, and a leading-slash basename is accepted but the empty string is
 * the documented form for "mounted at the root".
 */
export const routerBasename = (): string => {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed;
};

/**
 * The basename to hand to an anchor's href. Unlike the router, a plain
 * `href="/auth"` is a full document load: the browser asks the server for
 * /auth, which the marketing site answers with its own 404 rather than the app
 * shell. So any href that must survive the sub-path mount goes through here.
 */
export const appHref = (path: string): string => {
  const prefix = routerBasename();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${suffix}`;
};