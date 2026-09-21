import { useRef, useState } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import CommandHero from "@/components/dashboard/CommandHero";
import PerformanceGrid from "@/components/dashboard/PerformanceGrid";
import DailyTrainingCard from "@/components/dashboard/DailyTrainingCard";
import QuickActions from "@/components/dashboard/QuickActions";
import WeeklySummary from "@/components/dashboard/WeeklySummary";
import MoodEnergyWidget from "@/components/dashboard/MoodEnergyWidget";
import DailyChallenges from "@/components/dashboard/DailyChallenges";
import DailyRewardsCard from "@/components/rewards/DailyRewardsCard";

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

const Index = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const bgOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0.3]);
  const [showExtras, setShowExtras] = useState(false);

  return (
    <div ref={ref} className="min-h-screen bg-background relative overflow-hidden pb-28">
      <motion.div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-electric-purple/10 blur-[160px] pointer-events-none"
        style={{ y: bgY, opacity: bgOpacity }} />
      <motion.div className="absolute top-40 right-0 w-[400px] h-[400px] rounded-full bg-primary/10 blur-[140px] pointer-events-none"
        style={{ y: bgY }} />

      <motion.div variants={stagger} initial="hidden" animate="visible" className="relative z-10">
        <motion.div variants={fadeUp}><CommandHero /></motion.div>
        <motion.div variants={fadeUp}><DailyTrainingCard /></motion.div>
        <motion.div variants={fadeUp}><PerformanceGrid /></motion.div>
        <motion.div variants={fadeUp}><QuickActions /></motion.div>

        {/* Secondary — collapsed by default to reduce clutter */}
        <motion.div variants={fadeUp} className="px-5 mt-6">
          <button
            onClick={() => setShowExtras(!showExtras)}
            className="w-full flex items-center justify-between py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{showExtras ? "Less" : "More for today"}</span>
            <motion.span animate={{ rotate: showExtras ? 180 : 0 }} className="flex items-center gap-1.5">
              {showExtras ? "Hide" : "Show"} <ChevronDown size={14} />
            </motion.span>
          </button>
        </motion.div>

        <AnimatePresence>
          {showExtras && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden relative z-10 space-y-0"
            >
              <motion.div variants={fadeUp} initial="hidden" animate="visible" className="pt-2"><WeeklySummary /></motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="visible"><MoodEnergyWidget /></motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="visible"><DailyChallenges /></motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="visible" className="px-4 pb-2"><DailyRewardsCard /></motion.div>
              <p className="px-5 py-3 text-[11px] text-muted-foreground text-center">Extras update daily · check in, take on a focus task, or claim your streak chest.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default Index;
