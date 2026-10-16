import { motion } from "framer-motion";
// Section data lives in config (shared with Market.tsx's section guard); this
// file now exports ONLY the component, which is what react fast refresh wants.
import { visibleMarketSections, type MarketSection } from "@/config/marketSections";

export default function MarketSectionNav({
  active,
  onChange,
}: {
  active: MarketSection;
  onChange: (s: MarketSection) => void;
}) {
  return (
    <div className="px-5">
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
        {visibleMarketSections().map((s) => {
          const Icon = s.icon;
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onChange(s.key)}
              className={`press relative flex min-h-[48px] items-center gap-2 rounded-full px-4 py-3 text-base font-medium transition-colors ${
                isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {/* Larger min-h-[48px] ensures every section switch is a sure-tap action on phone; matches the app's touch-floor contract */}
              {isActive && (
                <motion.span
                  layoutId="market-section-pill"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-primary"
                />
              )}

              <Icon size={16} className="relative z-10 shrink-0" aria-hidden />
              <span className="relative z-10 whitespace-nowrap">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}