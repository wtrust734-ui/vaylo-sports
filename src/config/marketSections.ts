import { Zap, Repeat, Infinity as InfinityIcon, UserRound, Coins, KeyRound } from "lucide-react";
import { isFlagOn } from "@/config/featureFlags";

/**
 * Market section definitions — data, not UI.
 *
 * Lived inside MarketSectionNav.tsx originally; the audit's lint pass flagged
 * the mixed exports (a component file exporting constants breaks react fast
 * refresh), and Market.tsx needs the same list for its own section guard, so
 * the source of truth belongs in config with the rest of the app's catalogues.
 */
export type MarketSection = "packs" | "unlocks" | "coins" | "subscriptions" | "lifetime" | "coaching";

export const MARKET_SECTIONS: { key: MarketSection; label: string; icon: typeof Zap; blurb: string }[] = [
  { key: "packs", label: "Credit Packs", icon: Zap, blurb: "Buy credits once. They never expire." },
  { key: "unlocks", label: "Unlocks", icon: KeyRound, blurb: "One credit payment, yours forever. Buy here — no need to hunt through tabs." },
  { key: "coins", label: "Coins", icon: Coins, blurb: "Coins buy avatar cosmetics only — never features. Bundles, or convert credits (1 credit = 7.5 Coins)." },
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
export const visibleMarketSections = () =>
  MARKET_SECTIONS.filter((s) => s.key !== "coaching" || isFlagOn("coachMarketplace"));
