import { Home, Dumbbell, Apple, Brain, User, Activity, Menu, X, LogOut, Zap, ShoppingBag, ScanLine, Gamepad2, Calendar, Users, MessageSquare, Moon, Package, Medal, Target, Swords, TrendingUp, Fingerprint, Flag, Shuffle, ShieldAlert, GraduationCap, BarChart3, Award, Eye, Sparkles, Crosshair, Rss, Flame, Timer, Gift, Store, Trophy } from "lucide-react";
import StreakBadge from "@/components/StreakBadge";
import NotificationBell from "@/components/NotificationBell";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatSports } from "@/lib/profile";
import logo from "@/assets/logo.jpg";

const navGroups: { title: string; items: { icon: any; label: string; path: string }[] }[] = [
  {
    title: "Overview",
    items: [
      { icon: Home, label: "Dashboard", path: "/" },
      { icon: BarChart3, label: "Metrics Hub", path: "/metrics" },
      { icon: Fingerprint, label: "Identity", path: "/identity" },
      { icon: Crosshair, label: "Goals", path: "/goals" },
      { icon: Rss, label: "Activity Feed", path: "/feed" },
      { icon: Trophy, label: "Leaderboard", path: "/leaderboard" },
      { icon: Flag, label: "Challenges", path: "/challenges" },
    ],
  },
  {
    title: "Performance",
    items: [
      { icon: Activity, label: "VPR", path: "/vpr" },
      { icon: Target, label: "Skills", path: "/skills" },
      { icon: Swords, label: "Tactics", path: "/tactics" },
      { icon: TrendingUp, label: "Development", path: "/development" },
    ],
  },
  {
    title: "Train",
    items: [
      { icon: Dumbbell, label: "Training", path: "/training" },
      { icon: Activity, label: "Workouts", path: "/workouts" },
      { icon: Shuffle, label: "Cross-Training", path: "/cross-training" },
      { icon: Timer, label: "Routines", path: "/routines" },
      { icon: Flame, label: "Personal Bests", path: "/pbs" },
      { icon: ScanLine, label: "Form Analysis", path: "/form" },
      { icon: Eye, label: "AR Overlay", path: "/ar-overlay" },
    ],
  },
  {
    title: "Recover",
    items: [
      { icon: Moon, label: "Recovery", path: "/recovery" },
      { icon: ShieldAlert, label: "Injury Mgmt", path: "/injury" },
      { icon: Apple, label: "Nutrition", path: "/nutrition" },
      { icon: Brain, label: "Mental Gym", path: "/mental" },
      { icon: Activity, label: "Google Fit", path: "/health-sync" },
    ],
  },
  {
    title: "Compete",
    items: [
      { icon: Swords, label: "Opponents", path: "/opponents" },
      { icon: Calendar, label: "Events", path: "/events" },
      { icon: Package, label: "Event Packs", path: "/event-packs" },
      { icon: Award, label: "Compare", path: "/compare" },
      { icon: Gamepad2, label: "Arcade", path: "/arcade" },
    ],
  },
  {
    title: "Grow",
    items: [
      { icon: MessageSquare, label: "Coach", path: "/coach" },
      { icon: GraduationCap, label: "Learning", path: "/learning" },
      { icon: Users, label: "Friends", path: "/friends" },
      { icon: Sparkles, label: "Communities", path: "/communities" },
      { icon: Medal, label: "Achievements", path: "/achievements" },
    ],
  },
  {
    title: "You",
    items: [
      { icon: Sparkles, label: "Avatar Studio", path: "/avatar" },
      { icon: Sparkles, label: "Collection", path: "/collection" },
      { icon: ShoppingBag, label: "Credits & Coins", path: "/market" },
      { icon: Award, label: "Subscription", path: "/subscription" },
      { icon: Store, label: "Creator Store", path: "/marketplace" },
      { icon: Gift, label: "Refer & Earn", path: "/referrals" },
      { icon: User, label: "Profile", path: "/profile" },
    ],
  },
];

const AppSidebar = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const handleNav = (path: string) => { navigate(path); setOpen(false); };
  const handleSignOut = async () => { await signOut(); setOpen(false); navigate("/auth"); };

  return (
    <>
      {/* calc + env keeps both fixed clusters below the notch / status bar on a
          device; env() is 0 in a browser, so desktop is unchanged. */}
      <button onClick={() => setOpen(true)} type="button" aria-label="Open menu"
        className="fixed top-[calc(env(safe-area-inset-top)+1rem)] left-4 z-50 p-2 rounded-xl bg-card/80 backdrop-blur border border-border hover:border-primary/30 transition-all duration-300">
        <Menu size={20} className="text-foreground" />
      </button>

      <div className="fixed top-[calc(env(safe-area-inset-top)+1rem)] right-4 z-50 flex items-center gap-2">
        <StreakBadge />
        <NotificationBell />
        <div className="flex items-center gap-1.5 bg-card/80 backdrop-blur border border-border rounded-full px-3 py-1.5">
          <Zap size={14} className="text-primary" />
          <span className="text-xs font-semibold text-primary">{profile?.credits ?? 0}</span>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-background/70 backdrop-blur-md z-50" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ x: "-100%", opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: "-100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="fixed left-0 top-0 bottom-0 w-72 bg-card/95 backdrop-blur-xl border-r border-border z-50 flex flex-col">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src={logo} alt="Vaylo Sports" className="w-8 h-8 rounded-lg" />
                  <span className="font-display font-bold text-lg text-gradient-electric">Vaylo Sports</span>
                </div>
                <motion.button onClick={() => setOpen(false)} type="button" aria-label="Close menu" className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  whileTap={{ scale: 0.9, rotate: 90 }}><X size={20} /></motion.button>
              </div>

              {profile?.full_name && (
                <motion.div className="px-5 py-4 border-b border-border" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
                  <p className="font-semibold text-sm">{profile.full_name}</p>
                  <p className="text-xs text-muted-foreground">{formatSports(profile.sport)} · {profile.experience_level}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Zap size={12} className="text-energy" />
                    <span className="text-xs font-semibold text-energy">{profile.credits} credits</span>
                  </div>
                </motion.div>
              )}

              <nav className="flex-1 py-3 px-3 overflow-y-auto">
                {navGroups.map((group, gi) => (
                  <div key={group.title} className={gi > 0 ? "mt-4" : ""}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 px-3 mb-1.5">{group.title}</p>
                    <div className="space-y-0.5">
                      {group.items.map((item, i) => {
                        const isActive = location.pathname === item.path;
                        return (
                          <motion.button key={item.path} onClick={() => handleNav(item.path)}
                            initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.02 * (gi * 4 + i), type: "spring", stiffness: 320, damping: 26 }}
                            whileHover={{ x: 3 }} whileTap={{ scale: 0.97 }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                            }`}>
                            <item.icon size={16} />
                            {item.label}
                            {isActive && (
                              <motion.div layoutId="sidebar-indicator" className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-glow"
                                transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              <div className="p-4 border-t border-border">
                <motion.button onClick={handleSignOut}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                  whileTap={{ scale: 0.97 }}>
                  <LogOut size={18} /> Sign Out
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default AppSidebar;
