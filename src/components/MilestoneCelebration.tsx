import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, X, Volume2, VolumeX } from "lucide-react";
import { lsGet, lsSet } from "@/lib/localStore";
import { shareContent } from "@/lib/share";

export type MilestoneKey =
  | "first_workout" | "streak_7" | "workouts_50" | "first_pb" | "goal_reached";

const MESSAGES: Record<MilestoneKey, { title: string; sub: string; emoji: string }> = {
  first_workout: { title: "First Workout Logged", sub: "The hardest rep is the first one. You did it.", emoji: "💪" },
  streak_7: { title: "7-Day Streak", sub: "You showed up every single day. Momentum locked.", emoji: "🔥" },
  workouts_50: { title: "50 Workouts", sub: "Half a hundred sessions. You're rewriting your baseline.", emoji: "🏆" },
  first_pb: { title: "First Personal Best", sub: "A new ceiling. Now go shatter it.", emoji: "🚀" },
  goal_reached: { title: "Goal Reached", sub: "You said it. You shipped it.", emoji: "🎯" },
};

const SEEN_KEY = "vaylo_milestones_seen_v1";

export const triggerMilestone = (key: MilestoneKey) => {
  const seen = lsGet<string[]>(SEEN_KEY, []);
  if (seen.includes(key)) return;
  window.dispatchEvent(new CustomEvent("vaylo:milestone", { detail: key }));
};

const Confetti = () => (
  <>
    {Array.from({ length: 80 }).map((_, i) => {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.4;
      const dur = 1.6 + Math.random() * 1.4;
      const colors = ["bg-primary", "bg-electric-purple", "bg-energy", "bg-success"];
      const c = colors[i % colors.length];
      return (
        <motion.span key={i}
          initial={{ y: -20, x: `${left}vw`, opacity: 1, rotate: 0 }}
          animate={{ y: "110vh", rotate: 720 }}
          transition={{ delay, duration: dur, ease: "easeIn" }}
          className={`fixed top-0 w-2 h-3 ${c} rounded-sm z-[91] pointer-events-none`} />
      );
    })}
  </>
);

const MilestoneCelebration = () => {
  const [active, setActive] = useState<MilestoneKey | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const fn = (e: Event) => {
      const key = (e as CustomEvent).detail as MilestoneKey;
      setActive(key);
      const seen = lsGet<string[]>(SEEN_KEY, []);
      lsSet(SEEN_KEY, Array.from(new Set([...seen, key])));
      if (!muted) {
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.setValueAtTime(523, ctx.currentTime);
          o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
          g.gain.setValueAtTime(0.18, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          o.start(); o.stop(ctx.currentTime + 0.5);
        } catch {}
      }
    };
    window.addEventListener("vaylo:milestone", fn);
    return () => window.removeEventListener("vaylo:milestone", fn);
  }, [muted]);

  const share = async () => {
    if (!active) return;
    const m = MESSAGES[active];
    const text = `🏅 Vaylo Sports milestone: ${m.title}`;
    await shareContent({ title: m.title, text });
  };

  return (
    <AnimatePresence>
      {active && (
        <>
          <Confetti />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-background/90 backdrop-blur-xl flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.6, opacity: 0, y: 40 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 22 }}
              className="relative w-full max-w-md bg-gradient-card border border-primary/40 rounded-3xl p-8 text-center shadow-glow">
              <button onClick={() => setActive(null)} className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-foreground"><X size={18} /></button>
              <button onClick={() => setMuted(m => !m)} className="absolute top-3 left-3 p-2 text-muted-foreground hover:text-foreground">
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <div className="text-7xl">{MESSAGES[active].emoji}</div>
              <p className="text-[11px] uppercase tracking-widest text-primary font-semibold mt-3">Milestone</p>
              <h2 className="text-3xl font-display font-bold mt-1">{MESSAGES[active].title}</h2>
              <p className="text-sm text-muted-foreground mt-2">{MESSAGES[active].sub}</p>
              <button onClick={share}
                className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow">
                <Share2 size={16} /> Share milestone
              </button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MilestoneCelebration;
