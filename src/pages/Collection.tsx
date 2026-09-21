import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RARITY_META, RARITY_ORDER, type Rarity } from "@/lib/rewards";
import {
  SELLABLE_TYPES,
  SLOT_BY_TYPE,
  cosmeticColor,
  cosmeticLabel,
  useCosmetics,
  type CosmeticType,
  type EquippedRow,
} from "@/lib/cosmetics";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import CoinTopUpSheet from "@/components/market/CoinTopUpSheet";
import { Check, Coins, Gift, Loader2, Lock } from "lucide-react";

export default function Collection() {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { defs, ownedIds, equipped, loading, buy, equip, unequip } = useCosmetics();

  const [rarityFilter, setRarityFilter] = useState<Rarity | "all">("all");
  const [ownedFilter, setOwnedFilter] = useState<"all" | "owned" | "locked">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<{ gap: number; itemName: string } | null>(null);

  const credits = profile?.credits ?? 0;
  const coins = (profile as { coins?: number } | null)?.coins ?? 0;

  const categories = useMemo(() => {
    const s = new Set(defs.map((d) => d.category));
    return ["all", ...Array.from(s)];
  }, [defs]);

  const filtered = defs.filter((d) => {
    if (rarityFilter !== "all" && d.rarity !== rarityFilter) return false;
    if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
    const owned = ownedIds.has(d.id);
    if (ownedFilter === "owned" && !owned) return false;
    if (ownedFilter === "locked" && owned) return false;
    if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const totalCollected = defs.filter((d) => ownedIds.has(d.id)).length;
  const pct = defs.length ? Math.round((totalCollected / defs.length) * 100) : 0;

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

  const handleUnequip = async (slot: keyof EquippedRow) => {
    setBusy(slot);
    const { error } = await unequip(slot);
    setBusy(null);
    if (error) toast({ title: "Could not remove", description: error, variant: "destructive" });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Collection</h1>
        <p className="text-sm text-muted-foreground">
          {totalCollected} / {defs.length} collected · {pct}%
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Coins className="h-3.5 w-3.5 text-energy" />
          {coins.toLocaleString()} Coins · profile cosmetics are bought with Coins; badges are earned from chests and challenges.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-40" />
        <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value as Rarity | "all")} className="rounded-md border bg-background px-2 py-1 text-sm">
          <option value="all">All rarities</option>
          {RARITY_ORDER.map((r) => <option key={r} value={r}>{RARITY_META[r].label}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm">
          {categories.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
        </select>
        <select value={ownedFilter} onChange={(e) => setOwnedFilter(e.target.value as "all" | "owned" | "locked")} className="rounded-md border bg-background px-2 py-1 text-sm">
          <option value="all">Owned & locked</option>
          <option value="owned">Owned</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      {loading && <p className="text-center text-sm text-muted-foreground">Loading your collection…</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((d) => {
          const owned = ownedIds.has(d.id);
          const meta = RARITY_META[d.rarity];
          const now = new Date();
          const unavailable = (d.available_from && new Date(d.available_from) > now) || (d.available_to && new Date(d.available_to) < now);
          const sellable = (SELLABLE_TYPES as CosmeticType[]).includes(d.type as CosmeticType);
          const slot = sellable ? (SLOT_BY_TYPE[d.type as CosmeticType] as keyof EquippedRow) : null;
          const isEquipped = slot ? equipped[slot] === d.id : false;
          const color = cosmeticColor(d);
          const price = d.coin_cost;

          return (
            <Card key={d.id} className={`relative flex flex-col overflow-hidden border p-3 transition ${meta.border} ${owned ? "" : "opacity-80"}`}
              style={{ boxShadow: owned ? `0 0 24px ${meta.glow}` : undefined }}>
              <div className="mb-2 flex items-center justify-between">
                <Badge className={`${meta.bg} ${meta.text} ${meta.border} border`}>{meta.label}</Badge>
                {!owned && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <div className="mb-2 flex h-16 items-center justify-center rounded-md" style={{ background: meta.gradient, opacity: owned ? 1 : 0.4 }}>
                <Gift className="h-8 w-8" style={{ color: color ?? "#fff" }} />
              </div>
              <div className="text-sm font-semibold leading-tight" style={color ? { color } : undefined}>{d.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{sellable ? cosmeticLabel(d) : d.category}</div>
              {d.season && <div className="mt-1 text-xs italic text-amber-400">{d.season}</div>}
              {unavailable && <div className="mt-1 text-xs text-muted-foreground">Out of season</div>}

              <div className="mt-3">
                {isEquipped && slot ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => handleUnequip(slot)}
                  >
                    {busy === slot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Unequip"}
                  </Button>
                ) : owned && sellable ? (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => handleEquip(d.id, d.name)}
                  >
                    {busy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="mr-1 h-3.5 w-3.5" />Equip</>}
                  </Button>
                ) : owned ? (
                  <p className="text-center text-[11px] font-semibold text-muted-foreground">Owned</p>
                ) : sellable && price ? (
                  <Button
                    size="sm"
                    className="w-full bg-energy text-background hover:bg-energy/90"
                    disabled={busy !== null}
                    onClick={() => handleBuy(d.id, d.name, price)}
                  >
                    {busy === d.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <><Coins className="mr-1 h-3.5 w-3.5" />{price.toLocaleString()}</>
                    )}
                  </Button>
                ) : (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {sellable ? "Not for sale" : "Earn from chests"}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {!loading && filtered.length === 0 && <p className="text-center text-sm text-muted-foreground">No rewards match your filters.</p>}

      <CoinTopUpSheet
        open={topUp !== null}
        onClose={() => setTopUp(null)}
        gap={topUp?.gap ?? 0}
        itemName={topUp?.itemName}
      />
    </div>
  );
}
