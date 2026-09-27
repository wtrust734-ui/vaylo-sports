import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { shareActivity, unshareActivity, type ShareInput } from "@/lib/activitySharing";

interface Props {
  /** What to publish when tapped. */
  input: ShareInput;
  /** Whether this item is currently published. */
  shared: boolean;
  /** Called with the new state once the change has been persisted. */
  onToggle?: (shared: boolean) => void;
  className?: string;
}

/**
 * Publishes or withdraws a single activity. The athlete sees the result of the
 * write before the UI changes, so a failed share never looks like it worked.
 */
const ShareActivityButton = ({ input, shared, onToggle, className = "" }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [isShared, setIsShared] = useState(shared);

  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      if (isShared) {
        const { ok } = await unshareActivity({ kind: input.kind, sourceId: input.sourceId });
        if (!ok) {
          toast({ title: "Couldn't unshare", description: "Please try again.", variant: "destructive" });
          return;
        }
        setIsShared(false);
        onToggle?.(false);
        toast({ title: "Unshared", description: "Only you can see it now." });
      } else {
        const res = await shareActivity(input, user.id);
        if (!res.ok) {
          toast({ title: "Couldn't share", description: res.error, variant: "destructive" });
          return;
        }
        setIsShared(true);
        onToggle?.(true);
        toast({ title: "Shared to the feed", description: "Other athletes can hype it now." });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={isShared ? "Stop sharing this activity" : "Share this activity with other athletes"}
      className={`inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1 border transition-colors ${
        isShared
          ? "bg-primary/10 border-primary/40 text-primary"
          : "bg-muted hover:bg-primary/10 border-border hover:border-primary/40 text-muted-foreground"
      } ${busy ? "opacity-60 cursor-wait" : ""} ${className}`}
    >
      {isShared ? <Check size={12} /> : <Share2 size={12} />}
      {isShared ? "Shared" : "Share"}
    </button>
  );
};

export default ShareActivityButton;
