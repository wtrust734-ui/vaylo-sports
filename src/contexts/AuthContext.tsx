import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";

type Profile = Tables<"profiles">;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
      null;

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
      return;
    }

    await ensureProfile(nextSession.user);
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
          // Without this, a failed profile fetch/insert became an unhandled
          // rejection: the athlete stayed "signed in" with a null profile and
          // no error anywhere visible.
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


  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
