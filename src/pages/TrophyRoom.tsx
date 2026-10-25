import { Award, Trophy } from "lucide-react";

import AchievementShelf from "@/components/achievements/AchievementShelf";
import { PageHeader, PageShell, StatStrip } from "@/components/layout/PageShell";
import { useAchievementStats } from "@/hooks/useAchievementStats";
import { achievementShelf, badgeShelf, earnedIn, percentEarned } from "@/lib/achievements";

// ============================================================================
// TROPHY ROOM — what is actually on the account
// ----------------------------------------------------------------------------
// The Achievements tab is the catalogue: every medal, earned or not, so an
// athlete can see what is left to do. This screen is the opposite view — only
// the trophies that have been written to this account, achievements and badges
// together, because a trophy case is a trophy case whether the medal was earned
// by training or bought from the Market.
//
// They are deliberately two screens. One is a to-do list, the other is the
// shelf; merging them (the old `?tab=` arrangement) meant neither was good at
// its job. Both read the same catalogue and the same earned set through
// `useAchievementStats`, so a medal earned in one appears in the other on the
// next open, and neither can claim something the account does not hold.
// ============================================================================

const TrophyRoom = () => {
  const { earnedIds } = useAchievementStats();

  const achievements = achievementShelf();
  const badges = badgeShelf();
  const earnedAchievements = achievements.filter((item) => earnedIds.has(item.id));
  const earnedBadges = badges.filter((item) => earnedIds.has(item.id));
  const earned = earnedAchievements.length + earnedBadges.length;
  const total = achievements.length + badges.length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Perform"
        icon={Trophy}
        title="Trophy Room"
        subtitle="Everything on this account — every medal you have earned and every badge you own."
      />

      <div className="mb-5">
        <StatStrip
          items={[
            { value: earnedAchievements.length, label: "Medals", tone: "text-primary" },
            { value: earnedBadges.length, label: "Badges", tone: "text-energy" },
            { value: `${percentEarned(earned, total)}%`, label: "Collected", tone: "text-electric-purple" },
          ]}
        />
      </div>

      {earned === 0 ? (
        <div className="rounded-2xl border border-border bg-card/60 px-5 py-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Award size={24} className="text-primary" />
          </span>
          <h2 className="mt-3 font-display font-semibold">An empty case, for now</h2>
          <p className="mx-auto mt-1 max-w-[32ch] text-sm text-muted-foreground">
            Finish a workout to earn your first medal. Everything you unlock appears here, in the
            same case, for good.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Earned by training
                </p>
                <h2 className="font-display text-lg font-bold">Achievements</h2>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {earnedAchievements.length} of {achievements.length}
              </span>
            </div>
            {earnedAchievements.length > 0 ? (
              <AchievementShelf items={earnedAchievements} earnedIds={earnedIds} />
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No training medals yet — the Achievements tab lists exactly what earns them.
              </p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Owned from the Market
                </p>
                <h2 className="font-display text-lg font-bold">Badges</h2>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {earnedBadges.length} of {badges.length}
              </span>
            </div>
            {earnedBadges.length > 0 ? (
              <AchievementShelf items={earnedBadges} earnedIds={earnedIds} />
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No badges yet — badges are earned by owning features in the Market.
              </p>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
};

export default TrophyRoom;
