import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/platform";
import { useSponsoredPlacements, type SponsoredCard, type SponsoredPlacement } from "@/hooks/use-sponsored";

interface Props {
  placement: SponsoredPlacement;
  sport?: string | null;
  /** Layout wrapper, e.g. "px-5 mb-4". */
  className?: string;
}

/**
 * A sponsored card.
 *
 * Renders nothing at all — no empty state, no placeholder — when there is no
 * active sponsor or the athlete is not an adult, which is also the default for
 * every athlete whose date of birth is unknown. The disclosure label is not
 * optional: paid placement has to be obvious, and it comes from the placement
 * row so it can be tuned per deal without a deploy.
 */
export default function SponsoredSlot({ placement, sport, className }: Props) {
  const { placements, record } = useSponsoredPlacements(placement, sport);
  const counted = useRef<Set<string>>(new Set());

  // One impression per placement per mount.
  useEffect(() => {
    for (const item of placements) {
      if (counted.current.has(item.placement_id)) continue;
      counted.current.add(item.placement_id);
      record(item.placement_id, "impression");
    }
  }, [placements, record]);

  if (placements.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {placements.map((item) => (
        <SponsoredCardView
          key={item.placement_id}
          item={item}
          onOpen={() => record(item.placement_id, "click")}
        />
      ))}
    </div>
  );
}

function SponsoredCardView({ item, onOpen }: { item: SponsoredCard; onOpen: () => void }) {
  const label = item.disclosure_label?.trim() || "Sponsored";

  const open = () => {
    onOpen();
    if (item.cta_url) void openExternal(item.cta_url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card/70 p-4"
    >
      <div className="flex items-start gap-3">
        {item.brand_logo_url ? (
          <img
            src={item.brand_logo_url}
            alt=""
            className="h-10 w-10 shrink-0 rounded-xl border border-border object-contain bg-background"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-xl border border-border bg-background" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          {/* Required disclosure — the brand name is part of it, not decoration. */}
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {label} · {item.brand_name}
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug">{item.headline}</p>
          {item.body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>}

          {item.cta_label && item.cta_url && (
            <button
              type="button"
              onClick={open}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary/40"
            >
              {item.cta_label}
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
