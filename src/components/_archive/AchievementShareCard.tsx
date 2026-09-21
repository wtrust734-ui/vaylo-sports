import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import confetti from "canvas-confetti";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, Download, Copy, X, Twitter, Instagram, Check, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  achievement: { id: string; title: string; description?: string | null; icon?: string | null; earned_at?: string };
  firstUnlock?: boolean;
}

export default function AchievementShareCard({ open, onClose, achievement, firstUnlock }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const fireConfetti = () => {
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#a855f7", "#22d3ee", "#facc15"] });
  };

  if (firstUnlock && open) setTimeout(fireConfetti, 200);

  const trackShare = async () => {
    try {
      await (supabase as any).rpc("noop"); // placeholder no-op
    } catch {}
    await (supabase as any).from("achievements").update({ share_count: ((achievement as any).share_count ?? 0) + 1 }).eq("id", achievement.id);
  };

  const downloadCard = async () => {
    if (!cardRef.current) return;
    const canvas = await html2canvas(cardRef.current, { backgroundColor: null, scale: 2 });
    const link = document.createElement("a");
    link.download = `vaylo-${achievement.title.replace(/\s+/g, "-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    await trackShare();
    toast.success("Card saved");
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/achievements?ach=${achievement.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
    await trackShare();
  };

  const shareTo = async (target: "twitter" | "instagram") => {
    const url = `${window.location.origin}/achievements?ach=${achievement.id}`;
    const text = `Just unlocked "${achievement.title}" on Vaylo Sports!`;
    if (target === "twitter") {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
    } else {
      await downloadCard();
      toast.info("Card saved — paste it into your Instagram Story.");
    }
    await trackShare();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-md flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-sm w-full"
          >
            <button onClick={onClose} className="absolute -top-3 -right-3 z-10 h-8 w-8 rounded-full bg-card border border-border flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
            <div ref={cardRef} className="relative aspect-[4/5] rounded-3xl overflow-hidden bg-gradient-to-br from-electric-purple via-indigo-700 to-cyan-600 p-6 flex flex-col">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent_50%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(0,0,0,0.4),transparent_60%)]" />
              <div className="relative flex-1 flex flex-col items-center justify-center text-center text-white">
                <div className="h-24 w-24 rounded-full bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center mb-4 text-5xl">
                  {achievement.icon || "🏆"}
                </div>
                <p className="uppercase tracking-[0.2em] text-[10px] opacity-80 mb-1">Achievement Unlocked</p>
                <h3 className="text-2xl font-bold mb-2 leading-tight px-2">{achievement.title}</h3>
                {achievement.description && <p className="text-sm opacity-90 px-4">{achievement.description}</p>}
              </div>
              <div className="relative flex items-center justify-between text-white/90 text-xs">
                <div className="flex items-center gap-1.5"><Trophy className="h-3 w-3" /> Vaylo Sports</div>
                <span>{new Date(achievement.earned_at || Date.now()).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-4">
              <Button variant="outline" onClick={() => shareTo("twitter")} className="h-12"><Twitter className="h-4 w-4" /></Button>
              <Button variant="outline" onClick={() => shareTo("instagram")} className="h-12"><Instagram className="h-4 w-4" /></Button>
              <Button variant="outline" onClick={copyLink} className="h-12">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
              <Button onClick={downloadCard} className="h-12"><Download className="h-4 w-4" /></Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
