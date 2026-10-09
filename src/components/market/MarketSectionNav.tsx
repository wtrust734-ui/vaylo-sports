import { motion } from "framer-motion";
import { Zap, Repeat, Infinity as InfinityIcon, UserRound, Coins, KeyRound } from "lucide-react";
import { isFlagOn } from "@/config/featureFlags";

export type MarketSection = "packs" | "unlocks" | "coins" | "subscriptions" | "lifetime" | "coaching";

export const MARKET_SECTIONS: { key: MarketSection; label: string; icon: typeof Zap; blurb: string }[] = [
  { key: "packs", label: "Credit Packs", icon: Zap, blurb: "Buy credits once. They never expire." },
  // Unlocks sit immediately after the credits they are bought with: the two are
  // halves of one transaction, and a shop that sells the currency on one tab and
  // the things it buys on four other screens is how a priced feature ends up
  // unbuyable.
  { key: "unlocks", label: "Unlocks", icon: KeyRound, blurb: "Spend credits on features that stay yours — no subscription, no renewal." },
  { key: "coins", label: "Coins", icon: Coins, blurb: "Coins for avatar cosmetics — bundles or convert credits (1 credit = 7.5 Coins)." },
  { key: "subscriptions", label: "Subscriptions", icon: Repeat, blurb: "Credits every month, or unlimited credits." },
  { key: "lifetime", label: "Lifetime", icon: InfinityIcon, blurb: "One payment. No renewal. Yours forever." },
  { key: "coaching", label: "Coaches", icon: UserRound, blurb: "Real coaches who set their own prices, and their plans." },
];

/**
 * The sections this build actually shows.
 *
 * The Coaching tab used to be listed unconditionally while its contents were
 * hidden behind the flag, which meant a switched-off feature showed up as an
 * EMPTY TAB — the worst of both states: the feature is not available, and the
 * screen looks broken rather than switched off. Filtering here makes the hidden
 * state look like the feature is not part of the shop, which is what it is.
 *
 * The active section is derived from the unfiltered list in Market.tsx, so this
 * cannot produce an undefined section even if a flag changes.
 */
const visibleMarketSections = () =>
  MARKET_SECTIONS.filter((s) => s.key !== "coaching" || isFlagOn("coachMarketplace"));

export default function MarketSectionNav({
  active,
  onChange,
}: {
  active: MarketSection;
  onChange: (s: MarketSection) => void;
}) {
  return (
    <div className="px-5">
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {visibleMarketSections().map((s) => {
          const Icon = s.icon;
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onChange(s.key)}
              className={`relative shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="market-section-pill"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-gradient-primary shadow-glow"
                />
              )}
              <Icon size={13} className="relative z-10" />
              <span className="relative z-10">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
