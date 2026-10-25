// ============================================================================
// ACHIEVEMENT SHELF — one shelf of medals, rendered
// ----------------------------------------------------------------------------
// The grid the Achievements screen and the Trophy Room both show. They differ
// only in the shelf they pass in — the medal cards themselves must look
// identical, because they are the same kind of thing: an id, an icon, a name and
// whether it has been earned.
//
// `earned` is driven by the ids actually written for this athlete, never by the
// rule that would earn it: a medal the rule says they qualify for but that has
// not been saved yet is not on their account, and showing it as earned would be
// the screen disagreeing with the database.
//
// `onShare` is optional on purpose. The Achievements screen is a catalogue —
// half of it is locked, and offering to share a medal you do not hold would be
// offering to share something that is not true. The Trophy Room passes it, and
// only earned cards grow the button.
// ============================================================================

import { motion } from "framer-motion";
import {
  Award, Brain, Crown, Droplets, Dumbbell, Flame, Heart, Medal,
  Share2, Shield, ShoppingBag, Star, Target, TrendingUp, Trophy, Zap, type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  star: Star, shield: Shield, crown: Crown, zap: Zap, target: Target, flame: Flame,
  trophy: Trophy, brain: Brain, shopping: ShoppingBag, dumbbell: Dumbbell,
  droplets: Droplets, medal: Medal, award: Award, heart: Heart, trending: TrendingUp,
};

export type ShelfItem = { id: string; title: string; desc: string; icon: string };

export default function AchievementShelf({
  items,
  earnedIds,
  onShare,
}: {
  items: ShelfItem[];
  earnedIds: Set<string>;
  /** When provided, every earned card gets a Share action. */
  onShare?: (item: ShelfItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-8">
      {items.map((ach, i) => {
        const earned = earnedIds.has(ach.id);
        const Icon = iconMap[ach.icon] || Trophy;
        return (
          <motion.div
            key={ach.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: Math.min(i * 0.02, 1), type: "spring", stiffness: 300, damping: 25 }}
            className={`flex flex-col rounded-xl p-3 text-center border transition-all duration-300 ${
              earned ? "bg-gradient-card border-primary/30 shadow-card" : "bg-card/50 border-border/50 opacity-60"
            }`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-1.5 ${earned ? "bg-primary/15" : "bg-muted/30"}`}>
              <Icon size={18} className={earned ? "text-primary" : "text-muted-foreground/50"} />
            </div>
            <h4 className="text-[13px] font-bold leading-tight">{ach.title}</h4>
            {/* 8px was unreadable on a phone, and it was the only place the
                earning rule was ever written down. The description IS the
                requirement, so it gets a legible size. */}
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{ach.desc}</p>
            <span className={`mt-1 block text-[10px] font-bold ${earned ? "text-primary" : "text-muted-foreground/60"}`}>
              {earned ? "✓ Earned" : "Locked"}
            </span>
            {onShare && earned ? (
              <button
                type="button"
                onClick={() => onShare(ach)}
                aria-label={`Share ${ach.title}`}
                className="mx-auto mt-2 inline-flex min-h-[36px] items-center justify-center gap-1 rounded-full border border-border px-3 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <Share2 size={11} aria-hidden /> Share
              </button>
            ) : null}
          </motion.div>
        );
      })}
    </div>
  );
}
