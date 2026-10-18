// ============================================================================
// FLEX CARD MODAL — the celebration moment
// ----------------------------------------------------------------------------
// Hosts the FlexCard and the one button that matters: "Share to Friends".
// The card node is captured from inside this modal (html2canvas renders what
// is on screen, so the modal IS the capture surface — no hidden twin needed),
// and the outcome arrives as a ShareResult the athlete understands:
// shared / caption copied / nothing available here. A capture failure never
// blanks the moment: the caption path still runs (see flexShare.ts).
// ============================================================================

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Share2, X } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { flexCaption, shareFlexCard } from "@/lib/cosmeticsShop/flexShare";
import type { CosmeticItem } from "@/lib/cosmeticsShop/types";
import FlexCard from "./FlexCard";

export interface FlexCardModalProps {
  /** The unlocked item to celebrate; null hides the modal. */
  item: CosmeticItem | null;
  athleteName: string;
  streakDays?: number;
  level?: number;
  look?: { title?: string; border?: string; backdrop?: string };
  onClose: () => void;
}

export default function FlexCardModal({
  item,
  athleteName,
  streakDays,
  level,
  look,
  onClose,
}: FlexCardModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const { toast } = useToast();

  const handleShare = async () => {
    if (!item || !cardRef.current || sharing) return;
    setSharing(true);
    try {
      const result = await shareFlexCard(cardRef.current, flexCaption(item));
      if (result === "shared") toast({ title: "Shared!" });
      else if (result === "copied") toast({ title: "Caption copied — paste it anywhere" });
      else toast({ title: "Sharing isn't available here", description: "The card is saved in the app — try again from the APK or a browser.", variant: "destructive" });
    } catch {
      toast({ title: "Couldn't share", description: "Something blocked the share sheet.", variant: "destructive" });
    } finally {
      setSharing(false);
    }
  };

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[92] flex items-start justify-center overflow-y-auto bg-background/90 p-6 backdrop-blur-xl"
          role="dialog"
          aria-label={`Unlocked ${item.name}`}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 30 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="relative my-auto flex flex-col items-center gap-5"
          >
            <button
              type="button" onClick={onClose} aria-label="Close"
              className="absolute -right-2 -top-2 z-10 rounded-full border border-border bg-card p-2 text-muted-foreground hover:text-foreground"
            >
              <X size={16} />
            </button>

            {/* The card itself — and the capture surface. */}
            <div ref={cardRef}>
              <FlexCard item={item} athleteName={athleteName} streakDays={streakDays} level={level} look={look} />
            </div>

            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={sharing}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              {sharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
              Share to Friends
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
