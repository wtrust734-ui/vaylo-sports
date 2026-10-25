import { Medal } from "lucide-react";

import AchievementShelf from "@/components/achievements/AchievementShelf";
import { PageHeader, PageShell, StatStrip } from "@/components/layout/PageShell";
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
// This is a screen of its own on purpose: what is here was bought, what is on
// Achievements was earned by training, and what is in the Trophy Room is both.
// The counters are the athlete's own: `Owned` is what is written to their
// account, not what the rule would award, so this screen never disagrees with
// the database about what they have.
// ============================================================================

const Badges = () => {
  const { earnedIds } = useAchievementStats();

  const shelf = badgeShelf();
  const owned = earnedIn(shelf, earnedIds);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Trophy Room"
        icon={Medal}
        title="Badges"
        subtitle="Earned from Market purchases — proof of what you own."
      />

      <div className="mb-5">
        <StatStrip
          items={[
            { value: owned, label: "Owned", tone: "text-primary" },
            { value: shelf.length, label: "Total", tone: "text-energy" },
            { value: `${percentEarned(owned, shelf.length)}%`, label: "Complete", tone: "text-electric-purple" },
          ]}
        />
      </div>

      <AchievementShelf items={shelf} earnedIds={earnedIds} />
    </PageShell>
  );
};

export default Badges;
