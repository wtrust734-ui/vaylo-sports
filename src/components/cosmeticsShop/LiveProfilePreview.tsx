// ============================================================================
// LIVE PROFILE PREVIEW — the card that wears the look
// ----------------------------------------------------------------------------
// Extracted from the wardrobe screen so it can live anywhere (the shop, a
// share flow, an onboarding step) and so the try-on contract is explicit in
// its props rather than buried in screen state.
//
// What it renders, every pixel driven by item data — the card never
// special-cases an item id:
//
//   BACKDROP   paints the card: the item's gradient when it has one, else a
//              tinted surface from its colour, else the default card.
//   BORDER     rings both the card and the avatar frame; animated borders
//              (Neon Pulse, Rainbow Prism) pulse.
//   AVATAR     the athlete's photo when the caller passes one, initials
//              otherwise, framed by the equipped (or trying-on) border.
//   NAME       tinted by the equipped name colour; animated colours pulse.
//   TITLE      a rarity-coloured badge beside/below the name.
//   EFFECT     a corner sparkle layer, rarity-coloured, pulsing when
//              animated (Champion Aura, Gold Dust Trail).
//
// TRY-ON: pass `previewItem` and the card shows THAT item in its slot instead
// of the equipped one — display-only, touching neither ownership nor the
// store. This is the "tap to see it before you commit your coins" half of
// the shop; the caller owns the state and clears it via Cancel (rendered
// here) or by passing null.
// ============================================================================

import { Crown, Sparkles } from "lucide-react";

import { useCosmeticsShop } from "@/lib/cosmeticsShop/store";
import {
  RARITY_LADDER,
  type CosmeticCategory,
  type CosmeticItem,
} from "@/lib/cosmeticsShop/types";

export interface LiveProfilePreviewProps {
  athleteName: string;
  /** Profile picture URL when the caller has one; initials otherwise. */
  avatarUrl?: string | null;
  /** Try-on overlay: shown in its slot instead of the equipped item. */
  previewItem?: CosmeticItem | null;
  /** Called by the Cancel chip while try-on is active. */
  onCancelPreview?: () => void;
}

/** Resolve one slot: the trying-on item wins over the equipped one, display-only. */
const resolveSlot = (
  category: CosmeticCategory,
  equipped: Readonly<Record<CosmeticCategory, string | null>>,
  catalog: readonly CosmeticItem[],
  previewItem: CosmeticItem | null | undefined,
): CosmeticItem | undefined => {
  if (previewItem?.category === category) return previewItem;
  const id = equipped[category];
  return id ? catalog.find((i) => i.id === id) : undefined;
};

export default function LiveProfilePreview({
  athleteName,
  avatarUrl,
  previewItem,
  onCancelPreview,
}: LiveProfilePreviewProps) {
  const catalog = useCosmeticsShop((s) => s.catalog);
  const equipped = useCosmeticsShop((s) => s.equipped);

  const title = resolveSlot("titles", equipped, catalog, previewItem);
  const border = resolveSlot("borders", equipped, catalog, previewItem);
  const backdrop = resolveSlot("backdrops", equipped, catalog, previewItem);
  const nameColor = resolveSlot("nameColors", equipped, catalog, previewItem);
  const effect = resolveSlot("effects", equipped, catalog, previewItem);

  const initials = athleteName.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="relative overflow-hidden rounded-3xl border p-6 text-center"
      data-testid="live-preview"
      style={{
        background: backdrop?.style.gradient,
        backgroundColor: backdrop?.style.color ? `${backdrop.style.color}14` : undefined,
        borderColor: border?.style.color ? `${border.style.color}66` : undefined,
      }}
    >
      {border?.style.animated && (
        <div className="pointer-events-none absolute inset-0 animate-pulse rounded-3xl border-2" style={{ borderColor: border.style.color }} />
      )}

      {/* AVATAR FRAME — photo or initials, ringed by the equipped border. */}
      <div className="mx-auto h-16 w-16 overflow-hidden rounded-full border-2"
        style={{ borderColor: border?.style.color ?? "hsl(var(--border))" }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={`${athleteName}'s avatar`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/15 font-display text-xl font-bold text-primary">
            {initials}
          </div>
        )}
      </div>

      {/* NAME — tinted, and pulsing only when the colour itself is animated. */}
      <p className={`mt-3 font-display text-2xl font-bold ${nameColor?.style.animated ? "animate-pulse" : ""}`}
        style={nameColor?.style.color ? { color: nameColor.style.color } : undefined}
      >
        {athleteName}
      </p>

      {/* TITLE — rarity-coloured badge under the name. */}
      {title && (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
          style={{ color: RARITY_LADDER[title.rarity].color, borderColor: `${RARITY_LADDER[title.rarity].color}55` }}
        >
          <Crown size={11} /> {title.name}
        </span>
      )}

      {/* EFFECT LAYER — the corner sparkle, present whenever an effect is on. */}
      {effect && (
        <span className="pointer-events-none absolute right-4 top-4" aria-label={`Effect: ${effect.name}`}>
          <Sparkles size={20} className={effect.style.animated ? "animate-pulse" : ""} style={{ color: RARITY_LADDER[effect.rarity].color }} />
        </span>
      )}

      {/* TRY-ON STRIP — only while previewing; says what is being worn and
          how to stop wearing it. Nothing is owned or equipped by seeing this. */}
      {previewItem && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            Trying on {previewItem.name}
          </span>
          {onCancelPreview && (
            <button type="button" aria-label="Cancel preview" onClick={onCancelPreview}
              className="rounded-full border border-border px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {title?.name ?? "No title"} · {border?.name ?? "No border"} · {backdrop?.name ?? "No backdrop"}
      </p>
    </div>
  );
}
