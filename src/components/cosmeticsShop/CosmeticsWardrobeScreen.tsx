// ============================================================================
// COSMETICS WARDROBE — the interactive shop screen
// ----------------------------------------------------------------------------
// The screen the brief calls CosmeticsWardrobeScreen. NOTE ON THE STACK: the
// brief says "React Native" and StyleSheet/NativeWind; this app is React +
// Tailwind inside a Capacitor WebView (the same code serves web and the APK),
// so RN primitives would not drop in. Same architecture, real stack.
//
// Regions, top to bottom:
//
//   1. LIVE PROFILE PREVIEW — the extracted LiveProfilePreview component.
//      It wears the store's equipped map AND the try-on overlay, so it is
//      both the "what I have on" card and the "what would that look like"
//      mirror. Instant by construction: the preview subscribes to the store,
//      and `trying` is plain component state.
//
//   2. CATEGORY TAB BAR — the five profile-wearable categories (avatars are
//      worn in the Avatar Studio, not on this card, so they are not tabs).
//
//   3. ITEM GRID — filtered to the active category. Tapping ANY card —
//      owned or not — previews that item on the card above (the brief's
//      instant feedback); the contextual button then decides what owning it
//      means: Buy (with the ladder price and the shortfall when coins are
//      short), Equip, Equipped→tap to remove, "Earned, never sold" for
//      earn-only, "Off sale" outside a season window. Every result surfaces
//      as a toast.
//
// Preview-on-tap is display-only: it never touches ownership, balance or the
// equipped map, so a broke athlete can still see exactly what they are saving
// for. All money and ownership logic lives in the store; this file renders
// state and forwards intents.
// ============================================================================

import { useEffect, useState } from "react";
import { Coins, Trophy } from "lucide-react";

import { formatNumber } from "@/i18n/format";
import { useToast } from "@/hooks/use-toast";
import { useUnlockCelebration } from "@/hooks/useUnlockCelebration";
import { useCosmeticsShop, type ShopMode } from "@/lib/cosmeticsShop/store";
import {
  RARITY_LADDER,
  isAvailableNow,
  type CosmeticCategory,
  type CosmeticItem,
  type CosmeticRarity,
} from "@/lib/cosmeticsShop/types";
import LiveProfilePreview from "./LiveProfilePreview";
import FlexCardModal from "./FlexCardModal";
import { resolveIcon } from "./icons";

/** Rarity colour, from the ladder the store prices from. */
const rarityTextColor = (rarity: CosmeticRarity) => ({ color: RARITY_LADDER[rarity].color });

/** Mythic/legendary cards glow — rarity you can see from across the room. */
const rarityGlow = (rarity: CosmeticRarity): string =>
  rarity === "mythic"
    ? "shadow-[0_0_18px_rgba(244,114,182,0.35)] border-pink-400/50"
    : rarity === "legendary"
      ? "shadow-[0_0_14px_rgba(251,191,36,0.30)] border-amber-400/40"
      : "border-border";

/** The five categories this card can wear. Avatars live in the Studio. */
const TABS: { key: CosmeticCategory; label: string }[] = [
  { key: "titles", label: "Titles" },
  { key: "borders", label: "Borders" },
  { key: "backdrops", label: "Backdrops" },
  { key: "nameColors", label: "Name Colors" },
  { key: "effects", label: "Effects" },
];

// ---------------------------------------------------------------------------
// One grid card for one item. The card body is the try-on tap target; the
// action button stops propagation so Buy/Equip never also swap the preview.
// ---------------------------------------------------------------------------
const ItemCard = ({
  item, coins, owned, equippedId, active, onTap, onSuccess,
}: {
  item: CosmeticItem;
  coins: number;
  owned: boolean;
  equippedId: string | null;
  active: boolean; // this item is the current try-on
  onTap: () => void;
  /** Called after any successful buy/equip/unequip so the screen can settle UI state (e.g. clear a stale try-on). */
  onSuccess?: (itemId: string) => void;
}) => {
  const equipItem = useCosmeticsShop((s) => s.equipItem);
  const unequipItem = useCosmeticsShop((s) => s.unequipItem);
  const purchaseItem = useCosmeticsShop((s) => s.purchaseItem);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const Icon = resolveIcon(item.icon);
  const isEquipped = owned && equippedId === item.id;
  const onSale = isAvailableNow(item);
  const shortfall = item.priceCoins - coins;

  const act = async (fn: () => Promise<{ ok: boolean; message?: string } | { ok: true }>, okMsg: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast({ title: okMsg });
      onSuccess?.(item.id);
    } else {
      toast({ title: "Didn't work", description: "message" in res ? res.message : undefined, variant: "destructive" });
    }
  };

  // stopPropagation lives HERE, in the handlers — a click on the button
  // bubbles to the card's try-on tap unless it is stopped at the source.
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Preview ${item.name}`}
      onClick={onTap}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}
      className={`cursor-pointer rounded-2xl border bg-card p-4 transition-colors ${rarityGlow(item.rarity)} ${active ? "ring-2 ring-primary" : "hover:border-primary/40"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Icon size={18} style={rarityTextColor(item.rarity)} />
        </span>
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={rarityTextColor(item.rarity)}>
          {RARITY_LADDER[item.rarity].label}
        </span>
      </div>
      <p className="mt-3 truncate text-sm font-bold">{item.name}</p>
      <p className="mt-0.5 line-clamp-2 min-h-[2rem] text-[11px] text-muted-foreground">{item.description}</p>

      <div className="mt-3 min-h-[40px]" onClick={(e) => e.stopPropagation()}>
        {item.earnOnly ? (
          <span className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-primary/30 bg-primary/5 py-2 text-[12px] font-bold uppercase tracking-wider text-primary">
            <Trophy size={12} /> Earned, never sold
          </span>
        ) : !onSale ? (
          <span className="inline-flex w-full items-center justify-center rounded-xl border border-border py-2 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
            Off sale
          </span>
        ) : owned && isEquipped ? (
          <button
            type="button"
            aria-label={`Unequip ${item.name}`}
            disabled={busy}
            onClick={() => void act(() => unequipItem(item.category), `${item.name} removed`)}
            className="w-full rounded-xl bg-primary py-2 text-[12px] font-bold uppercase tracking-wider text-primary-foreground"
          >
            Equipped — tap to remove
          </button>
        ) : owned ? (
          <button
            type="button"
            aria-label={`Equip ${item.name}`}
            disabled={busy}
            onClick={() => void act(() => equipItem(item.id, item.category), `${item.name} equipped`)}
            className="w-full rounded-xl border border-primary/50 py-2 text-[12px] font-bold uppercase tracking-wider text-primary"
          >
            Equip
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[13px] font-bold text-energy">
              <Coins size={13} /> {formatNumber(item.priceCoins)}
            </span>
            <button
              type="button"
              aria-label={`Buy ${item.name}`}
              disabled={busy || shortfall > 0}
              onClick={() => void act(() => purchaseItem(item.id), `${item.name} unlocked`)}
              className="ml-auto rounded-xl bg-energy px-4 py-2 text-[12px] font-bold text-background disabled:opacity-50"
            >
              {shortfall > 0 ? `Need ${formatNumber(shortfall)}` : "Buy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------
export interface CosmeticsWardrobeScreenProps {
  /** Shown on the preview card; the shop itself does not own identity. */
  athleteName?: string;
  /** Profile picture for the preview frame; initials otherwise. */
  avatarUrl?: string | null;
  /** Passed through to the unlock celebration's flex card. */
  streakDays?: number;
  level?: number;
  /**
   * Store authority at mount. Production mounts MUST pass "server" — the
   * store defaults to "local" (demo/tests), and a prod screen left in local
   * mode would sell fictional items. Omit in tests and demos: the store keeps
   * whatever mode it already has.
   */
  mode?: ShopMode;
}

export default function CosmeticsWardrobeScreen({
  athleteName = "Athlete",
  avatarUrl,
  streakDays,
  level,
  mode,
}: CosmeticsWardrobeScreenProps) {
  const catalog = useCosmeticsShop((s) => s.catalog);
  const coins = useCosmeticsShop((s) => s.coins);
  const ownedItemIds = useCosmeticsShop((s) => s.ownedItemIds);
  const equipped = useCosmeticsShop((s) => s.equipped);
  const [active, setActive] = useState<CosmeticCategory>("titles");
  /** The item being tried on right now — display-only, cleared by Cancel. */
  const [trying, setTrying] = useState<CosmeticItem | null>(null);
  /** Epic+ unlocks celebrate automatically — the flex trigger, always armed. */
  const celebration = useUnlockCelebration();

  // Apply the authority mode exactly once at mount (see mode prop docs).
  useEffect(() => {
    if (mode) void useCosmeticsShop.getState().setMode(mode);
  }, [mode]);

  const items = catalog.filter((i) => i.category === active);

  const tapItem = (item: CosmeticItem) => setTrying((cur) => (cur?.id === item.id ? null : item));

  return (
    <div className="mx-auto max-w-2xl px-5 pb-10 pt-[var(--vaylo-screen-top)]">
      {/* Header: title + the live coin chip (no urgency copy anywhere). */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Cosmetics</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-energy/30 bg-energy/10 px-3 py-1 text-sm font-bold text-energy">
          <Coins size={14} /> {formatNumber(coins)}
        </span>
      </div>

      {/* Live preview — wears the equipped look plus the try-on overlay. */}
      <LiveProfilePreview
        athleteName={athleteName}
        avatarUrl={avatarUrl}
        previewItem={trying}
        onCancelPreview={() => setTrying(null)}
      />

      {/* Category tabs */}
      <div role="tablist" aria-label="Cosmetic categories" className="mt-5 flex gap-1 rounded-xl border border-border bg-card/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => { setActive(t.key); setTrying(null); }}
            className={`flex-1 rounded-lg py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Item grid, filtered to the active category. */}
      <div key={active} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" role="tabpanel" aria-label={TABS.find((t) => t.key === active)?.label}>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            coins={coins}
            owned={ownedItemIds.includes(item.id)}
            equippedId={equipped[item.category]}
            active={trying?.id === item.id}
            onTap={() => tapItem(item)}
            onSuccess={(id) => setTrying((cur) => (cur?.id === id ? null : cur))}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted-foreground">Nothing in this category yet.</p>
      )}

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Cosmetics are virtual items with no cash value, and they stay yours while your account is open.
      </p>

      {/* The automatic epic+ celebration: modal + flex card, wired to the
          same store the Buy button mutates. */}
      <FlexCardModal
        item={celebration.item}
        athleteName={athleteName}
        streakDays={streakDays}
        level={level}
        onClose={celebration.dismiss}
      />
    </div>
  );
}
