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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          className="w-10 h-10 border-2 border-electric-purple border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;
  if (profile && !profile.onboarding_complete) return <Navigate to="/onboarding" replace />;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      {/* pb-28 clears the tab bar; pt-safe-t keeps page headers clear of the notch
          and status bar (it is 0 in a browser, so the web layout is unchanged). */}
      <main className="pt-safe-t pb-28">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: "center top", willChange: "transform, opacity" }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <QuickCommandBar />
      {/* Thumb-reachable navigation on phones (hidden on large screens). */}
      <BottomNav />
    </div>
  );
};

export default AppLayout;
