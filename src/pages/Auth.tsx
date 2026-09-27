import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Lock, Eye, EyeOff, KeyRound, Fingerprint, Wand2, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authRedirectUrl } from "@/lib/share";
import { consumePendingJoin } from "@/hooks/usePendingJoin";
import { useAuthMethods, passkeySupported, normalisePhone } from "@/hooks/use-auth-providers";
import { startOAuth, awaitOAuthDeepLink, completeNativeOAuth, buildNativeCallbackUrl, usesNativeOAuth } from "@/lib/nativeOAuth";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.jpg";

type Mode = "auth" | "forgot" | "updatePassword";

// Referral invites arrive as /auth?ref=CODE, but the athlete usually has no
// account yet at that point, so the code is parked here until a session exists.
// Nothing in the app read the `ref` parameter before, which meant every share
// link the Referrals page produced was a dead end — the invitee had to find
// /referrals and retype the code by hand.
const REF_KEY = "vaylo_pending_referral";

/** Reads `ref` from either `?ref=` or `#/auth?ref=` (hash routing). */
function readRefFromUrl(): string | null {
  for (const raw of [window.location.search, window.location.hash]) {
    const q = raw.indexOf("?");
    if (q === -1) continue;
    const code = new URLSearchParams(raw.slice(q + 1)).get("ref");
    if (code?.trim()) return code.trim().toUpperCase();
  }
  return null;
}

const storedRef = (): string | null => {
  try { return localStorage.getItem(REF_KEY); } catch { return null; }
};

const clearStoredRef = () => {
  try { localStorage.removeItem(REF_KEY); } catch { /* storage unavailable */ }
};

const Auth = () => {
  const [mode, setMode] = useState<Mode>("auth");
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingRef, setPendingRef] = useState<string | null>(null);

  // Phone sign-in state: number → code → session.
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneRaw, setPhoneRaw] = useState("");
  const [phoneSentTo, setPhoneSentTo] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState("");

  // Password reset state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { toast } = useToast();
  const { session, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  // What this Supabase project actually offers (OAuth, passkeys, email);
  // null while unknown, so dead buttons never render.
  const methods = useAuthMethods();
  // Passkeys need both the server flag and a WebAuthn-capable browser.
  const [deviceSupportsPasskeys, setDeviceSupportsPasskeys] = useState(false);
  useEffect(() => setDeviceSupportsPasskeys(passkeySupported()), []);
  // Show the alternatives section only when at least one non-password method
  // is genuinely available (OAuth, passkey on both server+device, magic link,
  // phone).
  const showMethodsSection =
    !!methods &&
    (methods.providers.length > 0 ||
      (methods.passkeys && deviceSupportsPasskeys) ||
      methods.email ||
      methods.phone);

  // A recovery link (from "Forgot password") lands back on /auth with a token.
  // Supabase picks up the session from the URL; PASSWORD_RECOVERY tells us to
  // show the set-new-password form.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("updatePassword");
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authLoading || !session || mode === "updatePassword") return;
    navigate(profile?.onboarding_complete ? "/" : "/onboarding", { replace: true });
  }, [authLoading, navigate, profile?.onboarding_complete, session, mode]);

  // Park an invite code from the URL so it survives sign-up and onboarding.
  useEffect(() => {
    const fromUrl = readRefFromUrl();
    if (fromUrl) { try { localStorage.setItem(REF_KEY, fromUrl); } catch { /* storage unavailable */ } }
    setPendingRef(fromUrl ?? storedRef());
  }, []);

  // Redeem once the athlete is authenticated. Attribution and the credit grants
  // both happen server-side in redeem_referral(), so a failure here costs
  // nothing but the bonus — never the account.
  useEffect(() => {
    if (!session || !pendingRef) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("redeem_referral" as never, { p_code: pendingRef } as never);
      if (cancelled) return;
      // Cleared either way: "Already referred" and "Invalid code" are final, and
      // retrying them on every page load would be noise.
      clearStoredRef();
      setPendingRef(null);
      // A challenge invite may also be waiting from /c/:id: join now that an
      // account exists (consumePendingJoin clears the stash either way).
      const pendingJoin = consumePendingJoin();
      if (pendingJoin) {
        void supabase.rpc("join_challenge_by_id" as never, { p_challenge: pendingJoin } as never).then(
          () => undefined,
          () => undefined,
        );
      }
      if (error) {
        console.warn("Referral not applied:", error.message);
        return;
      }
      const granted = Number((data as { referee_credits?: number } | null)?.referee_credits ?? 0);
      if (granted > 0) {
        toast({ title: `+${granted} credits`, description: "A friend's invite code was applied to your account." });
      }
    })();
    return () => { cancelled = true; };
  }, [session, pendingRef, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        toast({
          title: "Account created!",
          description: "You're in. Let’s finish onboarding.",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl("/auth"),
      });
      if (error) throw error;
      setResetEmailSent(true);
      toast({
        title: "Check your inbox",
        description: "If an account exists for that email, a reset link is on its way.",
      });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Too short", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Re-enter both passwords so they match.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: "Password updated", description: "You're signed in with your new password." });
      navigate("/", { replace: true });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Phone: step 1 sends an SMS OTP (supabase.auth.signInWithOtp with `phone`),
  // step 2 exchanges the code for a session. Creates the account on first use,
  // exactly like magic-link sign-up.
  const handlePhoneSend = async () => {
    const phone = normalisePhone(phoneRaw);
    if (!phone) {
      toast({
        title: "Check the number",
        description: "Include the country code, e.g. +44 7700 900123.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
      setPhoneSentTo(phone);
      setPhoneCode("");
      toast({ title: "Code sent", description: `A 6-digit code is on its way to ${phone}.` });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneVerify = async () => {
    if (!phoneSentTo) return;
    const token = phoneCode.replace(/\D/g, "");
    if (token.length < 4) {
      toast({ title: "Enter the code", description: "Type the code from the SMS we just sent.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: phoneSentTo, token, type: "sms" });
      if (error) throw error;
      // Success resolves with a session; the auth listener redirects.
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Magic link: passwordless sign-in/sign-up over email. Rides the same email
  // provider as passwords, so it is offered whenever email auth is enabled.
  const handleMagicLink = async () => {
    if (!email.trim()) {
      toast({
        title: "Enter your email first",
        description: "Type the email you'd like the sign-in link sent to.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authRedirectUrl("/auth") },
      });
      if (error) throw error;
      toast({
        title: "Check your inbox",
        description: "If that address can sign in, a magic link is on its way. Open it on this device to finish.",
      });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Passkey: the browser runs the WebAuthn ceremony and supabase-js exchanges
  // the assertion for a session. Works for any athlete who registered a
  // passkey from their Profile page.
  const handlePasskeySignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
      // Success resolves with a session; the auth listener redirects.
    } catch (error) {
      toast({ title: "Passkey sign-in failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftSignIn = async () => {
    try {
      const url = await startOAuth("azure", { scopes: "email profile openid offline_access" });
      if (url && usesNativeOAuth()) {
        const { code, flowId } = await awaitOAuthDeepLink(url);
        await completeNativeOAuth(buildNativeCallbackUrl(code, flowId));
      }
      // Web: startOAuth already redirected the page.
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleDiscordSignIn = async () => {
    try {
      const url = await startOAuth("discord");
      if (url && usesNativeOAuth()) {
        const { code, flowId } = await awaitOAuthDeepLink(url);
        await completeNativeOAuth(buildNativeCallbackUrl(code, flowId));
      }
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleFacebookSignIn = async () => {
    try {
      const url = await startOAuth("facebook");
      if (url && usesNativeOAuth()) {
        const { code, flowId } = await awaitOAuthDeepLink(url);
        await completeNativeOAuth(buildNativeCallbackUrl(code, flowId));
      }
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleLinkedInSignIn = async () => {
    try {
      const url = await startOAuth("linkedin_oidc");
      if (url && usesNativeOAuth()) {
        const { code, flowId } = await awaitOAuthDeepLink(url);
        await completeNativeOAuth(buildNativeCallbackUrl(code, flowId));
      }
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const url = await startOAuth("google");
      if (url && usesNativeOAuth()) {
        const { code, flowId } = await awaitOAuthDeepLink(url);
        await completeNativeOAuth(buildNativeCallbackUrl(code, flowId));
      }
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleAppleSignIn = async () => {
    try {
      const url = await startOAuth("apple");
      if (url && usesNativeOAuth()) {
        const { code, flowId } = await awaitOAuthDeepLink(url);
        await completeNativeOAuth(buildNativeCallbackUrl(code, flowId));
      }
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen app-mesh bg-background flex flex-col items-center justify-center px-5 py-8 relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(900px 600px at 18% -8%, hsla(272 84% 62% / 0.14), transparent 62%), radial-gradient(760px 520px at 88% 0%, hsla(217 100% 60% / 0.12), transparent 62%)" }} />
      <div aria-hidden className="pointer-events-none absolute -top-28 -right-28 h-[520px] w-[520px] rounded-full blur-3xl opacity-[0.12]" style={{ background: "radial-gradient(circle at center, hsl(var(--primary) / 0.9), transparent 68%)" }} />

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm relative z-10 rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl shadow-card overflow-hidden p-6 sm:p-7"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.06] via-transparent to-transparent" />
        <div className="relative">
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <motion.div
            className="mx-auto inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-primary shadow-glow border border-white/10 overflow-hidden mb-4"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 20 }}
          >
            <img src={logo} alt="Vaylo Sports" className="h-14 w-14 object-cover" />
          </motion.div>
          <motion.h1
            className="text-[28px] font-display font-bold tracking-tight"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <span className="bg-gradient-to-br from-white via-white to-white/70 bg-clip-text text-transparent">Vaylo Sports</span>{' '}<span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400 bg-clip-text text-transparent">Sports</span>
          </motion.h1>
          <motion.p
            className="text-sm text-muted-foreground mt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {mode === "updatePassword"
              ? "Set your new password."
              : mode === "forgot"
                ? "We'll get you back in the game."
                : isLogin
                  ? "Welcome back, athlete."
                  : "Start your performance journey."}
          </motion.p>
        </motion.div>

        {mode === "updatePassword" ? (
          /* ── Set new password (after clicking the email link) ── */
          <motion.form
            onSubmit={handleUpdatePassword}
            className="space-y-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
          >
            <div className="relative">
              <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type={showNewPassword ? "text" : "password"}
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type={showNewPassword ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
              />
            </div>
            <motion.button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-50 shadow-glow transition-all duration-300 hover:shadow-electric"
              whileTap={{ scale: 0.98 }}
              whileHover={{ scale: 1.01 }}
            >
              {loading ? "Updating..." : "Set New Password"}
            </motion.button>
          </motion.form>
        ) : mode === "forgot" ? (
          /* ── Request a reset link ── */
          resetEmailSent ? (
            <motion.div
              className="text-center space-y-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
            >
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 mb-2">
                <Mail size={24} className="text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="text-foreground font-semibold">{email}</span>, a reset
                link is on its way. Check your inbox (and spam).
              </p>
              <button
                onClick={() => { setMode("auth"); setResetEmailSent(false); }}
                className="text-primary font-semibold text-sm hover:underline transition-colors"
              >
                Back to Sign In
              </button>
            </motion.div>
          ) : (
            <motion.form
              onSubmit={handleForgotPassword}
              className="space-y-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
            >
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
                />
              </div>
              <motion.button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-50 shadow-glow transition-all duration-300 hover:shadow-electric"
                whileTap={{ scale: 0.98 }}
                whileHover={{ scale: 1.01 }}
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </motion.button>
              <button
                type="button"
                onClick={() => setMode("auth")}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to Sign In
              </button>
            </motion.form>
          )
        ) : phoneOpen ? (
          /* ── Phone sign-in: number → SMS code → session ── */
          <motion.div
            className="space-y-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
          >
            {!phoneSentTo ? (
              <>
                <p className="text-xs text-muted-foreground">
                  We'll text you a 6-digit sign-in code. Standard message rates apply.
                </p>
                <div className="relative">
                  <Smartphone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+44 7700 900123"
                    value={phoneRaw}
                    onChange={(e) => setPhoneRaw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handlePhoneSend(); } }}
                    maxLength={20}
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
                  />
                </div>
                <motion.button
                  type="button"
                  onClick={handlePhoneSend}
                  disabled={loading}
                  className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-50 shadow-glow transition-all duration-300 hover:shadow-electric"
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ scale: 1.01 }}
                >
                  {loading ? "Sending..." : "Send Code"}
                </motion.button>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Enter the code sent to <span className="text-foreground font-semibold">{phoneSentTo}</span>.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handlePhoneVerify(); } }}
                  maxLength={6}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur px-4 py-3 text-center text-lg font-semibold tracking-[0.4em] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
                />
                <motion.button
                  type="button"
                  onClick={handlePhoneVerify}
                  disabled={loading}
                  className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-50 shadow-glow transition-all duration-300 hover:shadow-electric"
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ scale: 1.01 }}
                >
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </motion.button>
                <button
                  type="button"
                  onClick={() => { setPhoneSentTo(null); setPhoneCode(""); }}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Use a different number
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => { setPhoneOpen(false); setPhoneSentTo(null); setPhoneCode(""); }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to Sign In
            </button>
          </motion.div>
        ) : (
          <>
            {/* Alternative sign-in methods — rendered only for methods this
                Supabase project actually has enabled, so a misconfigured one is
                never clickable. */}
            {showMethodsSection && (
            <>
            <motion.div
              className="space-y-3 mb-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
            >
              {methods!.providers.includes("google") && (
              <button
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              )}
              {methods!.providers.includes("apple") && (
              <button
                onClick={handleAppleSignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                Continue with Apple
              </button>
              )}
              {methods!.providers.includes("azure") && (
              <button
                onClick={handleMicrosoftSignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <svg width="17" height="17" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>
                Continue with Microsoft
              </button>
              )}
              {methods!.providers.includes("discord") && (
              <button
                onClick={handleDiscordSignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                Continue with Discord
              </button>
              )}
              {methods!.providers.includes("facebook") && (
              <button
                onClick={handleFacebookSignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97H15.83c-1.491 0-1.956.93-1.956 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
                Continue with Facebook
              </button>
              )}
              {methods!.providers.includes("linkedin") && (
              <button
                onClick={handleLinkedInSignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
                Continue with LinkedIn
              </button>
              )}
              {methods!.phone && (
              <button
                onClick={() => setPhoneOpen(true)}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <Smartphone size={18} className="text-primary" />
                Sign in with phone
              </button>
              )}
              {methods!.passkeys && deviceSupportsPasskeys && (
              <button
                onClick={handlePasskeySignIn}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <Fingerprint size={18} className="text-primary" />
                Sign in with a passkey
              </button>
              )}
              {methods!.email && (
              <button
                onClick={handleMagicLink}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur py-3 text-sm font-semibold text-foreground hover:bg-white/[0.07] hover:border-white/15 transition-colors active:scale-[0.98]"
              >
                <Wand2 size={18} className="text-primary" />
                Email me a sign-in link
              </button>
              )}
            </motion.div>

            {/* Divider */}
            <motion.div
              className="flex items-center gap-3 mb-5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </motion.div>
            </>
            )}

            <motion.form
              onSubmit={handleSubmit}
              className="space-y-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
            >
              <AnimatePresence mode="wait">
                {!isLogin && (
                  <motion.p
                    key="signup-copy"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="text-xs text-muted-foreground"
                  >
                    Create your account now — you’ll choose what to be called during onboarding.
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
                />
              </div>

              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {isLogin && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setResetEmailSent(false); }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <motion.button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-50 shadow-glow transition-all duration-300 hover:shadow-electric"
                whileTap={{ scale: 0.98 }}
                whileHover={{ scale: 1.01 }}
              >
                {loading ? "Loading..." : isLogin ? "Sign In" : "Create Account"}
              </motion.button>
            </motion.form>

            <motion.p
              className="text-center text-sm text-muted-foreground mt-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
            >
              {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-primary font-semibold hover:underline transition-colors"
              >
                {isLogin ? "Sign Up" : "Sign In"}
              </button>
            </motion.p>
          </>
        )}
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
