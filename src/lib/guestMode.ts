// ===========================================================================
// Guest mode — go straight into the app on the web, with no sign-in
// ----------------------------------------------------------------------------
// What this is
//
// The marketing site mounts the live app at /play/. A visitor there used to land
// on a sign-in wall whose buttons could not work: the site is served from
// .netlify.app, so OAuth has no owned domain to return the callback to, and
// `authRedirectUrl()` throws rather than inventing one. A wall of buttons that
// do nothing is worse than no wall, so on the web the app now signs the visitor
// in as a guest and drops them straight into the app.
//
// A guest is a real Supabase account (a real uuid, real RLS, real rows), created
// through supabase.auth.signInAnonymously(). That is the only kind of guest that
// works: every screen behind AppLayout's session gate queries Supabase under RLS
// keyed on auth.uid(), so a session-less "guest" would be an app where every
// query fails.
//
// What a guest is NOT
//
// Not a demo mode, not a local-only shell, and not a second copy of the app. It
// is the same build the APK runs, against the same backend. The difference is
// only that it was created anonymously, and the database gives those accounts
// zero starter credits (see
// supabase/migrations/20261003120000_anonymous_guest_no_starter_credits.sql) so
// unauthenticated sign-in cannot be used to mint credit.
//
// The APK is untouched
//
// Inside the Capacitor shell every method works — OAuth returns through the
// `com.vaylosports.app://auth-callback` scheme, which does not need a domain —
// so guest entry is gated on NOT being native. That reuses isNativeShell() from
// lib/platform.ts rather than re-deriving it: that function already handles the
// capacitor:// protocol and the Android localhost/user-agent fallback, and a
// second, thinner copy of "am I native?" is exactly how the web build ends up
// offering guest mode to the APK.
// ===========================================================================

import { isNativeShell } from "@/lib/platform";

/**
 * Whether this build should offer the web guest entry point at all.
 *
 * False inside the Capacitor shell, always. The APK has working OAuth and a real
 * email path, and forcing its users through an anonymous account would break
 * sign-in, lose the account link on upgrade, and strand anyone who already has
 * credentials.
 */
export const guestEntryAvailable = (): boolean => !isNativeShell();

/**
 * True when a session belongs to an anonymous guest.
 *
 * Read from the user object rather than the profile: `is_anonymous` is what
 * GoTrue sets, it is present before any profile query resolves, and it cannot
 * be spoofed by a client editing its own profile row.
 *
 * The `is_guest` column on profiles exists for the same question asked from the
 * database side. This is the client-side answer, and the two agree because the
 * trigger writes the column from the same value.
 */
export const isGuestUser = (user: { is_anonymous?: boolean | null } | null | undefined): boolean =>
  user?.is_anonymous === true;

/**
 * The name to show for a session.
 *
 * A guest has no email and no user_metadata, so every derivation path in
 * AuthContext's ensureProfile() yields null and the profile's full_name stays
 * empty. An empty name renders as a blank avatar and an empty header, which
 * reads as a broken account rather than a guest, so guests get an explicit
 * label. Deliberately not randomised: a stable name means a returning visitor
 * recognises their own guest account.
 */
export const GUEST_DISPLAY_NAME = "Guest";

/** A profile's display name, falling back to the guest label for guests. */
export const displayNameFor = (
  profile: { full_name?: string | null } | null | undefined,
  isGuest: boolean,
): string => {
  const name = profile?.full_name?.trim();
  if (name) return name;
  return isGuest ? GUEST_DISPLAY_NAME : "";
};
