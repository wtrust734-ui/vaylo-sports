import {
  Home,
  Dumbbell,
  User,
  Activity,
  Menu,
  X,
  LogOut,
  Zap,
  ShoppingBag,
  ScanLine,
  Gamepad2,
  Users,
  MessageSquare,
  Package,
  Medal,
  Target,
  Swords,
  TrendingUp,
  Fingerprint,
  Flag,
  Shuffle,
  GraduationCap,
  BarChart3,
  Award,
  Eye,
  Sparkles,
  Crosshair,
  Rss,
  Flame,
  Timer,
  Gift,
  Trophy,
  Palette,
  HeartPulse,
  Apple,
  Calendar,
  Gauge,
  Scale,
  Brain,
  ShieldAlert,
  MapPin,
  Watch,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatSports } from "@/lib/profile";
import { discordInviteUrl } from "@/config/community";
import { usePersonalization } from "@/hooks/usePersonalization";
import { NAV_CATALOG } from "@/lib/personalization/nav";
import logo from "@/assets/logo.jpg";

function CommunityLink() {
  const navigate = useNavigate();
  if (!discordInviteUrl()) return null;
  return (
    <button
      type="button"
      onClick={() => navigate("/discord")}
      className="mb-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <MessageSquare size={14} /> Community
    </button>
  );
}

type NavItem = { icon: LucideIcon; labelKey: string; path: string };
type NavGroup = { titleKey: string; hubPath: string | null; icon: LucideIcon; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    titleKey: "sidebar.groupHome",
    hubPath: "/",
    icon: Home,
    items: [
      { icon: Home, labelKey: "sidebar.dashboard", path: "/" },
      { icon: Rss, labelKey: "sidebar.activityFeed", path: "/feed" },
    ],
  },
  {
    titleKey: "sidebar.groupTrain",
    hubPath: "/train",
    icon: Dumbbell,
    items: [
      { icon: Zap, labelKey: "sidebar.trainingPlans", path: "/training" },
      { icon: Dumbbell, labelKey: "sidebar.workouts", path: "/workouts" },
      { icon: Timer, labelKey: "sidebar.routines", path: "/routines" },
      { icon: Shuffle, labelKey: "sidebar.crossTraining", path: "/cross-training" },
      { icon: Flame, labelKey: "sidebar.pbs", path: "/pbs" },
      { icon: ScanLine, labelKey: "sidebar.formAnalysis", path: "/form" },
      { icon: Eye, labelKey: "sidebar.arOverlay", path: "/ar-overlay" },
    ],
  },
  {
    titleKey: "sidebar.groupPerform",
    hubPath: "/perform",
    icon: Gauge,
    items: [
      { icon: Gauge, labelKey: "sidebar.vpr", path: "/vpr" },
      { icon: BarChart3, labelKey: "sidebar.metricsHub", path: "/metrics" },
      { icon: Target, labelKey: "sidebar.skills", path: "/skills" },
      { icon: TrendingUp, labelKey: "sidebar.development", path: "/development" },
      { icon: Fingerprint, labelKey: "sidebar.identity", path: "/identity" },
      { icon: Crosshair, labelKey: "sidebar.goals", path: "/goals" },
      { icon: Scale, labelKey: "sidebar.compare", path: "/compare" },
    ],
  },
  {
    titleKey: "sidebar.groupRecover",
    hubPath: "/recover",
    icon: HeartPulse,
    items: [
      { icon: HeartPulse, labelKey: "sidebar.recovery", path: "/recovery" },
      { icon: Watch, labelKey: "sidebar.wearables", path: "/health-sync" },
      { icon: Apple, labelKey: "sidebar.nutrition", path: "/nutrition" },
      { icon: Brain, labelKey: "sidebar.mental", path: "/mental" },
      { icon: ShieldAlert, labelKey: "sidebar.injury", path: "/injury" },
    ],
  },
  {
    titleKey: "sidebar.groupCompete",
    hubPath: "/compete",
    icon: Trophy,
    items: [
      { icon: Calendar, labelKey: "sidebar.events", path: "/events" },
      { icon: Flag, labelKey: "sidebar.challenges", path: "/challenges" },
      { icon: Trophy, labelKey: "sidebar.leaderboard", path: "/leaderboard" },
      { icon: Users, labelKey: "sidebar.friends", path: "/friends" },
      { icon: Sparkles, labelKey: "sidebar.communities", path: "/communities" },
      { icon: Swords, labelKey: "sidebar.opponents", path: "/opponents" },
      { icon: Gamepad2, labelKey: "sidebar.arcade", path: "/arcade" },
    ],
  },
  {
    titleKey: "sidebar.groupLearn",
    hubPath: "/learning",
    icon: GraduationCap,
    items: [
      { icon: GraduationCap, labelKey: "sidebar.learning", path: "/learning" },
      { icon: MessageSquare, labelKey: "sidebar.coach", path: "/coach" },
    ],
  },
  {
    titleKey: "sidebar.groupYou",
    hubPath: "/profile",
    icon: User,
    items: [
      { icon: Activity, labelKey: "sidebar.achievements", path: "/achievements" },
      { icon: Medal, labelKey: "sidebar.avatarStudio", path: "/avatar" },
      { icon: Palette, labelKey: "sidebar.collection", path: "/collection" },
      { icon: Package, labelKey: "sidebar.eventPacks", path: "/event-packs" },
      { icon: ShoppingBag, labelKey: "sidebar.creditsCoins", path: "/market" },
      { icon: Award, labelKey: "sidebar.subscription", path: "/subscription" },
      { icon: Gift, labelKey: "sidebar.referEarn", path: "/referrals" },
      { icon: MapPin, labelKey: "sidebar.notifications", path: "/notifications" },
      { icon: User, labelKey: "sidebar.profile", path: "/profile" },
    ],
  },
];

const STORAGE_KEY = "vaylo:sidebar-expanded";

function isPathActive(itemPath: string, pathname: string) {
  if (itemPath === "/") return pathname === "/";
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`) || pathname.startsWith(itemPath);
}

function groupContainsPath(group: NavGroup, pathname: string) {
  if (group.hubPath && isPathActive(group.hubPath, pathname)) return true;
  return group.items.some((it) => isPathActive(it.path, pathname));
}

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // ignore
  }
  return {};
}

const AppSidebar = () => {
  const [open, setShowAllOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const personalization = usePersonalization();
  const setOpen = setShowAllOpen; // keep existing naming intact

  // Personalised nav: same groups/icons, filtered + reordered per athlete.
  const navGroupsFiltered = useMemo<NavGroup[]>(() => {
    const iconFor = new Map(navGroups.flatMap((g) => g.items.map((it) => [it.path, it.icon] as const)));
    const groupIcon = new Map(navGroups.map((g) => [g.titleKey, g.icon] as const));
    const byTitle = new Map(navGroups.map((g) => [g.titleKey, g] as const));

    return NAV_CATALOG.map((spec) => {
      const base = byTitle.get(spec.titleKey);
      if (!base) return null;
      const items: NavItem[] = personalization
        .visible(spec.items.map((it) => ({ ...it })))
        .map(({ labelKey, path }) => ({
          labelKey,
          path,
          icon: iconFor.get(path) ?? base.icon,
        }));
      if (items.length === 0) return null; // whole group irrelevant
      return {
        titleKey: spec.titleKey,
        hubPath: spec.hubPath,
        icon: groupIcon.get(spec.titleKey) ?? base.icon,
        items,
      };
    }).filter((g): g is NavGroup => g !== null);
  }, [personalization]);

  const activeGroupKey = useMemo(() => {
    const found = navGroupsFiltered.find((g) => groupContainsPath(g, location.pathname));
    return found?.titleKey ?? null;
  }, [navGroupsFiltered, location.pathname]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const stored = loadExpanded();
    // ensure active group is expanded on first paint
    if (activeGroupKey && stored[activeGroupKey] === undefined) {
      return { ...stored, [activeGroupKey]: true };
    }
    // default: first group expanded when nothing stored and no active match
    if (Object.keys(stored).length === 0 && !activeGroupKey) {
      return { "sidebar.groupHome": true };
    }
    return stored;
  });

  // Auto-expand the group that contains the current route so the active item is always visible
  useEffect(() => {
    if (!activeGroupKey) return;
    setExpanded((prev) => {
      if (prev[activeGroupKey]) return prev;
      const next = { ...prev, [activeGroupKey]: true };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [activeGroupKey]);

  const persist = useCallback((next: Record<string, boolean>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const toggleGroup = useCallback(
    (key: string) => {
      setExpanded((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const handleHeaderClick = useCallback(
    (group: NavGroup) => {
      const isActiveGroup = group.titleKey === activeGroupKey;
      // Toggle visibility
      toggleGroup(group.titleKey);
      // If this header represents a hub and we are not already on that hub
      // (or inside it), navigate there — navigates + expands in one tap.
      if (group.hubPath && !isActiveGroup) {
        navigate(group.hubPath);
        if (window.innerWidth < 1024) setOpen(false);
      }
    },
    [activeGroupKey, navigate, toggleGroup],
  );

  const handleNav = useCallback(
    (path: string) => {
      navigate(path);
      setOpen(false);
    },
    [navigate],
  );

  const handleSignOut = useCallback(async () => {
    await signOut();
    setOpen(false);
    navigate("/auth");
  }, [navigate, signOut]);

  const isExpanded = useCallback(
    (key: string) => {
      if (expanded[key] !== undefined) return expanded[key];
      // default: only the active group is expanded when no explicit preference
      return key === activeGroupKey;
    },
    [activeGroupKey, expanded],
  );

  const renderGroup = (group: NavGroup, variant: "desktop" | "mobile") => {
    const expandedNow = isExpanded(group.titleKey);
    const activeGroup = group.titleKey === activeGroupKey;
    const GroupIcon = group.icon;
    const hasActiveChild = group.items.some((it) => isPathActive(it.path, location.pathname));

    return (
      <div key={group.titleKey} className={variant === "desktop" ? "mb-1" : "mb-1.5"}>
        <button
          type="button"
          onClick={() => handleHeaderClick(group)}
          aria-expanded={expandedNow}
          aria-controls={`section-${group.titleKey}`}
          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
            activeGroup
              ? "bg-white/[0.06] text-foreground"
              : hasActiveChild
                ? "text-foreground"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
          }`}
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[11px] ${
              activeGroup
                ? "border-primary/30 bg-primary/15 text-primary"
                : hasActiveChild
                  ? "border-white/10 bg-white/[0.06] text-foreground"
                  : "border-white/[0.06] bg-white/[0.03] text-muted-foreground"
            }`}
            aria-hidden
          >
            <GroupIcon size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">
            {t(group.titleKey)}
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            {!expandedNow && !activeGroup && hasActiveChild && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-glow" aria-hidden />
            )}
            {!expandedNow && (
              <span className="min-w-[18px] rounded-full bg-white/[0.06] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-muted-foreground">
                {group.items.length}
              </span>
            )}
            <ChevronDown
              size={14}
              className={`shrink-0 text-muted-foreground transition-transform duration-200 ${expandedNow ? "rotate-180" : ""}`}
            />
          </span>
        </button>

        <AnimatePresence initial={false}>
          {expandedNow && (
            <motion.div
              id={`section-${group.titleKey}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="ms-3 border-s border-white/[0.06] ps-2 pt-1 pb-1">
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isPathActive(item.path, location.pathname);
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleNav(item.path)}
                        aria-current={active ? "page" : undefined}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                          active
                            ? "bg-gradient-primary text-primary-foreground shadow-glow font-semibold border border-white/10"
                            : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground border border-transparent"
                        }`}
                      >
                        <item.icon size={15} className={`shrink-0 ${active ? "text-primary-foreground" : ""}`} />
                        <span className="truncate text-[13px]">{t(item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <>
      {/* Mobile hamburger — solid (no blur) for WebView perf */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t("sidebar.openMenu")}
        className="fixed start-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-card shadow-soft text-foreground hover:bg-card/90 lg:hidden"
      >
        <Menu size={18} />
      </button>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[272px] flex-col border-e border-white/[0.06] bg-card/60 backdrop-blur-2xl lg:flex">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent pointer-events-none" />
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary shadow-glow overflow-hidden">
            <img src={logo} alt="Vaylo Sports" className="h-10 w-10 object-cover" />
          </div>
          <div className="min-w-0">
            <span className="block font-display text-[17px] font-bold tracking-tight leading-none">Vaylo</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sports</span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4 no-scrollbar" aria-label={t("navigation.sections")}>
          {navGroupsFiltered.map((g) => renderGroup(g, "desktop"))}
        </nav>
        <div className="border-t border-white/[0.06] px-4 py-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
              {(profile?.full_name?.[0] ?? "A").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-none">{profile?.full_name || t("dashboard.athleteFallbackName")}</p>
              <p className="truncate text-[11px] text-muted-foreground">{formatSports(profile?.sport)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] py-2.5 text-[13px] font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/20 hover:bg-destructive/10 transition-colors"
          >
            <LogOut size={14} /> {t("auth.signOut")}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label={t("sidebar.closeMenu")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-[#060712]/70 lg:hidden"
            />
            <motion.aside
              initial={{ x: document.documentElement.dir === "rtl" ? "100%" : "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: document.documentElement.dir === "rtl" ? "100%" : "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed inset-y-0 start-0 z-50 flex w-[84vw] max-w-[320px] flex-col border-e border-white/[0.08] bg-[#0B0C1A] lg:hidden shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl overflow-hidden bg-gradient-primary shadow-glow flex items-center justify-center">
                    <img src={logo} alt="Vaylo Sports" className="h-9 w-9 object-cover" />
                  </div>
                  <div className="min-w-0 leading-none">
                    <span className="block font-display text-lg font-bold tracking-tight leading-none">Vaylo</span>
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sports</span>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label={t("sidebar.closeMenu")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-muted-foreground hover:text-foreground"
                >
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-4 no-scrollbar" aria-label={t("navigation.sections")}>
                {navGroupsFiltered.map((g) => renderGroup(g, "mobile"))}
              </nav>
              <div className="border-t border-white/[0.06] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <CommunityLink />
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-3 text-sm font-semibold text-muted-foreground hover:text-destructive"
                >
                  <LogOut size={14} /> {t("auth.signOut")}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default AppSidebar;
