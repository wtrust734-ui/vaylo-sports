import { motion } from "framer-motion";
import { Zap, Repeat, Infinity as InfinityIcon, UserRound, Coins } from "lucide-react";

export type MarketSection = "packs" | "coins" | "subscriptions" | "lifetime" | "coaching";

export const MARKET_SECTIONS: { key: MarketSection; label: string; icon: typeof Zap; blurb: string }[] = [
  { key: "packs", label: "Credit Packs", icon: Zap, blurb: "Buy credits once. They never expire." },
  { key: "coins", label: "Coins", icon: Coins, blurb: "Coins for avatar cosmetics — bundles or convert credits (1 credit = 7.5 Coins)." },
  { key: "subscriptions", label: "Subscriptions", icon: Repeat, blurb: "Credits every month, or unlimited credits." },
  { key: "lifetime", label: "Lifetime", icon: InfinityIcon, blurb: "One payment. No renewal. Yours forever." },
  { key: "coaching", label: "Coaching", icon: UserRound, blurb: "Book a real human coach, session by session." },
];

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
        {MARKET_SECTIONS.map((s) => {
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
