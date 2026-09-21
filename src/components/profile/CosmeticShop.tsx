import { useMemo, useState } from "react";
import { Check, Coins, Loader2, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { RARITY_META } from "@/lib/rewards";
import {
  SELLABLE_TYPES,
  SLOT_BY_TYPE,
  TYPE_META,
  cosmeticColor,
  cosmeticLabel,
  useCosmetics,
  type CosmeticType,
  type EquippedRow,
} from "@/lib/cosmetics";
import CoinTopUpSheet from "@/components/market/CoinTopUpSheet";
import BottomSheet from "@/components/ui/bottom-sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Restrict the shop to one slot (used from the Profile header). */
  initialType?: CosmeticType;
}

/**
 * Profile cosmetics: buy with Coins, equip, unequip. Badges are shown but not
 * sold — they are earned.
 *
 * Purchasing/equipping goes through the same RPCs as before
 * (`purchase_cosmetic`, `equip_cosmetic`, `unequip_cosmetic`) — only the shell
 * changed here, to the shared bottom sheet.
 */
export default function CosmeticShop({ open, onClose, initialType = "title" }: Props) {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { defs, ownedIds, equipped, loading, buy, equip, unequip } = useCosmetics();
  const [type, setType] = useState<CosmeticType>(initialType);
  const [busy, setBusy] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<{ gap: number; itemName: string } | null>(null);

  const coins = (profile as { coins?: number } | null)?.coins ?? 0;

  const visible = useMemo(() => defs.filter((d) => d.type === type), [defs, type]);

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
    toast({ title: `${name} unlocked`, description: "Equip it from your collection." });
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

  const handleUnequip = async (slot: keyof EquippedRow) => {
    setBusy(slot);
    const { error } = await unequip(slot);
    setBusy(null);
    if (error) toast({ title: "Could not remove", description: error, variant: "destructive" });
  };

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        size="lg"
        title="Profile cosmetics"
        subtitle="Identity only — nothing here changes your training."
        headerRight={
          <span className="flex items-center gap-1 self-center rounded-full border border-energy/30 bg-energy/10 px-2.5 py-1 text-[11px] font-bold text-energy">
            <Coins size={11} /> {coins.toLocaleString()}
          </span>
        }
        toolbar={
          <div className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-3 no-scrollbar">
            {SELLABLE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  t === type
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {TYPE_META[t].label}
              </button>
            ))}
          </div>
        }
      >
        <p className="pb-2 text-[11px] text-muted-foreground">{TYPE_META[type].blurb}</p>
        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {!loading && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this slot yet.</p>
        )}

        <div className="space-y-2">
          {visible.map((def) => {
            const meta = RARITY_META[def.rarity];
            const owned = ownedIds.has(def.id);
            const slot = SLOT_BY_TYPE[def.type] as keyof EquippedRow;
            const isEquipped = equipped[slot] === def.id;
            const color = cosmeticColor(def);
            const price = def.coin_cost;

            return (
              <div
                key={def.id}
                className={`flex items-center gap-3 rounded-2xl border p-3 ${meta.border} ${owned ? "" : "bg-card/40"}`}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-black"
                  style={{ background: meta.gradient, color: color ?? "#fff" }}
                >
                  {def.type === "title" ? cosmeticLabel(def).slice(0, 3) : <Lock size={14} />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold" style={color ? { color } : undefined}>
                      {cosmeticLabel(def)}
                    </p>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${meta.bg} ${meta.text}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{def.description ?? def.category}</p>
                </div>

                {isEquipped ? (
                  <button
                    type="button"
                    onClick={() => handleUnequip(slot)}
                    disabled={busy !== null}
                    className="shrink-0 rounded-xl border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground disabled:opacity-60"
                  >
                    {busy === slot ? <Loader2 size={12} className="animate-spin" /> : "Unequip"}
                  </button>
                ) : owned ? (
                  <button
                    type="button"
                    onClick={() => handleEquip(def.id, cosmeticLabel(def))}
                    disabled={busy !== null}
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-60"
                  >
                    {busy === def.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Equip
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuy(def.id, cosmeticLabel(def), price ?? 0)}
                    disabled={busy !== null || !price}
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-energy px-3 py-2 text-[11px] font-bold text-background disabled:opacity-40"
                  >
                    {busy === def.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <>
                        <Coins size={12} /> {price?.toLocaleString() ?? "—"}
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </BottomSheet>

      {/* Shortfall top-up, so a locked cosmetic always has a way forward. */}
      <CoinTopUpSheet
        open={topUp !== null}
        onClose={() => setTopUp(null)}
        gap={topUp?.gap ?? 0}
        itemName={topUp?.itemName}
      />
    </>
  );
}
