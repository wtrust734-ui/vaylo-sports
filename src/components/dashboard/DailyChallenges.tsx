import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Target } from "lucide-react";
import { lsGet, lsSet, isoDate } from "@/lib/localStore";
import { useAuth } from "@/contexts/AuthContext";

interface Challenge { id: string; title: string; done: boolean }

const SPORT_POOL: Record<string, string[]> = {
  running: ["Add a 20-min easy run", "Drills: A-skips ×3 sets", "Log resting HR before bed", "Hit 8k steps before lunch"],
  cycling: ["10 min spin warmup", "Log saddle hours", "3×3 min FTP intervals", "Cadence drill: 5×1 min @ 100rpm"],
  swimming: ["400m easy technique", "Log stroke count", "Kick set: 8×25m", "Bilateral breathing set"],
  football: ["10 min ball control work", "Log a tactical opponent note", "Sprint intervals: 6×30m", "20 min juggling / first touch"],
  basketball: ["100 spot-up shots", "Log a defensive read", "5×3 cone agility drill", "Free throws: 50 makes"],
  tennis: ["30 min baseline rally focus", "Serve set: 40 balls", "Footwork ladder: 5 rounds"],
  weightlifting: ["Log 1 heavy compound lift", "Warmup mobility 10 min", "Track RPE on top set"],
  gym: ["Log 1 heavy compound lift", "Add a 10-min core finisher", "Track RPE on top set"],
  boxing: ["3×3 min shadow boxing", "50 skips × 3 rounds", "Bag work: 5 rounds"],
  mma: ["3×3 min shadow", "Grappling drills 15 min", "Recovery mobility 10 min"],
  triathlon: ["Brick session: bike → run 10 min", "Open-water breathing drill", "Zone-2 base 30 min"],
  rugby: ["Contact prep mobility", "Sprint 6×20m", "Pass accuracy: 40 reps each side"],
  crossfit: ["Log a 15-min AMRAP", "Skill work 10 min", "Zone-2 row 15 min"],
};

const GOAL_POOL: Record<string, string[]> = {
  endurance: ["Zone-2 session 30 min", "Nasal-breath easy run 15 min", "Weekly long session +5 min"],
  strength: ["Add a heavy compound lift", "Grip work: 3×30s hang", "Accessory day: 4×8 posterior chain"],
  power: ["Broad jumps: 5×3", "Med-ball throws: 4×5", "Trap-bar jump set"],
  speed: ["Flying 20s: 4 reps", "Sprint mechanics drills 10 min", "Wickets or A-runs"],
  agility: ["5-10-5 shuttle × 6", "Reaction ladder 10 min", "Change-of-direction drill"],
  "fat loss": ["Hit protein target today", "Walk 8k steps", "Sub-500kcal deficit logged"],
  "muscle gain": ["Hit protein target today", "Log every set at prescribed RPE", "8h sleep priority"],
  mobility: ["10 min hips + t-spine flow", "Ankle dorsiflexion drill", "Nightly wind-down mobility"],
  flexibility: ["10 min PNF stretch", "Hamstring flow", "Long hold pose × 3 min"],
  "vo2 max": ["4×4 min hard @ 90% HRmax", "5×3 min hill efforts", "Track HR recovery"],
  "mental toughness": ["Mental gym check-in", "5-min visualisation", "Cold exposure 2 min"],
  recovery: ["Full recovery log", "10 min breath work", "Sleep in bed by 10:30 pm"],
};

const GENERIC_POOL = [
  "Complete a 10-minute mobility session",
  "Log every meal today",
  "Beat yesterday's step count",
  "Log a recovery check-in",
  "Hit 2L water before 6 PM",
  "Do 50 push-ups across the day",
  "Watch one Learning Hub lesson",
  "5-min box breathing before bed",
  "Prep tomorrow's kit tonight",
];

const LEVEL_MOD: Record<string, string[]> = {
  beginner: ["Take one guided lesson", "Focus on form over volume today"],
  intermediate: ["Add one accessory finisher", "Log RPE after main set"],
  advanced: ["Push top set +1 rep or +2.5kg", "Add negatives on final set"],
  elite: ["Track HRV before session", "Fine-tune split & pacing plan"],
};

const KEY = (d: string, uid: string) => `vaylo_challenges_${uid}_${d}`;

const pickPersonalized = (profile: any): string[] => {
  const sport = (profile?.sport || "").toLowerCase();
  const goals: string[] = (profile?.goals || []).map((g: string) => g.toLowerCase());
  const level = (profile?.experience_level || "").toLowerCase();

  const sportPool = Object.entries(SPORT_POOL).find(([k]) => sport.includes(k))?.[1] || [];
  const goalPool = goals.flatMap(g => Object.entries(GOAL_POOL).find(([k]) => g.includes(k))?.[1] || []);
  const levelPool = LEVEL_MOD[level] || [];

  const seed = new Date().getDate();
  const buckets = [sportPool, goalPool, levelPool.length ? levelPool : GENERIC_POOL];
  const picks: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < 3; i++) {
    const bucket = buckets[i].length ? buckets[i] : GENERIC_POOL;
    for (let j = 0; j < bucket.length; j++) {
      const cand = bucket[(seed * (i + 1) + j) % bucket.length];
      if (!seen.has(cand)) { picks.push(cand); seen.add(cand); break; }
    }
  }
  while (picks.length < 3) {
    const cand = GENERIC_POOL[(seed + picks.length) % GENERIC_POOL.length];
    if (!seen.has(cand)) { picks.push(cand); seen.add(cand); }
  }
  return picks;
};

const DailyChallenges = () => {
  const { user, profile } = useAuth();
  const today = isoDate();
  const [list, setList] = useState<Challenge[]>([]);

  const generated = useMemo(() => pickPersonalized(profile), [profile?.sport, profile?.goals, profile?.experience_level]);

  useEffect(() => {
    if (!user) return;
    const stored = lsGet<{ list: Challenge[] } | null>(KEY(today, user.id), null);
    if (stored?.list?.length) setList(stored.list);
    else setList(generated.map(t => ({ id: crypto.randomUUID(), title: t, done: false })));
  }, [today, user?.id, generated]);

  const save = (l: Challenge[]) => {
    setList(l);
    if (user) lsSet(KEY(today, user.id), { list: l });
  };

  const toggle = (id: string) => {
    save(list.map(c => c.id === id ? { ...c, done: !c.done } : c));
  };

  const doneCount = list.filter(c => c.done).length;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="mx-5 mb-4 bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5">
            <Sparkles size={11} /> Daily Focus · Personalised
          </p>
          <h3 className="font-display font-bold text-lg mt-0.5">{doneCount}/{list.length} complete</h3>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium bg-muted px-2 py-1 rounded-md">
          <Target size={12} /> Skill build
        </div>
      </div>
      <div className="space-y-2">
        {list.map(c => (
          <button key={c.id} onClick={() => toggle(c.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left text-sm transition-all ${
              c.done ? "bg-success/10 border-success/30 text-success line-through" : "bg-muted border-border hover:border-primary/30"
            }`}>
            <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${c.done ? "bg-success border-success" : "border-border"}`}>
              {c.done && <Check size={12} className="text-success-foreground" />}
            </div>
            {c.title}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">Resets at midnight · tuned to your sport, goals & level</p>
    </motion.div>
  );
};

export default DailyChallenges;
