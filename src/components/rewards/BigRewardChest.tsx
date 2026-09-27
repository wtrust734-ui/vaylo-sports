import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Package, Gift, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RARITY_META, type ChestResponse, type Rarity } from "@/lib/rewards";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Stage = "idle" | "shaking" | "bursting" | "revealing" | "revealed";

interface Props {
  open: boolean;
  onClose: () => void;
  onClaimed?: (r: ChestResponse) => void;
}

export default function BigRewardChest({ open, onClose, onClaimed }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<ChestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) {
      setStage("idle"); setResult(null); setError(null);
    }
  }, [open]);

  const openChest = async () => {
    setError(null); setStage("shaking");
    // Haptics
    try { navigator.vibrate?.([30, 60, 30, 60, 200]); } catch { /* noop */ }
    // Premium chest opening sound (synth chime)
    try { playChime(); } catch { /* noop */ }

    // Fire request in parallel with shake animation for perceived responsiveness
    const [{ data, error: fnErr }] = await Promise.all([
      supabase.functions.invoke<ChestResponse>("open-chest"),
      wait(2000),
    ]);

    const payload = data as { ok?: boolean; error?: string } | null;
    if (fnErr || !data || !payload?.ok) {
      const msg = (fnErr as { message?: string } | null)?.message ?? payload?.error ?? "Failed to open chest";
      setError(msg); setStage("idle");
      toast.error(msg);
      return;
    }
    setResult(data);
    setStage("bursting");
    try { navigator.vibrate?.(400); } catch { /* noop */ }
    await wait(500);
    setStage("revealing");
    await wait(900);
    setStage("revealed");
  };

  const claim = () => {
    if (result) onClaimed?.(result);
    onClose();
  };

  if (!open) return null;
  const rarity: Rarity | undefined = result?.reward.rarity as Rarity | undefined;
  const meta = rarity ? RARITY_META[rarity] : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md"
      >
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Confetti for epic+ */}
        {stage === "revealed" && rarity && ["epic","legendary","mythic"].includes(rarity) && (
          <Confetti rarity={rarity} />
        )}

        <div className="relative flex w-full max-w-md flex-col items-center gap-6 px-6">
          {/* Chest */}
          {stage !== "revealed" && (
            <motion.div
              key="chest"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={
                stage === "shaking"
                  ? { scale: 1, opacity: 1, x: [0, -8, 8, -8, 8, -6, 6, -4, 4, 0], rotate: [0, -2, 2, -2, 2, 0] }
                  : stage === "bursting"
                  ? { scale: [1, 1.2, 1.1], opacity: 1 }
                  : { scale: 1, opacity: 1 }
              }
              transition={
                stage === "shaking"
                  ? { duration: 2, times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1] }
                  : { duration: 0.5 }
              }
              className="relative flex h-48 w-48 items-center justify-center"
            >
              {/* Glow */}
              <div
                className="absolute inset-0 rounded-full blur-3xl transition-opacity duration-1000"
                style={{
                  background: "radial-gradient(circle, rgba(251,191,36,0.65) 0%, rgba(251,191,36,0) 70%)",
                  opacity: stage === "idle" ? 0.4 : 1,
                }}
              />
              {/* Sparkles */}
              {stage !== "idle" && <FloatingSparkles />}
              {/* Chest body */}
              <div className="relative z-10 flex h-40 w-40 flex-col items-center justify-center rounded-2xl border-2 border-amber-400/70 bg-gradient-to-b from-amber-700 via-amber-800 to-amber-950 shadow-glow-energy-strong">
                <Package className="h-20 w-20 text-amber-200" strokeWidth={1.5} />
                <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 bg-amber-400/80" />
              </div>
            </motion.div>
          )}

          {/* Reward reveal */}
          {(stage === "revealing" || stage === "revealed") && result && meta && (
            <motion.div
              key="reward"
              initial={{ y: 120, opacity: 0, scale: 0.7 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 90, damping: 14 }}
              className="w-full"
            >
              <div
                className={`relative overflow-hidden rounded-2xl border-2 p-6 text-center ${meta.border}`}
                style={{
                  boxShadow: `0 0 60px ${meta.glow}`,
                  background: rarity === "mythic"
                    ? "linear-gradient(135deg,rgba(244,63,94,0.2),rgba(245,158,11,0.2),rgba(34,197,94,0.2),rgba(56,189,248,0.2),rgba(168,85,247,0.2))"
                    : "rgba(15,23,42,0.9)",
                }}
              >
                {rarity === "mythic" && (
                  <motion.div
                    className="absolute inset-0 opacity-30"
                    style={{ background: meta.gradient, backgroundSize: "400% 400%" }}
                    animate={{ backgroundPosition: ["0% 0%","100% 100%","0% 0%"] }}
                    transition={{ duration: 6, repeat: Infinity }}
                  />
                )}
                <div className="relative z-10">
                  <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${meta.bg} ${meta.text} ${meta.border} border`}>
                    <Sparkles className="h-3 w-3" /> {meta.label}
                  </div>
                  <div className="mt-4 flex justify-center">
                    <div
                      className="flex h-20 w-20 items-center justify-center rounded-2xl"
                      style={{ background: meta.gradient }}
                    >
                      <Gift className="h-10 w-10 text-white drop-shadow" />
                    </div>
                  </div>
                  <h3 className="mt-4 text-2xl font-bold text-white">{result.reward.name}</h3>
                  {result.reward.description && (
                    <p className="mt-1 text-sm text-white/70">{result.reward.description}</p>
                  )}
                  {result.duplicate && result.convertedCredits > 0 && (
                    <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      Duplicate reward — converted into <b>{result.convertedCredits} Credits</b>
                    </div>
                  )}
                  {!result.duplicate && result.creditsAwarded > 0 && (
                    <div className="mt-4 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                      +{result.creditsAwarded} Credits added to your balance
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* CTA */}
          {stage === "idle" && (
            <div className="text-center">
              <h2 className="mb-2 text-2xl font-bold text-white">Big Reward Chest</h2>
              <p className="mb-6 text-sm text-white/70">You made it — 7 days in a row. Open your reward.</p>
              <Button size="lg" onClick={openChest} className="min-w-48 bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:opacity-90">
                Open Chest
              </Button>
              {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
            </div>
          )}
          {stage === "revealed" && (
            <Button size="lg" onClick={claim} className="min-w-48">
              Claim Reward
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function FloatingSparkles() {
  const dots = Array.from({ length: 14 });
  return (
    <>
      {dots.map((_, i) => {
        const angle = (i / dots.length) * Math.PI * 2;
        const r = 60 + Math.random() * 40;
        return (
          <motion.div
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full bg-amber-200"
            initial={{ x: 0, y: 0, opacity: 0 }}
            animate={{
              x: Math.cos(angle) * r,
              y: Math.sin(angle) * r - 20,
              opacity: [0, 1, 0],
            }}
            transition={{ duration: 1.4 + Math.random(), repeat: Infinity, delay: i * 0.05 }}
            style={{ boxShadow: "0 0 8px rgba(251,191,36,0.9)" }}
          />
        );
      })}
    </>
  );
}

function Confetti({ rarity }: { rarity: Rarity }) {
  const colors = rarity === "mythic"
    ? ["#f43f5e","#f59e0b","#22c55e","#38bdf8","#a855f7"]
    : rarity === "legendary" ? ["#fbbf24","#f59e0b","#fef08a"]
    : ["#d946ef","#a855f7","#f0abfc"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 60 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute h-2 w-2"
          style={{ left: `${Math.random()*100}%`, background: colors[i % colors.length] }}
          initial={{ y: -30, opacity: 1, rotate: 0 }}
          animate={{ y: "100vh", opacity: [1,1,0], rotate: 720 }}
          transition={{ duration: 2.4 + Math.random()*1.5, delay: Math.random()*0.4, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simple WebAudio "chime" — avoids shipping an audio file
function playChime() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.5);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + i * 0.12);
    o.stop(ctx.currentTime + i * 0.12 + 0.55);
  });
  setTimeout(() => ctx.close(), 2000);
}
