import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/i18n/format";
import { RARITY_META } from "@/lib/rewards";
import {
  SELLABLE_TYPES,
  SLOT_BY_TYPE,
  TYPE_META,
  cosmeticColor,
  cosmeticLabel,
  isAnimated,
  useCosmetics,
  type CosmeticDef,
  type CosmeticType,
  type EquippedRow,
} from "@/lib/cosmetics";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import CoinTopUpSheet from "@/components/market/CoinTopUpSheet";
import CoinQuickBuySheet from "@/components/market/CoinQuickBuySheet";
import RewardBoxesPanel from "@/components/cosmetics/RewardBoxesPanel";
import { Check, Coins, Crown, Gift, Loader2, Lock, Medal, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { COSMETIC_BUNDLES, bundleSavings, isAvailableNow } from "@/lib/cosmeticCatalog";
import FlexCardModal from "@/components/cosmeticsShop/FlexCardModal";
import { useUnlockCelebration } from "@/hooks/useUnlockCelebration";
import { defToFlexItem } from "@/lib/cosmeticsShop/flexFromDef";

// ============================================================================
// COLLECTION — the cosmetics tab
// ----------------------------------------------------------------------------
// Rebuilt 2026-10-15 around the question the old grid could not answer: "what
// does that actually look like?" Every card here is TRY-ON FIRST — tapping one
// previews it on the live profile card at the top (equipped items stay
// underneath, so the comparison is real), and only pressing Equip or Buy
// changes anything. Buying is a confirm step ("Buy … for … Coins?" → Buy now),
// and coins can be bought right here without a detour through the Market.
// ============================================================================

const slotOf = (def: CosmeticDef): keyof EquippedRow => SLOT_BY_TYPE[def.type] as keyof EquippedRow;

/** The cosmetic shown for a slot: the one being tried on, else the equipped one. */
export default function Collection() {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const subscription = useSubscription();
  const { defs, ownedIds, ownedSourceById, equipped, loading, buy, equip, unequip, defById, refresh } = useCosmetics();

  // FLEX CELEBRATION — epic+ unlocks here get the share card, fed from this
  // page's own inventory (no shop-store adoption). `ready` keeps the baseline
  // honest while defs load, so old ownership never re-celebrates on mount.
  const celebrationSource = useMemo(
    () => ({
      ownedItemIds: defs.filter((d) => ownedIds.has(d.id)).map((d) => d.id),
      resolveItem: (id: string) => {
        const def = defs.find((d) => d.id === id);
        return def ? defToFlexItem(def) : undefined;
      },
      ready: !loading,
    }),
    [defs, ownedIds, loading],
  );
  const celebration = useUnlockCelebration(celebrationSource);

  const [typeFilter, setTypeFilter] = useState<CosmeticType | "all">("all");
  const [ownedFilter, setOwnedFilter] = useState<"all" | "owned" | "locked">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<{ gap: number; itemName: string } | null>(null);
  const [quickBuy, setQuickBuy] = useState(false);
  /** The item waiting in the buy-confirm dialog, if any. */
  const [confirm, setConfirm] = useState<CosmeticDef | null>(null);
  /** What is being tried on the preview card right now. Nothing is equipped. */
  const [trying, setTrying] = useState<CosmeticDef | null>(null);

  const [bundleBusy, setBundleBusy] = useState<string | null>(null);

  const coins = (profile as { coins?: number } | null)?.coins ?? 0;

  // Availability is the same rule the server enforces on purchase: a seasonal
  // item with a window is only on sale inside it. Counting only available
  // items keeps the progress bar honest — expired seasons do not belong in the
  // denominator.
  const visibleDefs = useMemo(() => defs.filter((d) => isAvailableNow(d)), [defs]);
  // "This season" rail: windowed items currently on sale. Nothing invented.
  const seasonal = useMemo(
    () => visibleDefs.filter((d) => !!d.season).slice(0, 8),
    [visibleDefs],
  );

  const filtered = useMemo(
    () =>
      visibleDefs.filter((d) => {
        if (typeFilter !== "all" && d.type !== typeFilter) return false;
        const owned = ownedIds.has(d.id);
        if (ownedFilter === "owned" && !owned) return false;
        if (ownedFilter === "locked" && owned) return false;
        if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [visibleDefs, typeFilter, ownedFilter, q],
  );

  const totalCollected = visibleDefs.filter((d) => ownedIds.has(d.id)).length;
  const pct = visibleDefs.length ? Math.round((totalCollected / visibleDefs.length) * 100) : 0;

  /** One transaction, server-priced, all-or-nothing (purchase_cosmetic_bundle). */
  const handleBundleBuy = async (bundleId: string, name: string, cost: number) => {
    if (coins < cost) {
      setTopUp({ gap: cost - coins, itemName: name });
      return;
    }
    setBundleBusy(bundleId);
    const { error } = await supabase
      .rpc("purchase_cosmetic_bundle" as never, { p_bundle_id: bundleId } as never);
    setBundleBusy(null);
    if (error) {
      toast({ title: "Bundle unavailable", description: error.message, variant: "destructive" });
      return;
    }
    await Promise.all([refresh(), refreshProfile()]);
    toast({ title: `${name} unlocked`, description: "The whole set is yours — equip it from the grid below." });
  };

  // -- Starter recommendation: the cheapest on-sale unlock, tried on directly. --
  const starter = useMemo(() => {
    const unowned = visibleDefs.filter((d) => !ownedIds.has(d.id) && d.coin_cost != null);
    return unowned.length
      ? unowned.reduce((m, d) => ((d.coin_cost ?? 0) < (m.coin_cost ?? 0) ? d : m))
      : null;
  }, [visibleDefs, ownedIds]);

  // -- Try-on: the slot resolution the preview card renders from --------------
  const shown = (type: CosmeticType): CosmeticDef | undefined => {
    if (trying && trying.type === type) return trying;
    return defById(equipped[slotOf({ type } as CosmeticDef)]);
  };
  const bgDef = shown("background");
  const borderDef = shown("border");
  const titleDef = shown("title");
  const colorDef = shown("name_color");
  const effectDef = shown("effect");
  const badgeDef = shown("badge");
  const nameColor = cosmeticColor(colorDef) ?? undefined;

  // -- Actions ----------------------------------------------------------------
  const handleEquip = async (def: CosmeticDef) => {
    setBusy(def.id);
    const { error } = await equip(def.id);
    setBusy(null);
    if (error) {
      toast({ title: "Could not equip", description: error, variant: "destructive" });
      return;
    }
    setTrying(null);
    toast({ title: `${def.name} equipped` });
  };

  const handleUnequip = async (def: CosmeticDef) => {
    const slot = slotOf(def);
    setBusy(slot);
    const { error } = await unequip(slot);
    setBusy(null);
    if (error) toast({ title: "Could not remove", description: error, variant: "destructive" });
  };

  /** Runs after the confirm dialog's "Buy now" — or straight from a free claim. */
  const handleBuy = async (def: CosmeticDef) => {
    const cost = def.coin_cost ?? 0;
    if (coins < cost) {
      setConfirm(null);
      setTopUp({ gap: cost - coins, itemName: def.name });
      return;
    }
    setBusy(def.id);
    const { error } = await buy(def.id);
    setBusy(null);
    if (error) {
      toast({ title: "Purchase failed", description: error, variant: "destructive" });
      return;
    }
    setConfirm(null);
    setTrying(null);
    await refreshProfile();
    toast({ title: `${def.name} unlocked`, description: "Equip it from the grid below." });
  };

  const tryOn = (def: CosmeticDef) => setTrying(def.id === trying?.id ? null : def);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      {/* ============= HEADER + COINS ============= */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.24em] text-primary font-bold">
            <Sparkles size={12} /> Cosmetics
          </div>
          <h1 className="text-2xl font-display font-black">Your collection</h1>
          <p className="text-sm text-muted-foreground">
            {totalCollected} / {defs.length} collected · {pct}%
          </p>
          <div className="mt-2 h-2 max-w-xs overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-gradient-primary"
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-energy/30 bg-energy/10 px-3 py-1.5 text-sm font-bold text-energy">
            <Coins size={13} /> {formatNumber(coins)}
          </span>
          <Button size="sm" className="bg-gradient-electric text-white" onClick={() => setQuickBuy(true)}>
            <Coins size={13} className="mr-1" /> Buy Coins
          </Button>
        </div>
      </div>

      {/* ============= SURPRISE BOXES ============= */}
      <RewardBoxesPanel />

      {/* ============= LIVE TRY-ON CARD ============= */}
      <div className="space-y-2">
        <div
          className="relative overflow-hidden rounded-3xl border p-5 transition-colors"
          style={{
            borderColor: borderDef ? `${cosmeticColor(borderDef) ?? "#3b82f6"}66` : "hsl(var(--border))",
            background: bgDef
              ? (cosmeticColor(bgDef) ?? RARITY_META[bgDef.rarity].gradient)
              : "linear-gradient(160deg, hsl(217 60% 18%), hsl(220 60% 8%))",
            boxShadow: bgDef ? `0 0 30px ${RARITY_META[bgDef.rarity].glow}33` : undefined,
          }}
        >
          {/* Border slot: an inset ring around the whole card. */}
          {borderDef && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-3xl"
              style={{ boxShadow: `inset 0 0 0 3px ${cosmeticColor(borderDef) ?? "#3b82f6"}` }}
            />
          )}
          {/* Effect slot: a slow shimmer sweep when the effect is animated. */}
          {effectDef && isAnimated(effectDef) && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(110deg, transparent 30%, ${
                  cosmeticColor(effectDef) ?? "#a855f7"
                }33 50%, transparent 70%)`,
                backgroundSize: "200% 100%",
              }}
              animate={{ backgroundPosition: ["100% 0", "-100% 0"] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
            />
          )}

          <div className="relative">
            <p className="text-[12px] font-display font-bold uppercase tracking-wider text-white/60">
              Live preview
            </p>
            <p className="mt-2 font-display text-2xl font-black" style={{ color: nameColor ?? "#fff" }}>
              {profile?.full_name || "Athlete"}
            </p>
            {titleDef && (
              <p className="text-sm font-semibold" style={{ color: cosmeticColor(titleDef) ?? undefined }}>
                {cosmeticLabel(titleDef)}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {badgeDef && (
                <span
                  className="rounded-full px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider"
                  style={{
                    background: `${RARITY_META[badgeDef.rarity].glow}22`,
                    color: "#fff",
                    border: `1px solid ${RARITY_META[badgeDef.rarity].glow}55`,
                  }}
                >
                  {cosmeticLabel(badgeDef)}
                </span>
              )}
              {effectDef && !isAnimated(effectDef) && (
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[12px] text-white/70">
                  {cosmeticLabel(effectDef)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Trying-on banner: nothing is equipped until Equip is pressed. */}
        <AnimatePresence>
          {trying && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                Trying on {trying.name}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({RARITY_META[trying.rarity].label} · not equipped yet)
                </span>
              </span>
              <button
                type="button"
                onClick={() => setTrying(null)}
                className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                <X size={12} /> Cancel
              </button>
              {ownedIds.has(trying.id) && isAnimated(trying) && !subscription.isActive ? (
                <button
                  type="button"
                  onClick={() => navigate("/subscription")}
                  className="inline-flex items-center gap-1 rounded-xl border border-energy/40 bg-energy/10 px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider text-energy"
                >
                  <Crown size={12} /> Premium
                </button>
              ) : ownedIds.has(trying.id) ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleEquip(trying)}
                  className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-60"
                >
                  {busy === trying.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Equip
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirm(trying)}
                  className="inline-flex items-center gap-1 rounded-xl bg-energy px-3 py-1.5 text-[12px] font-bold text-background disabled:opacity-60"
                >
                  <Coins size={12} /> Buy {trying.coin_cost != null ? formatNumber(trying.coin_cost) : ""}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ============= THIS SEASON ============= */}
      {seasonal.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-2 px-1">
            <Sparkles size={13} className="text-primary" />
            <h2 className="text-[12px] font-display font-bold uppercase tracking-wider">This season</h2>
            <span className="truncate text-[11px] text-muted-foreground">On sale through its window — items may return in future seasons.</span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
            {seasonal.map((d) => {
              const meta = RARITY_META[d.rarity];
              const owned = ownedIds.has(d.id);
              const color = cosmeticColor(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => tryOn(d)}
                  className={`w-40 shrink-0 rounded-2xl border p-3 text-left transition-all hover:border-primary/50 ${meta.border}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-bold" style={color ? { color } : undefined}>
                      {d.name}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[12px] font-bold uppercase ${meta.bg} ${meta.text}`}>{meta.label}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{d.description ?? cosmeticLabel(d)}</p>
                  <p className="mt-2 flex items-center gap-1 text-[12px] font-bold text-energy">
                    <Coins size={11} /> {owned ? "Owned" : formatNumber(d.coin_cost ?? 0)}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ============= BUNDLES ============= */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-2 px-1">
          <Gift size={13} className="text-primary" />
          <h2 className="text-[12px] font-display font-bold uppercase tracking-wider">Bundles</h2>
          <span className="truncate text-[11px] text-muted-foreground">One checkout, one price — the whole set, or nothing.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COSMETIC_BUNDLES.map((bundle) => {
            const items = bundle.itemIds.map((id) => defById(id)).filter(Boolean);
            return (
              <div key={bundle.id} className="flex flex-col rounded-2xl border border-energy/25 bg-energy/[0.04] p-4">
                <p className="text-sm font-display font-bold">{bundle.name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{bundle.description}</p>
                <ul className="mt-3 space-y-1">
                  {items.map((item) => (
                    <li key={item!.id} className="flex items-center gap-1.5 text-[12px]">
                      <Check size={11} className={ownedIds.has(item!.id) ? "text-primary" : "text-muted-foreground"} />
                      <span className={`truncate ${ownedIds.has(item!.id) ? "text-primary" : ""}`} style={cosmeticColor(item!) ? { color: cosmeticColor(item!)! } : undefined}>
                        {cosmeticLabel(item!)}
                      </span>
                      <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[12px] font-bold uppercase ${RARITY_META[item!.rarity].bg} ${RARITY_META[item!.rarity].text}`}>
                        {RARITY_META[item!.rarity].label}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {formatNumber(bundle.itemValue)} Coins of items — save {formatNumber(bundleSavings(bundle))} as a set.
                </p>
                <button
                  type="button"
                  disabled={bundleBusy !== null}
                  onClick={() => void handleBundleBuy(bundle.id, bundle.name, bundle.coinCost)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-energy py-2 text-[12px] font-bold text-background disabled:opacity-60"
                >
                  {bundleBusy === bundle.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <>
                      <Coins size={12} /> Buy for {formatNumber(bundle.coinCost)}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============= FILTERS ============= */}
      <div className="space-y-2.5">
        <Input placeholder="Search cosmetics…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {(["all", ...SELLABLE_TYPES, "badge"] as (CosmeticType | "all")[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "all" ? "All" : TYPE_META[t as CosmeticType].label}
            </button>
          ))}
          <span className="w-px shrink-0 bg-border mx-1" />
          {(["all", "owned", "locked"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setOwnedFilter(f)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                ownedFilter === f
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {!loading && totalCollected === 0 && starter && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Start your collection</p>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{starter.name}</p>
              <p className="truncate text-[12px] text-muted-foreground">{starter.description ?? starter.category}</p>
            </div>
            <button
              type="button"
              onClick={() => tryOn(starter)}
              className="shrink-0 rounded-xl bg-energy px-4 py-2 text-[12px] font-bold text-background"
            >
              <Coins size={12} className="mr-1 inline" /> {formatNumber(starter.coin_cost ?? 0)}
            </button>
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            Log a session this week and the weekly drip puts Coins toward this — or grab a bundle above.
          </p>
        </div>
      )}

      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading your collection…</p>}

      {/* ============= GRID ============= */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((d) => {
          const owned = ownedIds.has(d.id);
          const meta = RARITY_META[d.rarity];
          const slot = (SELLABLE_TYPES as CosmeticType[]).includes(d.type as CosmeticType)
            ? slotOf(d)
            : null;
          const isEquipped = slot ? equipped[slot] === d.id : false;
          const isTrying = trying?.id === d.id;
          const color = cosmeticColor(d);
          const price = d.coin_cost;

          return (
            <motion.div
              key={d.id}
              layout
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
              className={`relative flex flex-col overflow-hidden rounded-2xl border transition-all ${
                isTrying ? "border-primary shadow-glow-electric" : meta.border
              }`}
              style={{ boxShadow: owned ? `0 0 20px ${meta.glow}33` : undefined }}
            >
              {/* Tile: the cosmetic rendered as itself, not a placeholder. */}
              <button
                type="button"
                onClick={() => tryOn(d)}
                aria-label={`Try on ${d.name}`}
                className="relative h-24 overflow-hidden"
                style={{ background: meta.gradient }}
              >
                {d.type === "title" && (
                  <span className="absolute inset-0 flex items-center justify-center px-2 text-center font-display text-sm font-black" style={{ color: color ?? "#fff" }}>
                    {cosmeticLabel(d)}
                  </span>
                )}
                {d.type === "name_color" && (
                  <span className="absolute inset-2 rounded-xl" style={{ background: color ?? "#fff" }} />
                )}
                {d.type === "background" && (
                  <span className="absolute inset-0" style={{ background: color ?? meta.gradient }} />
                )}
                {d.type === "border" && (
                  <span
                    className="absolute inset-3 rounded-full"
                    style={{ boxShadow: `inset 0 0 0 4px ${color ?? "#fff"}` }}
                  />
                )}
                {d.type === "effect" && (
                  <motion.span
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(110deg, transparent 30%, ${color ?? "#a855f7"}66 50%, transparent 70%)`,
                      backgroundSize: "200% 100%",
                    }}
                    animate={isAnimated(d) ? { backgroundPosition: ["100% 0", "-100% 0"] } : undefined}
                    transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
                  />
                )}
                {d.type === "badge" && (
                  <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-black" style={{ color: color ?? "#fff" }}>
                    {cosmeticLabel(d)}
                  </span>
                )}

                <span
                  className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wider backdrop-blur"
                  style={{ background: "rgba(0,0,0,0.45)", color: meta.glow }}
                >
                  {meta.label}
                </span>
                {isEquipped && (
                  <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check size={11} />
                  </span>
                )}
                {!owned && (
                  <span className="absolute bottom-1.5 left-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/60">
                    <Lock size={10} className="text-white/80" />
                  </span>
                )}
              </button>

              <div className="flex flex-1 flex-col p-2.5">
                <p className="truncate text-[12px] font-bold" style={color ? { color } : undefined}>
                  {d.name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.description ?? TYPE_META[d.type as CosmeticType]?.blurb ?? d.category}
                </p>

            {owned && ownedSourceById[d.id] && ownedSourceById[d.id] !== "coins" && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                <Medal size={9} /> Earned
              </span>
            )}

                <div className="mt-auto pt-2">
                  {isEquipped && slot ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void handleUnequip(d)}
                      className="w-full rounded-xl border border-border py-1.5 text-[12px] font-bold uppercase tracking-wider text-muted-foreground disabled:opacity-60"
                    >
                      {busy === slot ? <Loader2 size={12} className="mx-auto animate-spin" /> : "Unequip"}
                    </button>
                  ) : owned && isAnimated(d) && !subscription.isActive ? (
                    <button
                      type="button"
                      onClick={() => navigate("/subscription")}
                      className="flex w-full items-center justify-center gap-1 rounded-xl border border-energy/40 bg-energy/10 py-1.5 text-[12px] font-bold uppercase tracking-wider text-energy"
                    >
                      <Crown size={12} /> Premium
                    </button>
                  ) : owned ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void handleEquip(d)}
                      className="w-full rounded-xl bg-primary py-1.5 text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-60"
                    >
                      {busy === d.id ? <Loader2 size={12} className="mx-auto animate-spin" /> : "Equip"}
                    </button>
                  ) : price != null ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirm(d)}
                      className="flex w-full items-center justify-center gap-1 rounded-xl bg-energy py-1.5 text-[12px] font-bold text-background disabled:opacity-60"
                    >
                      {busy === d.id ? <Loader2 size={12} className="animate-spin" /> : <><Coins size={12} /> {formatNumber(price)}</>}
                    </button>
                  ) : (
                    <p className="text-center text-[12px] text-muted-foreground">
                      {d.type === "badge" ? "Earn from boxes" : "Not for sale"}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {!loading && filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No cosmetics match your filters.</p>
      )}

      {/* ============= BUY CONFIRM ============= */}
      <AnimatePresence>
        {confirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 px-6 backdrop-blur-sm"
            onClick={() => setConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs rounded-3xl border border-border bg-card p-5 text-center"
            >
              <div
                className="mx-auto h-16 w-16 rounded-2xl"
                style={{ background: RARITY_META[confirm.rarity].gradient }}
              />
              <p className="mt-3 font-display text-lg font-black">{confirm.name}</p>
              <p className="text-[12px] text-muted-foreground">{TYPE_META[confirm.type as CosmeticType]?.blurb ?? confirm.category}</p>
              <p className="mt-3 text-sm">
                Buy for{" "}
                <span className="font-bold text-energy">
                  {formatNumber(confirm.coin_cost ?? 0)} Coins
                </span>
                ?
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">You have {formatNumber(coins)} Coins.</p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void handleBuy(confirm)}
                className="mt-4 w-full rounded-2xl bg-gradient-electric py-2.5 text-[12px] font-black uppercase tracking-wider text-white shadow-glow-electric active:scale-[0.99] disabled:opacity-60"
              >
                {busy === confirm.id ? <Loader2 size={14} className="mx-auto animate-spin" /> : "Buy now"}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="mt-2 w-full text-[12px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CoinTopUpSheet
        open={topUp !== null}
        onClose={() => setTopUp(null)}
        gap={topUp?.gap ?? 0}
        itemName={topUp?.itemName}
      />
      <CoinQuickBuySheet open={quickBuy} onClose={() => setQuickBuy(false)} />
      {/* Epic+ unlock celebration — same flex card as the wardrobe. */}
      <FlexCardModal
        item={celebration.item}
        athleteName={profile?.full_name || "Athlete"}
        onClose={celebration.dismiss}
      />
    </div>
  );
}
