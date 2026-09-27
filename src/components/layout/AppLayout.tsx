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
      {/* pb-28 clears the floating tab bar; pt-safe-t keeps headers clear of the notch */}
      <main className="relative pt-safe-t pb-28 lg:pl-60">
        <div className="mx-auto w-full max-w-[1100px]">
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
