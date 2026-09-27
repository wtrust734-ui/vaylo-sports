import { useLocation, useNavigate } from "react-router-dom";
import { Home, Play, BarChart3, MessageSquare, User } from "lucide-react";
import { motion } from "framer-motion";

const items = [
  { icon: Home, label: "Home", path: "/" },
  { icon: BarChart3, label: "Stats", path: "/vpr" },
  { icon: Play, label: "Train", path: "/workouts", primary: true },
  { icon: MessageSquare, label: "Coach", path: "/coach" },
  { icon: User, label: "You", path: "/profile" },
];

const QuickCommandBar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <motion.nav
      aria-label="Quick actions"
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 28 }}
      className="fixed bottom-4 left-1/2 hidden -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md lg:block"
    >
      <div className="relative rounded-[22px] border border-white/[0.08] bg-card/70 sm:backdrop-blur-2xl shadow-card px-2 py-2 flex items-center justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.06] to-transparent" />
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          if (item.primary) {
            return (
              <motion.button
                key={item.path}
                onClick={() => navigate(item.path)}
                whileTap={{ scale: 0.92 }}
                aria-label={item.label}
                className="relative -mt-7 w-14 h-14 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-electric border border-white/15"
              >
                <item.icon size={22} className="text-primary-foreground fill-primary-foreground" />
              </motion.button>
            );
          }
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 flex-1 rounded-xl transition-colors"
            >
              {isActive && (
                <motion.div
                  layoutId="qcb-active"
                  className="absolute inset-x-1 inset-y-0 bg-primary/10 rounded-xl border border-primary/10"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <item.icon size={18} className={`relative z-10 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
              <span className={`relative z-10 text-[9px] font-bold tracking-widest ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </motion.nav>
  );
};

export default QuickCommandBar;
