import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { shareWithInvite } from "@/lib/share";
import { cn } from "@/lib/utils";

/**
 * One-tap share for athlete moments (PBs, ranks, achievements).
 * Always shares through shareWithInvite, so the athlete's referral code rides
 * along and every share can convert an outsider into a referred signup.
 */
const ShareButton = ({
  title,
  text,
  className,
  label = "Share",
  compact = false,
}: {
  title: string;
  text: string;
  className?: string;
  label?: string;
  compact?: boolean;
}) => {
  const [done, setDone] = useState(false);

  const share = async () => {
    const result = await shareWithInvite({ title, text });
    if (result !== "unsupported") {
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    }
  };

  return (
    <button
      onClick={share}
      aria-label={`${label}: ${title}`}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 text-foreground transition-colors hover:bg-muted active:scale-95",
        compact ? "h-8 px-2.5 text-xs" : "h-10 px-4 text-sm font-semibold",
        done && "text-green-500 border-green-500/40 bg-green-500/10",
        className
      )}
    >
      {done ? <Check size={compact ? 13 : 15} /> : <Share2 size={compact ? 13 : 15} />}
      {!compact && <span>{done ? "Shared!" : label}</span>}
    </button>
  );
};

export default ShareButton;
