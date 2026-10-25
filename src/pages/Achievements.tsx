import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Award, Sparkles } from "lucide-react";

import AchievementShelf from "@/components/achievements/AchievementShelf";
import { FilterChip, FilterRow, PageHeader, PageShell, StatStrip } from "@/components/layout/PageShell";
import { useAchievementStats } from "@/hooks/useAchievementStats";
import { achievementShelf, earnedIn, percentEarned } from "@/lib/achievements";

// ============================================================================
// ACHIEVEMENTS — the full cabinet: what you have earned AND what would earn it
// ----------------------------------------------------------------------------
// This screen showed only the medals already on the account. That made it a
// receipt rather than a set of goals: an athlete opening it for the first time
// saw an empty page with one sentence, and there was nowhere in the app they
// could find out that (say) forty workouts earns a medal. Achievements are a
// list of things you can do; the earned ones are the progress through it.
//
// It now renders the whole catalogue. An unearned row is dimmed but present,
// with the rule that earns it spelled out (`desc`), so the screen answers
// "what next?" as well as "what have I got?".
//
// The Trophy Room at /trophies is the other half of that idea: only the medals
// actually written to the account. Both read the same catalogue and the same
// earned set, so a medal cannot appear in one and not the other.
//
// Badges (purchases) and Challenges keep their own screens. The old `?tab=`
// links still redirect, because they were shared before the split.
// ============================================================================

const FILTERS = ["All", "Earned", "Locked"] as const;
type Filter = (typeof FILTERS)[number];

const Achievements = () => {
  const [searchParams] = useSearchParams();
  const legacyTab = searchParams.get("tab");

  if (legacyTab === "badges") return <Navigate to="/badges" replace />;
  if (legacyTab === "challenges") return <Navigate to="/challenges" replace />;

  return <AchievementsScreen />;
};

const AchievementsScreen = () => {
  const { earnedIds } = useAchievementStats();
  const [filter, setFilter] = useState<Filter>("All");

  const shelf = achievementShelf();
  const count = earnedIn(shelf, earnedIds);
  const shown = shelf.filter((achievement) => {
    const earned = earnedIds.has(achievement.id);
    if (filter === "Earned") return earned;
    if (filter === "Locked") return !earned;
    return true;
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Trophy Room"
        icon={Sparkles}
        title="Achievements"
        subtitle={`${shelf.length} medals, ${count} earned. Every locked medal names exactly what earns it.`}
      />

      <div className="mb-4">
        <StatStrip
          items={[
            { value: count, label: "Earned", tone: "text-primary" },
            { value: shelf.length, label: "Total", tone: "text-energy" },
            { value: `${percentEarned(count, shelf.length)}%`, label: "Complete", tone: "text-electric-purple" },
          ]}
        />
      </div>

      <FilterRow label="Filter achievements">
        {FILTERS.map((option) => (
          <FilterChip
            key={option}
            active={filter === option}
            onClick={() => setFilter(option)}
          >
            {option}
          </FilterChip>
        ))}
      </FilterRow>

      {shown.length > 0 ? (
        <AchievementShelf items={shown} earnedIds={earnedIds} />
      ) : (
        <div className="rounded-2xl border border-border bg-card/60 px-5 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Award size={22} className="text-primary" />
          </span>
          <h2 className="mt-3 font-display font-semibold">
            {filter === "Earned" ? "Nothing earned yet" : "Everything is earned"}
          </h2>
          <p className="mx-auto mt-1 max-w-[30ch] text-sm text-muted-foreground">
            {filter === "Earned"
              ? "Log a session, check in, or join a challenge — the first achievement appears here as soon as it is earned."
              : "Every medal in the catalogue is already on this account. Extraordinary."}
          </p>
        </div>
      )}
    </PageShell>
  );
};

export default Achievements;
