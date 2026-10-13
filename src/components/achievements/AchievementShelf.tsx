// ============================================================================
// ACHIEVEMENT SHELF — one shelf of medals, rendered
// ----------------------------------------------------------------------------
// The grid the Achievements screen and the Badges screen both show. They differ
// only in the shelf they pass in — the medal cards themselves must look
// identical, because they are the same kind of thing: an id, an icon, a name and
// whether it has been earned.
//
// `earned` is driven by the ids actually written for this athlete, never by the
// rule that would earn it: a medal the rule says they qualify for but that has
// not been saved yet is not on their account, and showing it as earned would be
// the screen disagreeing with the database.
// ============================================================================

import { motion } from "framer-motion";
import {
  Award, Brain, Crown, Droplets, Dumbbell, Flame, Heart, Medal,
  Shield, ShoppingBag, Star, Target, TrendingUp, Trophy, Zap, type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  star: Star, shield: Shield, crown: Crown, zap: Zap, target: Target, flame: Flame,
  trophy: Trophy, brain: Brain, shopping: ShoppingBag, dumbbell: Dumbbell,
  droplets: Droplets, medal: Medal, award: Award, heart: Heart, trending: TrendingUp,
};

export default function AchievementShelf({
  items,
  earnedIds,
}: {
  items: { id: string; title: string; desc: string; icon: string }[];
  earnedIds: Set<string>;
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
            className={`rounded-xl p-3 text-center border transition-all duration-300 ${
              earned ? "bg-gradient-card border-primary/30 shadow-card" : "bg-card/50 border-border/50 opacity-50"
            }`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-1.5 ${earned ? "bg-primary/15" : "bg-muted/30"}`}>
              <Icon size={18} className={earned ? "text-primary" : "text-muted-foreground/40"} />
            </div>
            <h4 className="text-[12px] font-bold">{ach.title}</h4>
            <p className="text-[8px] text-muted-foreground mt-0.5">{ach.desc}</p>
            {earned && <span className="text-[8px] text-primary font-bold">✓ Earned</span>}
          </motion.div>
        );
      })}
    </div>
  );
}
