import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, Dumbbell, Gauge, User } from "lucide-react";
import { motion } from "framer-motion";
import QuickActionSheet from "./QuickActionSheet";

const LEFT = [
  { icon: Home, labelKey: "navigation.home", path: "/", exact: true },
  { icon: Dumbbell, labelKey: "navigation.train", path: "/train", exact: false },
] as const;
const RIGHT = [
  { icon: Gauge, labelKey: "navigation.perform", path: "/perform", exact: false },
  { icon: User, labelKey: "navigation.profile", path: "/profile", exact: true },
] as const;

const isActivePath = (item: { path: string; exact: boolean }, pathname: string) =>
  item.exact ? pathname === item.path : pathname.startsWith(item.path);

const NavButton = ({ item }: { item: (typeof LEFT)[number] | (typeof RIGHT)[number] }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isActive = isActivePath(item, location.pathname);
  const Icon = item.icon;
  const label = t(item.labelKey);

  return (
    <button
      type="button"
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      onClick={() => navigate(item.path)}
      className="relative flex min-w-[56px] min-h-[48px] flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-2xl transition-[transform,background,color] duration-200 active:scale-95"
    >
      {isActive && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute inset-0 rounded-2xl bg-primary/10 border border-primary/15"
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
        />
      )}
      <Icon
        size={18}
        className={`relative z-10 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
      />
      <span
        className={`relative z-10 text-[9px] font-bold tracking-widest truncate max-w-[64px] ${isActive ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </button>
  );
};

const BottomNav = () => {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("navigation.primaryNav")}
      className="fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 lg:hidden pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-[520px] rounded-[22px] border border-white/[0.08] bg-card/95 sm:bg-card/75 sm:backdrop-blur-2xl shadow-card">
        <div className="flex items-center justify-around px-2 py-2">
          {LEFT.map((item) => (
            <NavButton key={item.path} item={item} />
          ))}
          <QuickActionSheet />
          {RIGHT.map((item) => (
            <NavButton key={item.path} item={item} />
          ))}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
