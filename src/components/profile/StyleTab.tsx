import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Coins, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatNumber } from "@/i18n/format";
import { RARITY_META, type Rarity } from "@/lib/rewards";
import {
  SELLABLE_TYPES,
  SLOT_BY_TYPE,
  TYPE_META,
  cosmeticColor,
  cosmeticLabel,
  useCosmetics,
  type CosmeticDef,
  type CosmeticType,
  type EquippedRow,
} from "@/lib/cosmetics";
import CoinTopUpSheet from "@/components/market/CoinTopUpSheet";
import { isAvailableNow } from "@/lib/cosmeticCatalog";

/** Rarity order for live-updating the 'Complete your profile' suggestion. */
const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary"];

interface StyleTabProps {
  /**
   * Opens the full shop. This used to open the in-page CosmeticShop sheet;
   * Profile now routes it to /collection — one catalogue, not two surfaces.
   * Deep flows (top-up → buy, per-slot deep link) live there too.
   */
  onOpenSheet: () => void;
}

/**
 * THE STYLE TAB
 *
 * A full tab in the Profile area, not a popup: profile-cosmetic shopping had been
 * buried behind a small "Cosmetics (N equipped)" button on the profile card,
 * which asks an athlete to want something before they can see any of it.
 * Shopping works the other way around — show the collection, the preview and
 * the prices, and want follows.
 *
 * Purchase psychology, and the line it does not cross. Every nudge here is
 * generated from the catalogue the athlete is already looking at, priced by
 * the server, and honest about what it is:
 *
 *   - Collection progress bar: 4/12 titles. Endowed progress — seeing how far
 *     you have come makes the remaining distance feel achievable, not
 *     pressure. The number is real (owned vs. sellable catalogue size).
 *   - “Complete your profile”: the cheapest unowned profile cosmetic for the
 *     slot you are browsing, with its real price. Status framing (“you have the
 *     title but not the background”) rendered as a plain product row — never any
 *     urgency mechanic, never a fake discount, never invented scarcity.
 *   - Trades in “look, don't lecture” honesty in both directions: the sheet's
 *     identity-only disclaimer still stands, and this surface has no
 *     urgency-of-any-kind (no expiring offers, no ticking clocks).
 *
 * Ratings of only one kind: the rarity chips are genuine rarity labels from
 * the same source that prices them.
 *
 * Disclaimers mirrored from the Shop sheet on purpose. When checkout opens
 * inside this tab, the same agreement the athlete already accepted for coins
 * applies here — the tab cannot claim a more permissive bargain than the sheet.
 */
export default function StyleTab({ onOpenSheet }: StyleTabProps) {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { defs, ownedIds, equipped, loading, buy, equip, unequip, equippedDefs } = useCosmetics();
  const [type, setType] = useState<CosmeticType>("title");
  const [busy, setBusy] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<{ gap: number; itemName: string } | null>(null);

  const coins = (profile as { coins?: number } | null)?.coins ?? 0;
  const sellable = useMemo(() => defs.filter((d) => SELLABLE_TYPES.includes(d.type)), [defs]);
  // Same availability rule as the Collection tab and the server's purchase RPC:
  // a seasonal item outside its window is not on sale here either.
  const visible = useMemo(
    () => sellable.filter((d) => d.type === type && isAvailableNow(d)),
    [sellable, type],
  );

  // Owned across the whole sellable catalogue — the progress bar's numerator.
  const ownedCount = useMemo(
    () => sellable.filter((d) => ownedIds.has(d.id)).length,
    [sellable, ownedIds],
  );

  // “Complete your profile”: the cheapest thing you don't own for the slot
  // you're browsing. Null when everything is already owned (progress bar says so).
  const suggested = useMemo(() => {
    const unowned = visible.filter((d) => !ownedIds.has(d.id) && d.coin_cost != null);
    if (unowned.length === 0) return null;
    return unowned.reduce((min, d) => (d.coin_cost! < min.coin_cost! ? d : min));
  }, [visible, ownedIds]);

  const slot = type as keyof EquippedRow;
  const equippedId = equipped[slot];

  const handleBuy = async (id: string, name: string, cost: number) => {
    if (coins < cost) {
      setTopUp({ gap: cost - coins, itemName: name });
      return;
    }
    setBusy(id);
    const { error } = await buy(id);
    setBusy(null);
    if (error) {
      toast({ title: "Purchase failed", description: error, variant: "destructive" });
      return;
    }
    await refreshProfile();
    toast({ title: `${name} unlocked` });
  };

  const handleEquip = async (id: string, name: string) => {
    setBusy(id);
    const { error } = await equip(id);
    setBusy(null);
    if (error) {
      toast({ title: "Could not equip", description: error, variant: "destructive" });
      return;
    }
    toast({ title: `${name} equipped` });
  };

  const handleUnequip = async () => {
    setBusy(slot);
    const { error } = await unequip(slot);
    setBusy(null);
    if (error) toast({ title: "Could not remove", description: error, variant: "destructive" });
    else if (!error) toast({ title: "Profile cosmetic removed" });
  };

  const rarityTier = (r: Rarity) => RARITY_ORDER.indexOf(r);

  return (
    <div className="px-5 pb-2">
      {/* ── Live look ──────────────────────────────────────────────────────── */}
      <div className="card-surface rounded-2xl border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your profile cosmetics</p>
            <div className="mt-2 space-y-1">
              {SELLABLE_TYPES.map((t) => {
                const key = t as keyof EquippedRow;
                const def = equippedDefs[key];
                return (
                  <div key={t} className="flex items-center gap-2 text-[12px]">
                    <span className="w-20 shrink-0 text-muted-foreground">{TYPE_META[t].label}</span>
                    {def ? (
                      <span className="font-semibold" style={cosmeticColor(def) ? { color: cosmeticColor(def)! } : undefined}>
                        {cosmeticLabel(def)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70">nothing equipped</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-energy/30 bg-energy/10 px-2.5 py-1 text-[12px] font-bold text-energy">
              <Coins size={11} /> {formatNumber(coins)}
            </span>
            <button
              type="button"
              onClick={onOpenSheet}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-primary"
            >
              <Sparkles size={11} /> Full shop
            </button>
            {/* the shop route keeps the deep flows: top-up → buy, per-slot deep link */}
          </div>
        </div>
      </div>

      {/* ── Collection progress ────────────────────────────────────────────── */}
      <div className="card-surface mt-3 rounded-2xl border border-border p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Collection</p>
          <p className="text-[12px] text-muted-foreground">
            {formatNumber(ownedCount)} of {formatNumber(sellable.length)} items owned
          </p>
        </div>    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-electric-purple transition-all"
            style={{ width: `${sellable.length ? Math.round((ownedCount / sellable.length) * 100) : 0}%` }}
          />
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {ownedCount === sellable.length
            ? "Everything on offer for this profile slot is already yours."
            : "Cosmetics are virtual items with no cash value, and they stay yours while your account is open."}
        </p>
        {/* The full Collection — seasonal sets, bundles and everything earned,
            none of which this per-slot browse shows. Without this link the tab
            was a dead end for anyone who wanted to see all of it. */}
        <button
          type="button"
          onClick={() => navigate("/collection")}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-primary"
        >
          Browse the full Collection
          <ArrowRight size={12} />
        </button>
      </div>

      {/* ── Slot tabs ──────────────────────────────────────────────────────── */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto no-scrollbar">
        {SELLABLE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-colors ${
              t === type ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {TYPE_META[t].label}
          </button>
        ))}
      </div>

      <p className="mb-3 mt-2 text-[12px] text-muted-foreground">{TYPE_META[type].blurb} — profile cosmetics only, bought with Coins.</p>

      {/* ── Complete the look ──────────────────────────────────────────────── */}
      {suggested && (
        <div className="mb-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Complete your profile</p>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <div className="min-w-0">                      <p className="text-sm font-semibold">{cosmeticLabel(suggested)}</p>
              <p className="text-[12px] text-muted-foreground">{suggested.description ?? suggested.category}</p>
            </div>
            <button
              type="button"
              onClick={() => handleBuy(suggested.id, cosmeticLabel(suggested), suggested.coin_cost ?? 0)}
              disabled={busy !== null}
              className="shrink-0 rounded-xl bg-energy px-4 py-2 text-[12px] font-bold text-background"
            >
              {busy === suggested.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <>
                  <Coins size={12} className="mr-1 inline" />
                  {formatNumber(suggested.coin_cost ?? 0)}
                </>
              )}
            </button>
          </div>
          <p className={`mt-1.5 text-[12px] ${coins < (suggested.coin_cost ?? 0) ? "text-energy" : "text-muted-foreground"}`}>
            {coins < (suggested.coin_cost ?? 0)
              ? `You need ${formatNumber((suggested.coin_cost ?? 0) - coins)} more Coins — one coin pack covers it.`
              : `One buy here unlocks that slot in your profile.`}
          </p>
        </div>
      )}

      {/* ── Item list ──────────────────────────────────────────────────────── */}
      {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
      {!loading && visible.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this slot yet.</p>
      )}

      <div className="space-y-2 pb-4">
        {visible.map((def: CosmeticDef) => {
          const meta = RARITY_META[def.rarity];
          const owned = ownedIds.has(def.id);
          const defSlot = SLOT_BY_TYPE[def.type] as keyof EquippedRow;
          const isEquipped = equipped[defSlot] === def.id;
          const color = cosmeticColor(def);
          const price = def.coin_cost;
          const isSuggested = suggested?.id === def.id;

          return (
            <div
              key={def.id}
              className={`relative flex items-center gap-3 rounded-2xl border p-3 ${meta.border} ${owned ? "" : "bg-card/40"} ${isSuggested ? "ring-1 ring-primary/40" : ""}`}
            >
              {isSuggested && (
                <span className="absolute -top-2 right-3 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  Cheapest here
                </span>
              )}              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[12px] font-black"
                style={{
                  background: meta.gradient,
                  color: color ?? "#fff",
                  ...(def.type === "border"
                    ? { boxShadow: `0 0 0 3px ${color ?? "#fff"}` }
                    : def.type === "background"
                      ? { background: color ?? meta.gradient }
                      : {}),
                }}
              >
                {def.type === "title"
                  ? cosmeticLabel(def).slice(0, 3)
                  : def.type === "name_color"
                    ? <span className="w-4 h-4 rounded-full" style={{ background: color ?? "#fff" }} />
                    : def.type === "background"
                      ? null
                      : def.type === "effect"
                        ? <Sparkles size={14} style={{ filter: color ? `drop-shadow(0 0 4px ${color})` : undefined }} />
                        : <Sparkles size={14} />
                }
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold" style={color ? { color } : undefined}>
                    {cosmeticLabel(def)}
                  </p>
                  <span className={`rounded-full px-1.5 py-0.5 text-[12px] font-bold uppercase ${meta.bg} ${meta.text}`}>
                    {meta.label}
                  </span>
                </div>
                <p className="truncate text-[12px] text-muted-foreground">{def.description ?? def.category}</p>
              </div>

              {isEquipped ? (
                <button
                  type="button"
                  onClick={handleUnequip}
                  disabled={busy !== null}
                  className="shrink-0 rounded-xl border border-border px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-muted-foreground disabled:opacity-60"
                >
                  {busy === defSlot ? <Loader2 size={12} className="animate-spin" /> : "Unequip"}
                </button>
              ) : owned ? (
                <button
                  type="button"
                  onClick={() => handleEquip(def.id, cosmeticLabel(def))}
                  disabled={busy !== null}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-60"
                >
                  {busy === def.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Equip
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBuy(def.id, cosmeticLabel(def), price ?? 0)}
                  disabled={busy !== null || !price}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-energy px-3 py-2 text-[12px] font-bold text-background disabled:opacity-40"
                >
                  {busy === def.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <>
                      <Coins size={12} /> {price != null ? formatNumber(price) : "—"}
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <CoinTopUpSheet open={topUp !== null} onClose={() => setTopUp(null)} gap={topUp?.gap ?? 0} itemName={topUp?.itemName} />
    </div>
  );
}
