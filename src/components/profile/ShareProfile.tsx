import { useMemo } from "react";
import { Medal, Star, Sparkles, Coins, Trophy, Copy, Check, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCosmetics } from "@/lib/cosmetics";
import { cosmeticLabel, cosmeticColor } from "@/lib/cosmetics";
import { RARITY_META } from "@/lib/rewards";
import { shareContent } from "@/lib/share";
import { cn } from "@/lib/utils";

/** A compact, shareable profile card: name, equipped cosmetics, trophies/badges, class flavor. */
export interface ProfileShareCardProps {
  className?: string;
  /** The public-facing trophy/achievement summary to show. */
  trophies: { total: number; recent?: { name: string; earned_at: string }[] };
  /** Optional class/tier label to make the status obvious. */
  tier?: { label: string; color?: string };
  actionLabel?: string;
  onCopyUrl?: () => void;
  /** If true, also offer a native share button; otherwise show copy/share as appropriate. */
  shareable?: boolean;
}

type EquippedLook = {
  title: { label: string; color: string | null } | null;
  border: { color: string | null } | null;
  badge: { label: string } | null;
  nameColor: { color: string | null } | null;
  background: { color: string | null } | null;
  effect: { color: string | null } | null;
};

export default function ProfileShareCard({
  className,
  trophies,
  tier,
  actionLabel = "Share my profile",
  onCopyUrl,
  shareable = false,
}: ProfileShareCardProps) {
  const { profile } = useAuth();
  const { equippedDefs } = useCosmetics();

  const name = profile?.full_name || "Athlete";
  const equipped: EquippedLook = useMemo(
    () => ({
      title: equippedDefs.title_id ? { label: cosmeticLabel(equippedDefs.title_id), color: cosmeticColor(equippedDefs.title_id) } : null,
      border: equippedDefs.border_id ? { color: cosmeticColor(equippedDefs.border_id) } : null,
      badge: equippedDefs.badge_id ? { label: cosmeticLabel(equippedDefs.badge_id) } : null,
      nameColor: equippedDefs.name_color_id ? { color: cosmeticColor(equippedDefs.name_color_id) } : null,
      background: equippedDefs.background_id ? { color: cosmeticColor(equippedDefs.background_id) } : null,
      effect: equippedDefs.effect_id ? { color: cosmeticColor(equippedDefs.effect_id) } : null,
    }),
    [equippedDefs],
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-card",
        tier?.color ? "ring-1 ring-inset ring-pill/40" : "ring-1 ring-inset ring-white/10",
        className,
      )}
      style={tier?.color ? ({ "--pill-color": tier.color } as React.CSSProperties) : undefined}
    >
      {/* Header strip: class tier, if present. */}
      {tier && (
        <div className="flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Trophy size={12} className="shrink-0 text-yellow-400" />
          <span className="truncate" style={tier.color ? { color: tier.color } : undefined}>{tier.label}</span>
        </div>
      )}

      {/* Identity block. */}
      <div className="mt-3 flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg font-black text-white/80",
            equipped.nameColor ? "border-white/20" : "bg-secondary",
          )}
          style={equipped.nameColor?.color ? { color: equipped.nameColor.color, borderColor: equipped.nameColor.color } : undefined}
        >
          {name.at(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold" style={equipped.nameColor?.color ? { color: equipped.nameColor.color } : undefined}>
              {name}
            </span>
            {equipped.title && (
              <span className="shrink-0 text-[11px] font-semibold" style={equipped.title.color ? { color: equipped.title.color } : undefined}>
                {equipped.title.label}
              </span>
            )}
          </div>
          {equipped.badge && (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-yellow-400">
              <Star size={10} /> {equipped.badge.label}
            </span>
          )}
        </div>
      </div>

      {/* Equipped cosmetics strip — visual proof of the look. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {equipped.background && (
          <span
            className="h-4 w-8 rounded overflow-hidden ring-1 ring-inset ring-white/10"
            style={{ background: equipped.background.color ?? RARITY_META.rare.gradient }}
          />
        )}
        {equipped.border && (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-inset ring-white/20"
            style={{ boxShadow: `inset 0 0 0 3px ${equipped.border.color ?? "#fff"}` }}
          />
        )}
        {equipped.title && (
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={equipped.title.color ? { color: equipped.title.color } : undefined}>
            {equipped.title.label}
          </span>
        )}
        {equipped.effect && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70">{equipped.effect.color ? "With effect" : "Effect"}</span>
        )}
        {(!equipped.title && !equipped.background && !equipped.border && !equipped.effect) && (
          <span className="rounded-full border border-border bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground">No cosmetics yet</span>
        )}
      </div>

      {/* Trophy count. */}
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/[0.03] p-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-electric-purple/20 text-electric-purple">
          <Medal size={14} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{trophies.total} {trophies.total === 1 ? "trophy" : "trophies"}</p>
          {trophies.recent?.[0] && (
            <p className="text-[11px] text-muted-foreground truncate">Latest: {trophies.recent[0].name}</p>
          )}
        </div>
      </div>

      {/* Action row. */}
      <div className="mt-3 flex items-center gap-2">
        {shareable && (
          <button
            type="button"
            onClick={() => {
              const text = shareableCardText({ name, equipped, trophies, tier });
              void shareContent({ title: "Vaylo Sports profile", text });
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground"
          >
            <Share2 size={12} /> Share
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onCopyUrl?.();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white/[0.04] px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <Copy size={12} /> Copy card
        </button>
      </div>
    </div>
  );
}

/** Plain-text card the share/copy action should use, so the recipient sees the same story. */
export function shareableCardText(opts: {
  name: string;
  equipped: EquippedLook;
  trophies: { total: number; recent?: { name: string; earned_at: string }[] };
  tier?: { label: string; color?: string };
}) {
  const { name, equipped, trophies, tier } = opts;
  const lines: string[] = [];
  lines.push("Vaylo Sports profile");
  lines.push(`Player: ${name}`);
  if (tier) lines.push(`Class: ${tier.label}`);
  if (equipped.title) lines.push(`Title: ${equipped.title.label}`);
  if (equipped.badge) lines.push(`Badge: ${equipped.badge.label}`);
  lines.push(`Trophies: ${trophies.total}${trophies.recent?.[0] ? ` (latest: ${trophies.recent[0].name})` : ""}`);
  const cosmetics = [
    equipped.title ? `Title: ${equipped.title.label}` : null,
    equipped.background ? "Background equipped" : null,
    equipped.border ? "Border equipped" : null,
    equipped.effect ? "Effect equipped" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (cosmetics) lines.push(`Look: ${cosmetics}`);
  lines.push("");
  lines.push("Show your own cosmetics and trophies in the app.");
  return lines.join("\n");
}
