// ============================================================================
// marketSections — the Market's tabs, in one place
// ----------------------------------------------------------------------------
// Market.tsx renders one section at a time and MarketSectionNav switches between
// them, so the list (and the order) lives here instead of being duplicated in
// both files. A section whose feature flag is off is simply not offered: the
// nav never shows a tab that would render nothing.
// ============================================================================

import { Crown, CreditCard, Sparkles, Users, type LucideIcon } from "lucide-react";

import { isFlagOn } from "@/config/featureFlags";

export type MarketSection = "packs" | "subscriptions" | "lifetime" | "coaching";

export interface MarketSectionDef {
  key: MarketSection;
  label: string;
  icon: LucideIcon;
  /** One line under the nav explaining what the section contains. */
  blurb: string;
  /** When set, the section only appears while this feature flag is on. */
  requiresFlag?: Parameters<typeof isFlagOn>[0];
}

export const MARKET_SECTIONS: MarketSectionDef[] = [
  {
    key: "packs",
    label: "Credits",
    icon: Sparkles,
    blurb: "Credit packs for AI features. Every purchase shows its price and what it adds before you confirm.",
  },
  {
    key: "subscriptions",
    label: "Plans",
    icon: CreditCard,
    blurb: "Recurring plans with a monthly credit allowance. Cancel any time from your account.",
  },
  {
    key: "lifetime",
    label: "Lifetime",
    icon: Crown,
    blurb: "One payment, no renewal. Lifetime access keeps its benefits for as long as the app runs.",
  },
  {
    key: "coaching",
    label: "Coaches",
    icon: Users,
    blurb: "Sessions and plans from verified coaches. Coaches set their own prices.",
    requiresFlag: "coachMarketplace",
  },
];

/** The sections an athlete can actually reach right now. */
export function visibleMarketSections(): MarketSectionDef[] {
  return MARKET_SECTIONS.filter((s) => !s.requiresFlag || isFlagOn(s.requiresFlag));
}
