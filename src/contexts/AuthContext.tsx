import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";
import { queryClient } from "@/lib/queryClient";
import { clearUserLocalState } from "@/lib/userStorage";
import { unregisterPush } from "@/lib/push";
import { guestEntryAvailable, GUEST_DISPLAY_NAME, isGuestUser } from "@/lib/guestMode";
import { DEMO_MODE, demoGuestSession } from "@/lib/demoMode";
import { recordTermsAcceptance } from "@/lib/consent";
import { readFailed } from "@/lib/dbRead";

type Profile = Tables<"profiles">;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Set when the profile row could not be loaded after sign-in. */
  profileError: string | null;
  /** True when the session is an anonymous web guest, not a real account. */
  isGuest: boolean;
  /** Set when guest entry failed and the athlete must sign in instead. */
  guestError: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  profileError: null,
  isGuest: false,
  guestError: null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  // A guest that could not be created leaves the athlete on the sign-in wall
  // with no explanation unless this is surfaced, so it is tracked separately
  // from profileError: that one means "signed in, profile unreadable", this one
  // means "never got signed in at all".
  const [guestError, setGuestError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    setProfile(data);
    return data;
  }, []);
  const ensureProfile = useCallback(async (currentUser: User) => {
    const existingProfile = await fetchProfile(currentUser.id);

    if (existingProfile) return existingProfile;

    const fallbackName =
      currentUser.user_metadata?.preferred_name ??
      currentUser.user_metadata?.full_name ??
      currentUser.user_metadata?.name ??
      currentUser.email?.split("@")[0] ??
      // A guest has no email and no metadata, so every path above is null and
      // the profile would be left nameless. The display helper covers this at
      // render time too; writing it here means the row itself is readable in
      // the database rather than only in the UI.
      (isGuestUser(currentUser) ? GUEST_DISPLAY_NAME : null);

    const { data, error } = await supabase
      .from("profiles")
      .insert({
        user_id: currentUser.id,
        // No hardcoded credit amount: the signup trigger normally creates this
        // row with the server-configured starter grant, and the column default
        // is the right fallback if the trigger ever didn't run.
        full_name: fallbackName,
      })
      .select("*")
      .single();

    if (error) {
      // Two tabs (or a retried session) can race this insert; the row exists by
      // now, so read it back instead of failing the whole sign-in.
      if (error.code === "23505") {
        const raced = await fetchProfile(currentUser.id);
        if (raced) return raced;
      }
      throw error;
    }

    setProfile(data);
    return data;
  }, [fetchProfile]);

  const syncSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    if (DEMO_MODE) {
      // Clone build (docs/WEB-CLONE.md): there is no backend to read a profile
      // from. The guest label is rendered from displayNameFor(user, isGuest),
      // so a null profile here is the intended state — not an error to surface.
      setProfile(null);
      setProfileError(null);
      return;
    }

    try {
      await ensureProfile(nextSession.user);
      setProfileError(null);
    } catch (err) {
      // The session is real but the profile row is unreadable (network error,
      // RLS race, server outage). Expose it: screens keyed on `profile` would
      // otherwise render "signed in with no data" and every silent failure
      // would look like data loss.
      setProfileError(err instanceof Error ? err.message : "Couldn't load your profile");
      setProfile(null);
    }
  }, [ensureProfile]);

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    let active = true;
    let initialized = false;

    const hydrateAuth = (nextSession: Session | null, isInitial: boolean) => {
      if (!active) return;
      // Only show full-page loader on the very first hydrate.
      // Token refreshes and other auth events should NOT unmount the app.
      if (isInitial) setLoading(true);
      void syncSession(nextSession)
        .catch((err) => {
          // Surface instead of throwing unhandled: the athlete stays signed in
          // with profileError set, and AppLayout offers a retry.
          console.error("Auth hydrate failed:", err);
        })
        .finally(() => {
          if (active && isInitial) setLoading(false);
        });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        hydrateAuth(nextSession, !initialized);
        initialized = true;
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrateAuth(session, !initialized);
      initialized = true;
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [syncSession]);

  /**
   * Web guest entry.
   *
   * On the web, a visitor with no session is signed in anonymously so the app
   * goes straight in instead of showing a wall of sign-in buttons that cannot
   * work (.netlify.app has no owned domain for an OAuth callback). A guest is a
   * real account with a real uuid, so RLS and every query behind the session
   * gate behave exactly as they do for a signed-up athlete — the database gives
   * these accounts zero starter credits, so nothing of value can be minted.
   *
   * Three things this deliberately does NOT do:
   *
   *   - Run inside the Capacitor shell. The APK's OAuth works, and swapping a
   *     real athlete for an anonymous account would lose their identity.
   *   - Loop. signInAnonymously fires onAuthStateChange(PASSWORD_RECOVERY-style
   *     SIGNED_IN), so a naive retry here would mint an account per event. The
   *     flag below makes it strictly once-per-load, and the returned session is
   *     handed to hydrateAuth rather than re-fetched.
   *   - Swallow a failure. If GoTrue rejects it (anonymous sign-in disabled in
   *     the dashboard, say), the athlete must still reach the sign-in page, so
   *     the error is recorded and loading is released.
   */
  useEffect(() => {
    if (!guestEntryAvailable()) return;
    let active = true;
    let attempted = false;

    void (async () => {
      // Re-read the session rather than trusting the state at effect time: the
      // athlete may already be signed in, and signing them out to replace a real
      // account with a guest would be destructive.
      const { data, error: sessionReadError } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) return;
      // A failed session read is NOT "no session". Minting a guest here would
      // sign a real athlete out of their own account and into a throwaway one,
      // so the failure stops the guest path instead of feeding it. Quiet: this
      // runs at startup, where a toast is noise and the log is the signal.
      if (readFailed(sessionReadError, "your session", { quiet: true })) return;
      if (attempted) return;
      attempted = true;

      // Clone build: mint the local guest instead of an anonymous account —
      // there is no GoTrue to ask, and the clone's client URL is a reserved
      // .invalid hostname (docs/WEB-CLONE.md).
      if (DEMO_MODE) {
        if (!active) return;
        setGuestError(null);
        await syncSession(demoGuestSession());
        if (active) setLoading(false);
        return;
      }

      const { data: guest, error } = await supabase.auth.signInAnonymously();
      if (!active) return;
      if (error || !guest.session) {
        setGuestError(error?.message ?? "Couldn't start a guest session.");
        setLoading(false);
        return;
      }
      // Deliberately hydrates the session we were just handed rather than
      // calling getSession() again: onAuthStateChange already fired for this
      // sign-in and will hydrate too, and a second read invites a second
      // anonymous account if the first is not visible yet.
      setGuestError(null);
      await syncSession(guest.session);
      // A guest account is a real account, and the Terms say "By creating an
      // account you accept them" (legal/terms.html) — so stamp which version
      // the moment one exists. Swallowed and non-blocking by contract (see
      // src/lib/consent.ts): a failed stamp must never strand the visitor.
      void recordTermsAcceptance();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [syncSession]);


  /**
   * Sign-out that actually forgets the athlete.
   *
   * The server (Supabase) removes the session first; then every client-side
   * cache that could show one athlete's data to the next is dropped: the
   * react-query cache, user-scoped localStorage keys (RPE log, pending
   * invites, arcade records), and the in-memory profile. Without this, a
   * shared device kept the previous athlete's data on screen after switching
   * accounts.
   *
   * For a guest, signing out clears the local state and mints a fresh anonymous
   * session rather than dropping to the sign-in wall. There is no credential to
   * return to, so signing a guest out and leaving them there would strand them
   * on a page they cannot leave — the app is only reachable as a guest. The old
   * guest's server-side rows are left alone; they belong to a uuid nobody holds
   * any more, and they carry no credits.
   */
  const signOut = async () => {
    const wasGuest = isGuestUser(user);
    try {
      // Before the session is torn down, because the registration row can only
      // be deleted while this account is still authenticated.
      //
      // A push token belongs to the INSTALL, not to the person. Skip this and a
      // phone signed out of Alice and into Bob keeps delivering Alice's
      // notifications, on a handset that may since have changed hands.
      await unregisterPush();
      await supabase.auth.signOut();
    } finally {
      // Runs even if the network call failed — being signed out locally is
      // the safe direction, and the redirect must never strand state.
      queryClient.clear();
      clearUserLocalState();
      setSession(null);
      setUser(null);
      setProfile(null);
      setProfileError(null);
    }

    if (!wasGuest || !guestEntryAvailable()) return;

    // Clone build: re-mint the local guest rather than calling the network.
    if (DEMO_MODE) {
      await syncSession(demoGuestSession());
      return;
    }

    const { data: guest, error } = await supabase.auth.signInAnonymously();
    if (error || !guest.session) {
      // Could not mint the replacement. Record it rather than leaving a blank
      // screen; AppLayout falls through to /auth, which still works for a
      // visitor who has credentials.
      setGuestError(error?.message ?? "Couldn't start a guest session.");
      return;
    }
    await syncSession(guest.session);
    // Same stamp as above: this re-mint mints a brand-new account (the old
    // guest's rows are left behind), and consent belongs to the account.
    void recordTermsAcceptance();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        profileError,
        isGuest: isGuestUser(user),
        guestError,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
