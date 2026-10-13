import { motion } from "framer-motion";

import AchievementShelf from "@/components/achievements/AchievementShelf";
import { useAchievementStats } from "@/hooks/useAchievementStats";
import { badgeShelf, earnedIn, percentEarned } from "@/lib/achievements";

// ============================================================================
// BADGES — the medals bought from the Market
// ----------------------------------------------------------------------------
// A badge is an achievement whose rule reads the athlete's purchases, and that
// is the only thing that separates them. They used to live as a filter of the
// Achievements shelf — one `?tab=badges` away, with the same three counters
// relabelled and the same grid underneath — which made two different ideas look
// like one screen with a switch on it.
//
// This is a screen of its own on purpose: what is here was bought, and what is
// on Achievements was earned by training. Those are worth two different visits,
// and an athlete who wants to see what they own should not have to walk past
// their medals to do it.
//
// The counters are the athlete's own: `Owned` is what is written to their
// account, not what the rule would award, so this screen never disagrees with
// the database about what they have.
// ============================================================================

const Badges = () => {
  const { earnedIds } = useAchievementStats();

  const shelf = badgeShelf();
  const cells = [
    { value: earnedIn(shelf, earnedIds), label: "Owned", tone: "text-primary" },
    { value: shelf.length, label: "Total", tone: "text-energy" },
    { value: `${percentEarned(earnedIn(shelf, earnedIds), shelf.length)}%`, label: "Complete", tone: "text-electric-purple" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">
          Badges
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">
          Earned from Market purchases — proof of what you own.
        </motion.p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-5 shadow-card">
        <div className="grid grid-cols-3 gap-3 text-center">
          {cells.map((cell, i) => (
            <div key={cell.label} className={i > 0 ? "border-s border-border" : undefined}>
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.1, type: "spring" }}
                className={`text-2xl font-display font-bold block ${cell.tone}`}>{cell.value}</motion.span>
              <p className="text-[12px] text-muted-foreground mt-0.5">{cell.label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <div className="px-5">
        <AchievementShelf items={shelf} earnedIds={earnedIds} />
      </div>
    </div>
  );
};

export default Badges;
