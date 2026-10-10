import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Plus, X, Trophy, HeartPulse, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePersonalization } from "@/hooks/usePersonalization";
import type { FeatureKey } from "@/lib/personalization/features";

const ACTIONS = [
  { icon: Trophy, labelKey: "quickActions.logResult", descKey: "quickActions.logResultDesc", path: "/events", feature: "compete.events" as FeatureKey },
  { icon: HeartPulse, labelKey: "quickActions.recoveryCheckIn", descKey: "quickActions.recoveryCheckInDesc", path: "/recovery", feature: "recover.recovery" as FeatureKey },
  { icon: Pencil, labelKey: "quickActions.logMetric", descKey: "quickActions.logMetricDesc", path: "/vpr", feature: "perform.vpr" as FeatureKey },
] as const;

const QuickActionSheet = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const personalization = usePersonalization();
  const actions = personalization.visible([...ACTIONS]);

  const go = (path: string) => { setOpen(false); navigate(path); };

  // The sheet moves with transform only, on the house curve. Nothing here
  // animates height, top or margin, so opening it never triggers a layout pass
  // over the page underneath — which is what used to make the content behind
  // the sheet shift as it slid up. `will-transform` is toggled on only while it
  // is open: a permanent will-change would keep a compositor layer alive for
  // the whole session, and this component is mounted on every screen.
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
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className={`fixed inset-x-3 bottom-[calc(var(--vaylo-inset-bottom)+5.25rem)] z-[56] rounded-[22px] border border-white/[0.08] bg-card shadow-card overflow-hidden sm:bg-card/80 sm:backdrop-blur-2xl p-2 ${open ? "will-transform" : ""}`}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.07] via-transparent to-transparent" />
        <div className="relative">
        {actions.map((a) => (
          <button
            key={a.path}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => go(a.path)}
            className="press flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-start transition-colors hover:bg-white/[0.06] active:bg-white/[0.08]"
          >
            {/* Same tinted tile as every hub row — see the note in HubPage's
                HubTile. The sheet is open over any screen, so matching the rows
                behind it is what stops the app reading as two designs. */}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <a.icon size={17} className="text-primary" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold leading-tight">{t(a.labelKey)}</span>
              <span className="block text-[12px] text-muted-foreground leading-snug">{t(a.descKey)}</span>
            </span>
          </button>
        ))}
        </div>
      </motion.div>

      {/* The FAB.

          Alignment: the row centres its items, so a top margin on this button
          moves it by *half* the margin. `-mt-2` (8px) therefore puts its centre
          4px above the tab row's centre line — enough to read as "above",
          without the button leaving the surface it sits in. It is a flex
          sibling of the tab buttons, so it can never drift from them.

          It was `-mt-6`, which is three times that lift: 12px of centre
          offset, which also pushed the button's top edge outside the bar
          entirely. Measured in the release APK at 411x914, the button's box ran
          y816..873 against a bar at y822..891 — 6px proud of the top border,
          and 12px above the tab centres rather than the 4px this comment has
          always claimed.

          Elevation: `z-20` keeps it painted over the tab pill (which is z-auto
          inside the same stacking context) and `--vaylo-elev-fab` gives it a
          coloured halo rather than a card shadow, so its depth is legible as a
          *primary action* and not as another surface. */}
      <motion.button
        type="button"
        aria-label={open ? t("navigation.closeQuickActions") : t("navigation.openQuickActions")}
        aria-expanded={open}
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((o) => !o)}
        className="press relative z-20 -mt-2 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary border border-white/15"
        style={{ boxShadow: "var(--vaylo-elev-fab)" }}
      >
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.18 }}>
          {open ? <X size={22} className="text-primary-foreground" /> : <Plus size={24} className="text-primary-foreground" />}
        </motion.span>
      </motion.button>
    </>
  );
};

export default QuickActionSheet;
