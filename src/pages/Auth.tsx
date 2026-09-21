import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authRedirectUrl } from "@/lib/share";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.jpg";

type Mode = "auth" | "forgot" | "updatePassword";

const Auth = () => {
  const [mode, setMode] = useState<Mode>("auth");
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Password reset state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { toast } = useToast();
  const { session, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  // Only the providers this project has credentials for; null while unknown.
  const providers = useAuthProviders();

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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
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
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authRedirectUrl() },
    });
    if (error) {
      toast({ title: "Error", description: String(error.message ?? error), variant: "destructive" });
    }
  };

  const handleAppleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: authRedirectUrl() },
    });
    if (error) {
      toast({ title: "Error", description: String(error.message ?? error), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-[-50%] left-[-20%] w-[80%] h-[80%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-30%] right-[-20%] w-[60%] h-[60%] rounded-full bg-electric-glow/5 blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <motion.div
            className="inline-flex items-center gap-2 mb-4"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 20 }}
          >
            <img src={logo} alt="Vaylo Sports" className="w-14 h-14 rounded-2xl shadow-electric" />
          </motion.div>
          <motion.h1
            className="text-3xl font-display font-bold text-gradient-electric"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            Vaylo Sports
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
                className="w-full bg-card border border-border rounded-xl pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
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
                className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
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
                  className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
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
        ) : (
          <>
            {/* OAuth buttons — rendered only for providers this Supabase project
                actually has enabled, so a misconfigured one is never clickable. */}
            {providers && providers.length > 0 && (
            <>
            <motion.div
              className="space-y-3 mb-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
            >
              {providers.includes("google") && (
              <button
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-card border border-border rounded-xl py-3 text-sm font-semibold text-foreground hover:border-primary/50 transition-all duration-300 hover:shadow-glow active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              )}
              {providers.includes("apple") && (
              <button
                onClick={handleAppleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-card border border-border rounded-xl py-3 text-sm font-semibold text-foreground hover:border-primary/50 transition-all duration-300 hover:shadow-glow active:scale-[0.98]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                Continue with Apple
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
                  className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
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
                  className="w-full bg-card border border-border rounded-xl pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-300"
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
      </motion.div>
    </div>
  );
};

export default Auth;
