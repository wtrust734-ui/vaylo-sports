import { useState } from "react";
import { Award, Flag, Share2, ShoppingBag, Trophy } from "lucide-react";
import { toast } from "sonner";

import AchievementShelf, { type ShelfItem } from "@/components/achievements/AchievementShelf";
import { PageHeader, PageShell, StatStrip } from "@/components/layout/PageShell";
import { useAchievementStats } from "@/hooks/useAchievementStats";
import { achievementShelf, marketShelf } from "@/lib/achievements";
import { shareWithInvite } from "@/lib/share";

// ============================================================================
// TROPHY ROOM — everything that is on the account, in one case
// ----------------------------------------------------------------------------
// The Achievements tab is the catalogue: every medal, earned or not, so an
// athlete can see what is left to do. This screen is the opposite view — only
// what has actually been written to the account, and everything that shows
// status: medals earned by training, what was bought from the Market, and the
// challenges that were finished. A trophy case is a trophy case whatever the
// trophy was earned by.
//
// There used to be a separate Badges screen for the purchased shelf. That split
// made "what do I own?" a navigation question — the answer was spread across
// three tabs and none of them was the case — so the Badges screen is gone and
// its shelf lives here, labelled by where it came from.
//
// Sharing is deliberately per item AND for the whole case. What an athlete
// wants to show off is a specific medal ("I finally got Centurion") or the
// collection, not a generic app link; both are one tap and both go through the
// app's share path, so a share doubles as a referral on the web.
//
// Both this screen and Achievements read the same catalogue and the same earned
// set through `useAchievementStats`, so a medal earned in one appears in the
// other on the next open, and neither can claim something the account does not
// hold.
// ============================================================================

const TrophyRoom = () => {
  const { earnedIds, completedChallenges } = useAchievementStats();
  const [sharing, setSharing] = useState(false);

  const achievements = achievementShelf();
  const market = marketShelf();
  const earnedAchievements = achievements.filter((item) => earnedIds.has(item.id));
  const ownedMarket = market.filter((item) => earnedIds.has(item.id));
  const total = earnedAchievements.length + ownedMarket.length + completedChallenges.length;

  const send = async (args: { title: string; text: string }) => {
    setSharing(true);
    try {
      const result = await shareWithInvite(args);
      if (result === "copied") {
        toast("Copied", { description: "Paste it wherever you want to share it." });
      } else if (result === "unsupported") {
        toast.error("Sharing isn't available here", {
          description: "Try again from the app, or a browser that supports sharing.",
        });
      }
    } finally {
      setSharing(false);
    }
  };

  const shareMedal = (item: ShelfItem) =>
    void send({
      title: "Vaylo Sports Trophy Room",
      text: `I earned “${item.title}” on Vaylo Sports — ${item.desc.toLowerCase()}.`,
    });

  const shareMarketItem = (item: ShelfItem) =>
    void send({
      title: "Vaylo Sports Trophy Room",
      text: `“${item.title}” is in my Vaylo Sports trophy room.`,
    });

  const shareChallenge = (title: string) =>
    void send({
      title: "Vaylo Sports Trophy Room",
      text: `I completed the “${title}” challenge on Vaylo Sports.`,
    });

  const shareRoom = () =>
    void send({
      title: "My Vaylo Sports Trophy Room",
      text: `My Vaylo Sports trophy room: ${earnedAchievements.length} medals, ${ownedMarket.length} trophies from the Market and ${completedChallenges.length} challenges finished.`,
    });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Perform"
        icon={Trophy}
        title="Trophy Room"
        subtitle="Everything that shows your status — medals you have earned, what you own from the Market, and the challenges you have finished."
        right={
          total > 0 ? (
            <button
              type="button"
              onClick={shareRoom}
              disabled={sharing}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
            >
              <Share2 size={14} aria-hidden /> Share
            </button>
          ) : null
        }
      />

      <div className="mb-5">
        <StatStrip
          items={[
            { value: earnedAchievements.length, label: "Medals", tone: "text-primary" },
            { value: ownedMarket.length, label: "Market", tone: "text-energy" },
            { value: completedChallenges.length, label: "Challenges", tone: "text-electric-purple" },
          ]}
        />
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border border-border bg-card/60 px-5 py-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Award size={24} className="text-primary" />
          </span>
          <h2 className="mt-3 font-display font-semibold">An empty case, for now</h2>
          <p className="mx-auto mt-1 max-w-[32ch] text-sm text-muted-foreground">
            Finish a workout, own something from the Market or complete a challenge — everything you
            unlock appears here, in the same case, for good.
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
              <AchievementShelf items={earnedAchievements} earnedIds={earnedIds} onShare={shareMedal} />
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
                <h2 className="font-display text-lg font-bold">Status &amp; ownership</h2>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {ownedMarket.length} of {market.length}
              </span>
            </div>
            {ownedMarket.length > 0 ? (
              <AchievementShelf items={ownedMarket} earnedIds={earnedIds} onShare={shareMarketItem} />
            ) : (
              <div className="flex items-start gap-2 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                <ShoppingBag size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  Nothing from the Market yet. Unlocks, subscriptions and packs you own appear here as
                  proof of status, for good.
                </span>
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Finished, not just joined
                </p>
                <h2 className="font-display text-lg font-bold">Challenges</h2>
              </div>
              <span className="text-[11px] text-muted-foreground">{completedChallenges.length}</span>
            </div>
            {completedChallenges.length > 0 ? (
              <ul className="space-y-2">
                {completedChallenges.map((challenge) => (
                  <li
                    key={challenge.id}
                    className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-energy/25 bg-energy/10">
                      <Flag size={15} className="text-energy" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{challenge.title}</p>
                      {challenge.description ? (
                        <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                          {challenge.description}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => shareChallenge(challenge.title)}
                      disabled={sharing}
                      aria-label={`Share ${challenge.title}`}
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
                    >
                      <Share2 size={12} aria-hidden /> Share
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No completed challenges yet — join one from the Challenges tab and finish it to put it
                in the case.
              </p>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
};

export default TrophyRoom;
