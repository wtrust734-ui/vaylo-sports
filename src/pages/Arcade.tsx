import { useState, useCallback, useRef, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { Gamepad2, Zap, Eye, Brain, Timer, Target, Hand, ArrowUp, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { claimCreditReward, promoBonus } from "@/lib/credits";


const games = [
  { id: "reaction", icon: Zap, title: "Reaction Speed", desc: "Tap when the screen turns green", color: "text-energy", bg: "bg-energy/10" },
  { id: "sequence", icon: Brain, title: "Memory Sequence", desc: "Remember and repeat the pattern", color: "text-primary", bg: "bg-primary/10" },
  { id: "peripheral", icon: Eye, title: "Peripheral Vision", desc: "Spot targets at screen edges", color: "text-electric-glow", bg: "bg-electric/10" },
  { id: "timing", icon: Timer, title: "Rhythm Timing", desc: "Tap in sync with the beat", color: "text-primary", bg: "bg-primary/10" },
  { id: "accuracy", icon: Target, title: "Target Accuracy", desc: "Hit moving targets precisely", color: "text-energy", bg: "bg-energy/10" },
  { id: "coordination", icon: Hand, title: "Hand-Eye Drill", desc: "Track the moving object", color: "text-electric-glow", bg: "bg-electric/10" },
];

const BackButton = ({ onBack }: { onBack: () => void }) => (
  <motion.button onClick={() => onBack()} whileTap={{ scale: 0.9 }} className="text-muted-foreground"><ArrowUp size={20} className="rotate-[-90deg]" /></motion.button>
);


// === REACTION SPEED ===
const ReactionGame = ({ onBack }: { onBack: (score?: number) => void }) => {
  const [phase, setPhase] = useState<"waiting" | "ready" | "go" | "result" | "early">("waiting");
  const [startTime, setStartTime] = useState(0);
  const [reactionTime, setReactionTime] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const startRound = () => { setPhase("ready"); timeoutRef.current = window.setTimeout(() => { setPhase("go"); setStartTime(Date.now()); }, 1500 + Math.random() * 3000); };
  const handleTap = () => {
    if (phase === "waiting") { startRound(); return; }
    if (phase === "ready") { if (timeoutRef.current) clearTimeout(timeoutRef.current); setPhase("early"); return; }
    if (phase === "go") { const rt = Date.now() - startTime; setReactionTime(rt); if (!best || rt < best) setBest(rt); setPhase("result"); return; }
    startRound();
  };

  const bgClass = phase === "go" ? "bg-green-500" : phase === "ready" ? "bg-destructive" : phase === "early" ? "bg-energy" : "bg-card";
  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3"><BackButton onBack={() => onBack(best ?? undefined)} /><h1 className="text-xl font-display font-bold">Reaction Speed</h1></div>
      <motion.div onClick={handleTap} whileTap={{ scale: 0.98 }} className={`mx-5 rounded-2xl p-8 min-h-[300px] flex flex-col items-center justify-center cursor-pointer transition-colors duration-200 border border-border ${bgClass}`}>
        {phase === "waiting" && <p className="text-lg font-semibold text-center">Tap to start</p>}
        {phase === "ready" && <p className="text-lg font-semibold text-center text-destructive-foreground">Wait for green...</p>}
        {phase === "go" && <p className="text-2xl font-display font-bold text-center text-white">TAP NOW!</p>}
        {phase === "early" && <p className="text-lg font-semibold text-center">Too early! Tap to retry</p>}
        {phase === "result" && (<div className="text-center"><motion.p initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-4xl font-display font-bold text-primary">{reactionTime}ms</motion.p><p className="text-sm text-muted-foreground mt-2">Tap to try again</p>{best && <p className="text-xs text-primary mt-1">Best: {best}ms</p>}</div>)}
      </motion.div>
    </div>
  );
};

// === MEMORY SEQUENCE ===
const SequenceGame = ({ onBack }: { onBack: (score?: number) => void }) => {
  const [sequence, setSequence] = useState<number[]>([]);
  const [playerSeq, setPlayerSeq] = useState<number[]>([]);
  const [phase, setPhase] = useState<"showing" | "input" | "fail" | "idle">("idle");
  const [activeCell, setActiveCell] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  const showSequence = (seq: number[]) => {
    setPhase("showing"); setPlayerSeq([]);
    seq.forEach((cell, i) => { setTimeout(() => setActiveCell(cell), (i + 1) * 600); setTimeout(() => setActiveCell(null), (i + 1) * 600 + 400); });
    setTimeout(() => setPhase("input"), (seq.length + 1) * 600);
  };

  const startGame = () => { const first = [Math.floor(Math.random() * 9)]; setSequence(first); setScore(0); showSequence(first); };

  const handleCellTap = (i: number) => {
    if (phase !== "input") return;
    const next = [...playerSeq, i]; setPlayerSeq(next);
    setActiveCell(i); setTimeout(() => setActiveCell(null), 200);
    if (i !== sequence[next.length - 1]) { setPhase("fail"); return; }
    if (next.length === sequence.length) {
      setScore(s => s + 1);
      const newSeq = [...sequence, Math.floor(Math.random() * 9)]; setSequence(newSeq);
      setTimeout(() => showSequence(newSeq), 500);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3"><BackButton onBack={() => onBack(score)} /><h1 className="text-xl font-display font-bold">Memory Sequence</h1><span className="ml-auto text-sm font-bold text-primary">Score: {score}</span></div>
      <div className="px-5">
        <div className="grid grid-cols-3 gap-3 mb-5">{Array.from({ length: 9 }).map((_, i) => (
          <motion.button key={i} onClick={() => handleCellTap(i)} whileTap={{ scale: 0.9 }} className={`aspect-square rounded-xl border transition-all duration-200 ${activeCell === i ? "bg-primary border-primary shadow-glow" : "bg-card border-border"}`} />
        ))}</div>
        {phase === "idle" && <motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">Start Game</motion.button>}
        {phase === "showing" && <p className="text-center text-sm text-muted-foreground">Watch the pattern...</p>}
        {phase === "input" && <p className="text-center text-sm text-muted-foreground">Your turn!</p>}
        {phase === "fail" && (<div className="text-center"><p className="text-lg font-display font-bold text-destructive mb-2">Game Over! Score: {score}</p><motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">Play Again</motion.button></div>)}
      </div>
    </div>
  );
};

// === PERIPHERAL VISION ===
const PeripheralGame = ({ onBack }: { onBack: (score?: number) => void }) => {
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [targetPos, setTargetPos] = useState<{ x: number; y: number } | null>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [missed, setMissed] = useState(0);
  const maxRounds = 15;
  const timerRef = useRef<number | null>(null);

  const spawnTarget = () => {
    const edge = Math.floor(Math.random() * 4);
    let x: number, y: number;
    if (edge === 0) { x = Math.random() * 80 + 10; y = 5; }
    else if (edge === 1) { x = Math.random() * 80 + 10; y = 85; }
    else if (edge === 2) { x = 5; y = Math.random() * 60 + 20; }
    else { x = 90; y = Math.random() * 60 + 20; }
    setTargetPos({ x, y });
    timerRef.current = window.setTimeout(() => { setMissed(m => m + 1); nextRound(); }, 1500);
  };

  const nextRound = () => {
    setTargetPos(null);
    setRound(r => {
      if (r + 1 >= maxRounds) { setPhase("done"); return r + 1; }
      setTimeout(spawnTarget, 500 + Math.random() * 1000);
      return r + 1;
    });
  };

  const hitTarget = () => { if (timerRef.current) clearTimeout(timerRef.current); setScore(s => s + 1); nextRound(); };
  const startGame = () => { setPhase("playing"); setScore(0); setRound(0); setMissed(0); setTimeout(spawnTarget, 1000); };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3"><BackButton onBack={() => onBack(score)} /><h1 className="text-xl font-display font-bold">Peripheral Vision</h1><span className="ml-auto text-sm font-bold text-primary">{score}/{round}</span></div>
      <div className="px-5">
        <div className="relative bg-card border border-border rounded-2xl overflow-hidden" style={{ height: 350 }}>
          <div className="absolute inset-0 flex items-center justify-center"><div className="w-3 h-3 rounded-full bg-muted-foreground/30" /></div>
          {targetPos && (
            <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} onClick={hitTarget}
              className="absolute w-8 h-8 rounded-full bg-energy shadow-glow" style={{ left: `${targetPos.x}%`, top: `${targetPos.y}%`, transform: "translate(-50%,-50%)" }} />
          )}
        </div>
        {phase === "idle" && <motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-4">Start</motion.button>}
        {phase === "playing" && <p className="text-center text-sm text-muted-foreground mt-3">Focus on the center. Tap targets at the edges!</p>}
        {phase === "done" && (<div className="text-center mt-4"><p className="text-2xl font-display font-bold text-primary">{score}/{maxRounds}</p><p className="text-sm text-muted-foreground mb-3">Missed: {missed}</p><motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">Play Again</motion.button></div>)}
      </div>
    </div>
  );
};

// === RHYTHM TIMING ===
const TimingGame = ({ onBack }: { onBack: (score?: number) => void }) => {
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [beats, setBeats] = useState<number[]>([]);
  const [taps, setTaps] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [flash, setFlash] = useState(false);
  const bpm = 100;
  const totalBeats = 12;
  const intervalRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);

  const startGame = () => {
    setPhase("playing"); setTaps([]); setScore(0); setCurrentBeat(0);
    const beatTimes: number[] = [];
    startTimeRef.current = Date.now() + 1000;
    for (let i = 0; i < totalBeats; i++) beatTimes.push(startTimeRef.current + i * (60000 / bpm));
    setBeats(beatTimes);
    let i = 0;
    intervalRef.current = window.setInterval(() => {
      setFlash(true); setTimeout(() => setFlash(false), 100);
      setCurrentBeat(c => c + 1);
      i++;
      if (i >= totalBeats) { if (intervalRef.current) clearInterval(intervalRef.current); setTimeout(() => setPhase("done"), 500); }
    }, 60000 / bpm);
    setTimeout(() => {
      setFlash(true); setTimeout(() => setFlash(false), 100);
    }, 1000);
  };

  const handleTap = () => {
    if (phase !== "playing") return;
    const now = Date.now();
    setTaps(t => [...t, now]);
    const closest = beats.reduce((best, b) => Math.abs(b - now) < Math.abs(best - now) ? b : best, beats[0]);
    const diff = Math.abs(closest - now);
    if (diff < 150) setScore(s => s + 1);
  };

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3"><BackButton onBack={() => onBack(score)} /><h1 className="text-xl font-display font-bold">Rhythm Timing</h1></div>
      <div className="px-5">
        <motion.div onClick={handleTap} whileTap={{ scale: 0.95 }}
          className={`rounded-2xl p-8 min-h-[300px] flex flex-col items-center justify-center cursor-pointer border transition-colors duration-100 ${flash ? "bg-primary/20 border-primary" : "bg-card border-border"}`}>
          {phase === "idle" && <p className="text-lg font-semibold">Tap to start, then tap on each beat</p>}
          {phase === "playing" && (
            <div className="text-center">
              <motion.div animate={{ scale: flash ? 1.3 : 1 }} className="w-16 h-16 rounded-full bg-primary/20 border-2 border-primary mx-auto mb-4 flex items-center justify-center">
                <div className={`w-6 h-6 rounded-full ${flash ? "bg-primary" : "bg-primary/40"} transition-colors`} />
              </motion.div>
              <p className="text-sm text-muted-foreground">Beat {currentBeat}/{totalBeats}</p>
              <p className="text-xs text-primary mt-1">Tap on each flash!</p>
            </div>
          )}
          {phase === "done" && (
            <div className="text-center">
              <p className="text-3xl font-display font-bold text-primary">{score}/{totalBeats}</p>
              <p className="text-sm text-muted-foreground mt-2">beats hit</p>
            </div>
          )}
        </motion.div>
        {phase === "idle" && <motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-4">Start</motion.button>}
        {phase === "done" && <motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-4">Play Again</motion.button>}
      </div>
    </div>
  );
};

// === TARGET ACCURACY ===
const AccuracyGame = ({ onBack }: { onBack: (score?: number) => void }) => {
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const maxRounds = 20;

  const spawn = () => { setTarget({ x: 10 + Math.random() * 75, y: 10 + Math.random() * 75 }); };
  const startGame = () => { setPhase("playing"); setScore(0); setRound(0); spawn(); };
  const hitTarget = () => {
    setScore(s => s + 1);
    setRound(r => { if (r + 1 >= maxRounds) { setPhase("done"); setTarget(null); return r + 1; } return r + 1; });
    spawn();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3"><BackButton onBack={() => onBack(score)} /><h1 className="text-xl font-display font-bold">Target Accuracy</h1><span className="ml-auto text-sm font-bold text-primary">{score}/{round}</span></div>
      <div className="px-5">
        <div className="relative bg-card border border-border rounded-2xl overflow-hidden" style={{ height: 350 }}>
          {target && (
            <motion.button initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 0.2 }} onClick={hitTarget}
              className="absolute w-10 h-10 rounded-full bg-destructive/80 border-2 border-destructive flex items-center justify-center"
              style={{ left: `${target.x}%`, top: `${target.y}%`, transform: "translate(-50%,-50%)" }}>
              <Target size={16} className="text-white" />
            </motion.button>
          )}
        </div>
        {phase === "idle" && <motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-4">Start</motion.button>}
        {phase === "done" && (<div className="text-center mt-4"><p className="text-2xl font-display font-bold text-primary">{score}/{maxRounds}</p><motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-3">Play Again</motion.button></div>)}
      </div>
    </div>
  );
};

// === HAND-EYE COORDINATION ===
const CoordinationGame = ({ onBack }: { onBack: (score?: number) => void }) => {
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15);
  const intervalRef = useRef<number | null>(null);
  const moveRef = useRef<number | null>(null);

  const startGame = () => {
    setPhase("playing"); setScore(0); setTimeLeft(15);
    const move = () => {
      setPos(p => ({
        x: Math.max(10, Math.min(85, p.x + (Math.random() - 0.5) * 20)),
        y: Math.max(10, Math.min(85, p.y + (Math.random() - 0.5) * 20)),
      }));
      moveRef.current = window.setTimeout(move, 800);
    };
    move();
    intervalRef.current = window.setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { setPhase("done"); if (moveRef.current) clearTimeout(moveRef.current); if (intervalRef.current) clearInterval(intervalRef.current); return 0; } return t - 1; });
    }, 1000);
  };

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); if (moveRef.current) clearTimeout(moveRef.current); }; }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3"><BackButton onBack={() => onBack(score)} /><h1 className="text-xl font-display font-bold">Hand-Eye Drill</h1><span className="ml-auto text-sm font-bold text-primary">{timeLeft}s</span></div>
      <div className="px-5">
        <div className="relative bg-card border border-border rounded-2xl overflow-hidden" style={{ height: 350 }}>
          {phase === "playing" && (
            <motion.button animate={{ left: `${pos.x}%`, top: `${pos.y}%` }} transition={{ type: "spring", stiffness: 200, damping: 20 }}
              onClick={() => setScore(s => s + 1)}
              className="absolute w-12 h-12 rounded-full bg-primary/80 border-2 border-primary flex items-center justify-center" style={{ transform: "translate(-50%,-50%)" }}>
              <Hand size={18} className="text-white" />
            </motion.button>
          )}
        </div>
        {phase === "idle" && <motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-4">Start</motion.button>}
        {phase === "playing" && <p className="text-center text-sm text-muted-foreground mt-3">Score: {score}</p>}
        {phase === "done" && (<div className="text-center mt-4"><p className="text-2xl font-display font-bold text-primary">{score} taps</p><motion.button onClick={startGame} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-3">Play Again</motion.button></div>)}
      </div>
    </div>
  );
};

// World records per game — beat this to earn the configured arcade credit reward
const WORLD_RECORDS: Record<string, { threshold: number; betterIfLower: boolean; label: string }> = {
  reaction: { threshold: 150, betterIfLower: true, label: "≤150ms" },
  sequence: { threshold: 15, betterIfLower: false, label: "≥15 rounds" },
  peripheral: { threshold: 14, betterIfLower: false, label: "≥14 hits" },
  timing: { threshold: 11, betterIfLower: false, label: "≥11/12 beats" },
  accuracy: { threshold: 19, betterIfLower: false, label: "≥19/20 hits" },
  coordination: { threshold: 25, betterIfLower: false, label: "≥25 taps" },
};

const BEST_KEY = (uid: string, gameId: string) => `vaylo_arcade_best_${uid}_${gameId}`;

const Arcade = () => {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [bests, setBests] = useState<Record<string, number>>({});
  const gamesRef = useRef(null);
  const gamesInView = useInView(gamesRef, { once: true, margin: "-30px" });

  useEffect(() => {
    if (!user) return;
    const loaded: Record<string, number> = {};
    for (const id of Object.keys(WORLD_RECORDS)) {
      const v = localStorage.getItem(BEST_KEY(user.id, id));
      if (v) loaded[id] = Number(v);
    }
    setBests(loaded);
  }, [user]);

  const checkWorldRecord = useCallback(async (gameId: string, score: number) => {
    if (!user) return;
    const record = WORLD_RECORDS[gameId];
    if (!record) return;
    const meetsWR = record.betterIfLower ? score <= record.threshold : score >= record.threshold;
    if (!meetsWR) return;

    const prev = bests[gameId];
    const isNewBest = prev === undefined
      ? true
      : record.betterIfLower ? score < prev : score > prev;
    if (!isNewBest) return;

    localStorage.setItem(BEST_KEY(user.id, gameId), String(score));
    setBests(b => ({ ...b, [gameId]: score }));
    try {
      const res = await claimCreditReward("arcade_record", {
        reason: `Arcade record: ${gameId} (${score})`,
        idempotencyKey: `arcade:${gameId}:${score}`,
      });
      await refreshProfile();
      toast({ title: "🏆 New Record!", description: `+${res.granted || promoBonus("arcade_record")} credits — beat it again to earn more.` });
    } catch (e: any) {
      toast({ title: "Record set", description: "Couldn't award credits right now." });
    }
  }, [user, bests, refreshProfile, toast]);

  const backWithScore = (gameId: string) => (score?: number) => {
    if (score !== undefined) checkWorldRecord(gameId, score);
    setActiveGame(null);
  };

  if (activeGame === "reaction") return <ReactionGame onBack={backWithScore("reaction")} />;
  if (activeGame === "sequence") return <SequenceGame onBack={backWithScore("sequence")} />;
  if (activeGame === "peripheral") return <PeripheralGame onBack={backWithScore("peripheral")} />;
  if (activeGame === "timing") return <TimingGame onBack={backWithScore("timing")} />;
  if (activeGame === "accuracy") return <AccuracyGame onBack={backWithScore("accuracy")} />;
  if (activeGame === "coordination") return <CoordinationGame onBack={backWithScore("coordination")} />;

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">
          <Gamepad2 size={24} className="inline mr-2 text-primary" />Vaylo Arcade
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Train your brain, sharpen your game.</motion.p>
      </div>

      {/* World Record Info */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="mx-5 mb-4 bg-gradient-card border border-energy/20 rounded-xl p-3 flex items-center gap-3">
        <Trophy size={20} className="text-energy flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-energy">Every record = {promoBonus("arcade_record")} credits</p>
          <p className="text-[10px] text-muted-foreground">Beat the threshold and improve on it — a new personal best awards +{promoBonus("arcade_record")} credits each time.</p>
        </div>
      </motion.div>

      <div ref={gamesRef} className="px-5">
        <div className="grid grid-cols-2 gap-3 mb-8">
          {games.map((game, i) => {
            const wr = WORLD_RECORDS[game.id];
            const best = bests[game.id];
            return (
              <motion.button key={game.id} onClick={() => setActiveGame(game.id)}
                initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={gamesInView ? { opacity: 1, y: 0, scale: 1 } : {}}
                transition={{ delay: i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ scale: 1.05, y: -4 }} whileTap={{ scale: 0.95 }}
                className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/20 transition-colors duration-300">
                <div className={`p-2.5 rounded-xl ${game.bg} w-fit mb-3`}><game.icon size={22} className={game.color} /></div>
                <h4 className="font-semibold text-sm mb-1">{game.title}</h4>
                <p className="text-[11px] text-muted-foreground leading-tight">{game.desc}</p>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">WR: {wr?.label}</span>
                  {best !== undefined && <span className="text-energy font-semibold">Best: {best}</span>}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Arcade;

