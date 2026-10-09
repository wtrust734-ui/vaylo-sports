import { useEffect, useState, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import VayloLoader from "@/components/VayloLoader";

/**
 * Route-level admin gate.
 *
 * The database is the real authorization (every admin table's RLS checks
 * has_role(uid,'admin')), so a non-admin could never actually read or write
 * admin data — but before this guard the admin screens RENDERED for everyone
 * and failed with silent query errors. This checks the role once, server-side,
 * and renders an explicit "no access" state instead of a broken screen.
 *
 * Client checks never grant anything: this only decides what to draw.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "admin" | "denied">("checking");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState("denied");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("has_role" as never, {
        _user_id: user.id,
        _role: "admin",
      } as never);
      if (cancelled) return;
      // An error here (network, revoked session) must fail CLOSED.
      setState(!error && data === true ? "admin" : "denied");
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  if (authLoading || state === "checking") {
    return <VayloLoader message="Checking access" />;
  }

  if (state !== "admin") {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center mb-4">
          <ShieldAlert size={24} className="text-destructive" aria-hidden />
        </div>
        <h1 className="text-xl font-display font-bold">No access</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          This area is restricted to Vaylo Sports administrators.
        </p>
        <button
          onClick={() => navigate("/", { replace: true })}
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={14} /> Back to the app
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
