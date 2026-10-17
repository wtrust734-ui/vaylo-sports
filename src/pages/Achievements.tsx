import { Navigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";

import AchievementShelf from "@/components/achievements/AchievementShelf";
import EventTrophyCase from "@/components/achievements/EventTrophyCase";
import { useAchievementStats } from "@/hooks/useAchievementStats";
import { achievementShelf, earnedIn, percentEarned } from "@/lib/achievements";

// ============================================================================
// ACHIEVEMENTS — medals earned by training, and nothing else
// ----------------------------------------------------------------------------
// This screen used to be a three-way switch: Achievements, Badges and
// Challenges behind one heading, reached by `/achievements?tab=…`. Two problems
// came with that. The heading named a section the athlete was not looking at,
// and each section was reachable from the others — so "Achievements" was a door
// to a list of things you buy and a list of challenges, which are two entirely
// different things wearing the same frame.
//
// They are three screens now, one per tab, and no screen links to another from
// inside itself:
//
//   /achievements  this one — nothing here is bought, nothing here is a challenge
//   /badges        the purchase medals
//   /challenges    the live challenges, which already had its own screen
//
// The old `?tab=` links still resolve, as redirects, because they were shared
// and bookmarked before this change. A redirect is not the same screen: it
// leaves this page immediately for the right one.
// ============================================================================

const Achievements = () => {
  const [searchParams] = useSearchParams();
  const legacyTab = searchParams.get("tab");

  // Redirected before any data is fetched: the old link named a section that
  // lives on another screen, so the honest answer is to go there rather than to
  // render this screen's heading over somebody else's content.
  if (legacyTab === "badges") return <Navigate to="/badges" replace />;
  if (legacyTab === "challenges") return <Navigate to="/challenges" replace />;

  return <AchievementsScreen />;
};

/** The shelf, and the counts that go with it. Split so the redirect above can
 *  run without paying for the athlete's counts first. */
const AchievementsScreen = () => {
  const { earnedIds } = useAchievementStats();

  const shelf = achievementShelf();
  const cells = [
    { value: earnedIn(shelf, earnedIds), label: "Earned", tone: "text-primary" },
    { value: shelf.length, label: "Total", tone: "text-energy" },
    { value: `${percentEarned(earnedIn(shelf, earnedIds), shelf.length)}%`, label: "Complete", tone: "text-electric-purple" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">
          Achievements
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">
          Medals you earn by training. Nothing here is bought.
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
        <EventTrophyCase />
        <AchievementShelf items={shelf} earnedIds={earnedIds} />
      </div>
    </div>
  );
};

export default Achievements;
