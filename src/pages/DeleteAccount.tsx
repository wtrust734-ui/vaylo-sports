import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { authRedirectUrl } from "@/lib/share";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";
const REAUTH_FLAG = "vaylo:delete-account-reauth";

const WARNINGS = [
  "This action is permanent and takes effect immediately.",
  "All profile information will be deleted.",
  "Your entire training history, workouts and plans will be deleted.",
  "Achievements, statistics and leaderboard entries will be deleted.",
  "Friends, followers, groups and messages will be deleted.",
  "Your avatar, purchased cosmetics, coins and credits will be deleted, unless legal requirements force us to retain a record.",
  "Any premium subscription is cancelled according to the billing rules of the store you subscribed through.",
  "This action cannot be undone.",
];

export default function DeleteAccount() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const provider = (user?.app_metadata?.provider as string | undefined) ?? "email";
  const isOAuth = provider === "google" || provider === "apple";

  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reauthed, setReauthed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isOAuth && sessionStorage.getItem(REAUTH_FLAG) === "1") {
      sessionStorage.removeItem(REAUTH_FLAG);
      setReauthed(true);
    }
  }, [isOAuth]);

  const ready = useMemo(
    () => reauthed && phrase.trim() === CONFIRM_PHRASE && acknowledged && !deleting,
    [reauthed, phrase, acknowledged, deleting],
  );

  const verifyPassword = async () => {
    if (!user?.email || !password) return;
    setVerifying(true);
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    setVerifying(false);
    if (error) {
      toast({ title: "Incorrect password", description: "Please try again.", variant: "destructive" });
      return;
    }
    setReauthed(true);
    toast({ title: "Identity confirmed" });
  };

  const verifyOAuth = async () => {
    sessionStorage.setItem(REAUTH_FLAG, "1");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as "google" | "apple",
      options: {
        redirectTo: authRedirectUrl("/settings/delete-account"),
        // Force a fresh consent challenge so the re-authentication is meaningful.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      sessionStorage.removeItem(REAUTH_FLAG);
      toast({ title: "Could not re-authenticate", variant: "destructive" });
    }
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      // The server requires an explicit confirmation in the body. Without it
      // this endpoint deletes the account on any authenticated POST, so a
      // malformed request or a stray retry would be irreversible.
      const { error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: true },
      });
      if (error) throw error;
      setShowFinal(false);
      setDone(true);
      await signOut();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Please try again later.";
      toast({ title: "Could not delete account", description: message, variant: "destructive" });
      setDeleting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-5">
          <CheckCircle2 className="text-primary" size={30} />
        </motion.div>
        <h1 className="text-xl font-display font-bold mb-2">Your account has been permanently deleted.</h1>
        <p className="text-sm text-muted-foreground max-w-sm mb-8">
          Your personal data has been erased from Vaylo Sports in line with GDPR and UK GDPR. Backups are purged
          according to our retention policy.
        </p>
        <button onClick={() => navigate("/auth", { replace: true })}
          className="bg-gradient-primary text-primary-foreground font-semibold px-6 py-3 rounded-xl shadow-glow">
          Return to Welcome Screen
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-muted">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-display font-bold">Delete Your Account</h1>
      </div>

      <div className="px-5 space-y-5">
        <div className="bg-destructive/10 border border-destructive/40 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3 text-destructive font-semibold text-sm">
            <AlertTriangle size={16} /> Read this before continuing
          </div>
          <ul className="space-y-2">
            {WARNINGS.map((w) => (
              <li key={w} className="text-xs text-foreground/90 flex gap-2">
                <span className="text-destructive">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Step 1 — reauthenticate */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={16} className="text-primary" />
            <h2 className="font-semibold text-sm">1. Confirm it's you</h2>
          </div>
          {reauthed ? (
            <p className="text-xs text-primary flex items-center gap-1.5"><CheckCircle2 size={14} /> Identity confirmed</p>
          ) : isOAuth ? (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                You signed in with {provider === "google" ? "Google" : "Apple"}. Re-authenticate to continue.
              </p>
              <button onClick={verifyOAuth}
                className="w-full bg-secondary font-semibold text-sm py-3 rounded-xl">
                Re-authenticate with {provider === "google" ? "Google" : "Apple"}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password" autoComplete="current-password"
                className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-sm" />
              <button onClick={verifyPassword} disabled={!password || verifying}
                className="bg-primary text-primary-foreground px-4 rounded-xl text-sm font-semibold disabled:opacity-40">
                {verifying ? <Loader2 size={16} className="animate-spin" /> : "Verify"}
              </button>
            </div>
          )}
        </div>

        {/* Step 2 — phrase */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <h2 className="font-semibold text-sm mb-2">2. Type <span className="font-mono text-destructive">DELETE MY ACCOUNT</span></h2>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="DELETE MY ACCOUNT"
            className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" />
        </div>

        {/* Step 3 — checkbox */}
        <label className="bg-card border border-border rounded-2xl p-4 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 accent-destructive w-4 h-4" />
          <span className="text-xs text-foreground/90">
            I understand this deletion is permanent and that my Vaylo Sports data cannot be recovered.
          </span>
        </label>

        <button onClick={() => setShowFinal(true)} disabled={!ready}
          className="w-full flex items-center justify-center gap-2 bg-destructive text-destructive-foreground font-semibold py-3.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">
          <Trash2 size={16} /> Delete Account
        </button>
      </div>

      <AnimatePresence>
        {showFinal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center px-6">
            <motion.div initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-destructive/40 rounded-2xl p-5 w-full max-w-sm shadow-card">
              <h3 className="font-display font-bold text-lg mb-2">Delete Account?</h3>
              <p className="text-sm text-muted-foreground mb-5">
                This will permanently remove your VAYLO SPORTS account and all associated data. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowFinal(false)} disabled={deleting}
                  className="flex-1 bg-secondary font-semibold py-3 rounded-xl text-sm">Cancel</button>
                <button onClick={performDelete} disabled={deleting}
                  className="flex-1 bg-destructive text-destructive-foreground font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                  {deleting ? <Loader2 size={16} className="animate-spin" /> : "Permanently Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
