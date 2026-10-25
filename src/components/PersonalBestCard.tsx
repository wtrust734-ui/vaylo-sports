import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Share2, Trophy, X } from "lucide-react";
import { toast } from "sonner";

import { shareWithInvite } from "@/lib/share";

// ============================================================================
// PERSONAL BEST CARD — the moment after a PB is logged
// ----------------------------------------------------------------------------
// A personal best is worth more than a row quietly appearing on the wall: this
// is the card the athlete sees the instant they save one, and it carries the one
// action worth offering — send it to someone.
//
// The card is deliberately format-agnostic. A 5K time, a bench press and a
// pull-up count are all "what was your PB?", so this receives the parsed display
// string rather than re-deriving a value from three separate fields.
// ============================================================================

export interface PersonalBestCardData {
  metric: string;
  display: string;
  date: string;
  /** The previous best, in the same display form, when there was one. */
  previousDisplay: string | null;
}

export default function PersonalBestCard({
  card,
  onClose,
}: {
  card: PersonalBestCardData;
  onClose: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  const share = async () => {
    setSharing(true);
    try {
      const previous = card.previousDisplay ? ` Previous best: ${card.previousDisplay}.` : "";
      const result = await shareWithInvite({
        title: "New personal best",
        text: `🏆 New PB — ${card.metric}: ${card.display}.${previous} Logged on Vaylo Sports.`,
      });
      if (result === "copied") {
        toast.success("Copied — paste it to a friend.");
        setShared(true);
      } else if (result === "shared") {
        setShared(true);
      } else {
        toast.error("Sharing isn't available on this device.");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] bg-background/90 backdrop-blur-xl flex items-center justify-center p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`New personal best: ${card.metric} ${card.display}`}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.72, opacity: 0, y: 28 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 22 }}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-energy/40 bg-gradient-card p-6 text-center shadow-glow"
      >
        <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-energy/20 blur-3xl" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close personal best card"
          className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={18} />
        </button>

        <div className="relative">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-energy/30 bg-energy/10">
            <Trophy size={26} className="text-energy" />
          </div>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-energy">
            New personal best
          </p>
          <p className="mt-1 truncate text-sm font-medium text-muted-foreground">{card.metric}</p>
          <p className="mt-2 break-words font-display text-5xl font-bold leading-none text-primary tabular-nums">
            {card.display}
          </p>
          {card.previousDisplay && (
            <p className="mt-3 text-xs text-muted-foreground">
              Previous best: <span className="font-semibold text-foreground">{card.previousDisplay}</span>
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">{card.date}</p>

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={share}
              disabled={sharing}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              {shared ? <Check size={16} /> : <Share2 size={16} />}
              {sharing ? "Sharing…" : shared ? "Shared" : "Share with a friend"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Done
            </button>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Logged on Vaylo Sports · keep raising the bar.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
