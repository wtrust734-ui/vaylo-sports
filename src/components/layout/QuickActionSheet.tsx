import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Plus, X, Dumbbell, Trophy, HeartPulse, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ACTIONS = [
  { icon: Dumbbell, labelKey: "quickActions.logWorkout", descKey: "quickActions.logWorkoutDesc", path: "/workouts" },
  { icon: Trophy, labelKey: "quickActions.logResult", descKey: "quickActions.logResultDesc", path: "/events" },
  { icon: HeartPulse, labelKey: "quickActions.recoveryCheckIn", descKey: "quickActions.recoveryCheckInDesc", path: "/recovery" },
  { icon: Pencil, labelKey: "quickActions.logMetric", descKey: "quickActions.logMetricDesc", path: "/vpr" },
] as const;

const QuickActionSheet = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <>
      <motion.button
        type="button"
        aria-label={t("navigation.closeQuickActions")}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.18 }}
        onClick={() => setOpen(false)}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className="fixed inset-0 z-[55] bg-[#050612]/60 sm:backdrop-blur-sm"
      />

      <motion.div
        role="dialog"
        aria-label={t("navigation.quickActions")}
        aria-hidden={!open}
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: open ? 0 : 24, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-[56] rounded-[22px] border border-white/[0.08] bg-card shadow-card overflow-hidden sm:bg-card/80 sm:backdrop-blur-2xl p-2"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.07] via-transparent to-transparent" />
        <div className="relative">
        {ACTIONS.map((a) => (
          <button
            key={a.path}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => go(a.path)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-start transition-colors hover:bg-white/[0.06] active:bg-white/[0.08]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow border border-white/10">
              <a.icon size={17} className="text-primary-foreground" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold leading-tight">{t(a.labelKey)}</span>
              <span className="block text-[11px] text-muted-foreground leading-snug">{t(a.descKey)}</span>
            </span>
          </button>
        ))}
        </div>
      </motion.div>

      <motion.button
        type="button"
        aria-label={open ? t("navigation.closeQuickActions") : t("navigation.openQuickActions")}
        aria-expanded={open}
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((o) => !o)}
        className="relative -mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary shadow-electric border border-white/15"
      >
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.18 }}>
          {open ? <X size={22} className="text-primary-foreground" /> : <Plus size={24} className="text-primary-foreground" />}
        </motion.span>
      </motion.button>
    </>
  );
};

export default QuickActionSheet;
