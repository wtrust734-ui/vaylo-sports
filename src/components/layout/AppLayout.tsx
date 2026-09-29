import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppSidebar from "./AppSidebar";
import BottomNav from "./BottomNav";
import QuickCommandBar from "./QuickCommandBar";
import { motion, AnimatePresence } from "framer-motion";

const AppLayout = () => {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen app-mesh bg-background flex flex-col items-center justify-center gap-4">
        <motion.div
          className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full shadow-glow"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
        <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-muted-foreground">Vaylo Sports</p>
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;
  if (profile && !profile.onboarding_complete) return <Navigate to="/onboarding" replace />;

  return (
    <div className="min-h-screen app-mesh bg-background text-foreground antialiased">
      {/* Subtle top hairline + mesh stays fixed via body, but this adds a soft vignette on large screens */}
      <div aria-hidden className="pointer-events-none fixed inset-0 hidden lg:block" style={{ background: "radial-gradient(900px 500px at 50% -10%, hsla(217 100% 60% / 0.06), transparent 70%)" }} />
      <AppSidebar />
      {/* pb-28 clears the floating tab bar.

          The top inset is NOT applied here. It lives on `body` in index.css,
          which is the only place it belongs: /auth and /onboarding render
          outside this layout, so a `pt-safe-t` here left the first two screens
          an athlete ever sees sitting under the status bar, while every screen
          that did have it risked double padding once the root rule existed. */}
      <main className="relative pb-28 lg:pl-60">
        {/* `min-w-0` on the flex/grid child is what actually stops a wide
            descendant (a long username, an AI response, a stat grid) from
            pushing the page wider than the viewport. Without it the child is
            sized by its content and `max-w` alone does not constrain it. */}
        <div className="mx-auto w-full min-w-0 max-w-[1100px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformOrigin: "center top" }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <QuickCommandBar />
      <BottomNav />
    </div>
  );
};

export default AppLayout;
