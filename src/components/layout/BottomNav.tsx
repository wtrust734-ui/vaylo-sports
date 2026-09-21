import { useLocation, useNavigate } from "react-router-dom";
import { Home, Dumbbell, GraduationCap, MessageSquare, User } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Mobile tab bar. Rendered by AppLayout on small screens only — it gives
 * thumb-reachable access to the five destinations athletes use most, which is
 * what the app needs once it ships as a mobile build.
 */
const navItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: Dumbbell, label: "Train", path: "/training" },
  { icon: GraduationCap, label: "Learn", path: "/learning" },
  { icon: MessageSquare, label: "Coach", path: "/coach" },
  { icon: User, label: "Profile", path: "/profile" },
];

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border lg:hidden"
    >
      <div className="flex items-center justify-around px-2 py-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {navItems.map((item) => {
          const isActive = item.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              type="button"
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => navigate(item.path)}
              className="relative flex min-w-[56px] min-h-[48px] flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors active:scale-95"
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute inset-0 bg-electric-purple/10 rounded-xl"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <item.icon
                size={22}
                className={`relative z-10 transition-colors ${
                  isActive ? "text-electric-purple" : "text-muted-foreground"
                }`}
              />
              <span
                className={`relative z-10 text-[10px] font-medium transition-colors ${
                  isActive ? "text-electric-purple" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
