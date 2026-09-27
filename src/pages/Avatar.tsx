import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, PanInfo } from "framer-motion";
import {
  Coins, Lock, Check, Sparkles, Loader2, Save, Search, Star, Play,
  Dumbbell, Scissors, Palette, Square, Smile, Eye, Minus, Wind, Droplet,
  Shirt, Layers, Footprints, HardHat, Hand, Award, Image as ImageIcon,
  ZoomIn, ZoomOut, RotateCcw, ShoppingBag,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import AvatarCharacter, { type AvatarLoadout } from "@/components/avatar/AvatarCharacter";
import CoinTopUpSheet from "@/components/market/CoinTopUpSheet";
import { FIRST_PURCHASE_BUNDLE } from "@/config/coins";
import {
  CATALOG, CATEGORY_META, RARITY_META, STARTER_ITEMS, DEFAULT_LOADOUT,
  ALL_CATEGORIES, IDENTITY_CATEGORIES,
  type AvatarItem, type Category, type Rarity,
} from "@/lib/avatarCatalog";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

const ICONS: Record<string, LucideIcon> = {
  Dumbbell, Scissors, Palette, Square, Smile, Eye, Minus, Wind, Droplet,
  Shirt, Layers, Footprints, HardHat, Hand, Sparkles, Award, Image: ImageIcon, Play,
};

const FILTERS = ["all", "owned", "free", "premium", "newest"] as const;
type FilterKey = typeof FILTERS[number];

const Avatar = () => {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  // Shortfall top-up — set when the athlete cannot afford what they picked.
  const [topUp, setTopUp] = useState<{ gap: number; itemName?: string } | null>(null);
  const [firstBundleAvailable, setFirstBundleAvailable] = useState(false);

  // The one-time first-purchase bundle is only offered while it is unused.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("user_purchases")
        .select("id")
        .eq("user_id", user.id)
        .eq("product_id", FIRST_PURCHASE_BUNDLE.id)
        .limit(1)
        .maybeSingle();
      if (alive) setFirstBundleAvailable(!data);
    })();
    return () => { alive = false; };
  }, [user]);

  const [loadout, setLoadout] = useState<AvatarLoadout>({ ...DEFAULT_LOADOUT, display_name: "" });
  const [owned, setOwned] = useState<Set<string>>(new Set(STARTER_ITEMS));
  const [isSetup, setIsSetup] = useState(false);

  const [activeCat, setActiveCat] = useState<Category>("body");
  const [rarityFilter, setRarityFilter] = useState<"all" | Rarity>("all");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [previewItem, setPreviewItem] = useState<AvatarItem | null>(null);
  const [detail, setDetail] = useState<AvatarItem | null>(null);

  // Rotation + zoom
  const [rotY, setRotY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const dragStartX = useRef(0);
  const dragStartR = useRef(0);

  const coins = profile?.coins ?? 0;
  const credits = profile?.credits ?? 0;

  // ------- Load avatar -------
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: avatar }, { data: items }] = await Promise.all([
        supabase.from("avatars").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("avatar_items").select("item_id").eq("user_id", user.id),
      ]);
      const ownedSet = new Set<string>(STARTER_ITEMS);
      items?.forEach((r) => ownedSet.add(r.item_id));
      setOwned(ownedSet);

      if (avatar) {
        const extras = (avatar.extras as Record<string, string> | null) || {};
        setLoadout({
          ...DEFAULT_LOADOUT,
          ...extras,
          skin_tone: avatar.skin_tone ?? extras.skin_tone ?? DEFAULT_LOADOUT.skin_tone,
          outfit:    avatar.outfit    ?? extras.outfit    ?? DEFAULT_LOADOUT.outfit,
          headgear:  avatar.headgear  ?? extras.headgear  ?? DEFAULT_LOADOUT.headgear,
          accessory: avatar.accessory ?? extras.accessory ?? DEFAULT_LOADOUT.accessory,
          badge:     avatar.badge     ?? extras.badge     ?? DEFAULT_LOADOUT.badge,
          background:avatar.background?? extras.background?? DEFAULT_LOADOUT.background,
          pose:      avatar.pose      ?? extras.pose      ?? DEFAULT_LOADOUT.pose,
          display_name: avatar.display_name ?? profile?.full_name ?? "",
          prestige_level: avatar.prestige_level,
        });
        setIsSetup(avatar.is_setup);
      } else {
        setLoadout((p) => ({ ...p, display_name: profile?.full_name ?? "" }));
      }
      setLoading(false);
    })();
  }, [user, profile?.full_name]);

  const persistLoadout = async (next: AvatarLoadout, opts: { is_setup?: boolean } = {}) => {
    if (!user) return;
    const legacy = ["skin_tone", "outfit", "headgear", "accessory", "badge", "background", "pose", "display_name", "prestige_level"];
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) if (!legacy.includes(k)) extras[k] = v;
    const payload = {
      user_id: user.id, base: "athlete_neutral",
      skin_tone: next.skin_tone ?? "tone_4",
      outfit: next.outfit ?? null,
      headgear: next.headgear ?? null,
      accessory: next.accessory ?? null,
      badge: next.badge ?? null,
      background: next.background ?? "bg_void",
      pose: next.pose ?? "pose_stance",
      display_name: next.display_name ?? null,
      extras: extras as unknown as Json,
      ...(opts.is_setup !== undefined ? { is_setup: opts.is_setup } : {}),
    };
    const { error } = await supabase.from("avatars").upsert(payload, { onConflict: "user_id" });
    if (error) throw error;
  };

  const applyItem = (item: AvatarItem) => {
    setLoadout((p) => ({ ...p, [item.category]: item.id }));
    setPreviewItem(null);
  };

  const purchase = async (item: AvatarItem) => {
    if (!user || owned.has(item.id) || purchasingId) return;
    if (coins < item.cost) {
      // Sell the gap rather than just refusing: this is the highest-intent
      // moment in the whole economy.
      setTopUp({ gap: item.cost - coins, itemName: item.name });
      return;
    }
    setPurchasingId(item.id);
    const { error } = await supabase.rpc("purchase_avatar_item_coins", {
      p_item_id: item.id, p_category: item.category, p_rarity: item.rarity, p_cost: item.cost,
    });
    setPurchasingId(null);
    if (error) { toast.error(error.message); return; }
    setOwned((s) => new Set(s).add(item.id));
    toast.success(`${item.name} unlocked!`);
    await refreshProfile?.();
    applyItem(item);
    setDetail(null);
  };

  const save = async () => {
    setSaving(true);
    try { await persistLoadout(loadout, { is_setup: true }); setIsSetup(true); toast.success("Avatar saved."); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  // ------- Items derived -------
  const items = useMemo(() => {
    let list = CATALOG.filter((i) => i.category === activeCat);
    if (rarityFilter !== "all") list = list.filter((i) => i.rarity === rarityFilter);
    if (filter === "owned")   list = list.filter((i) => owned.has(i.id));
    if (filter === "free")    list = list.filter((i) => i.cost === 0);
    if (filter === "premium") list = list.filter((i) => i.cost > 0);
    if (filter === "newest")  list = [...list].reverse();
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [activeCat, rarityFilter, filter, search, owned]);

  const live: AvatarLoadout = previewItem ? { ...loadout, [previewItem.category]: previewItem.id } : loadout;

  // ------- Drag rotation -------
  const onDrag = (_: unknown, info: PanInfo) => {
    const next = dragStartR.current + (info.point.x - dragStartX.current) * 0.55;
    setRotY(Math.max(-60, Math.min(60, next)));
  };
  const onDragStart = (_: unknown, info: PanInfo) => {
    dragStartX.current = info.point.x;
    dragStartR.current = rotY;
  };

  // Sidebar categories organized in a compact horizontal icon strip
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen pb-32 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute top-40 right-0 w-[300px] h-[300px] rounded-full bg-electric-purple/20 blur-3xl" />
      </div>

      {/* ============= HEADER ============= */}
      <div className="relative px-5 pt-14 pb-3">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-primary font-bold">
            <Sparkles size={12} /> Avatar Studio
          </div>
          <h1 className="text-3xl font-display font-black mt-1 leading-tight">
            Create Your <span className="text-gradient-electric">Athlete</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-md">
            Your appearance is completely free to customise. Clothing, equipment, accessories and special
            cosmetics unlock with <span className="font-semibold text-energy">Coins</span> — buy Coin bundles in the Market (1 credit = 7.5 Coins).
          </p>
        </motion.div>
      </div>

      {/* ============= LIVE PREVIEW CARD ============= */}
      <div className="relative px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-[28px] overflow-hidden border border-primary/25"
          style={{
            background: "linear-gradient(160deg, hsl(217 90% 20% / 0.55) 0%, hsl(220 60% 10% / 0.85) 55%, hsl(220 80% 6% / 1) 100%)",
            boxShadow: "0 30px 80px -20px hsl(217 100% 45% / 0.35), inset 0 1px 0 hsl(217 100% 70% / 0.15)",
            aspectRatio: "1 / 1.05",
          }}
        >
          {/* Vignette */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(circle at 50% 30%, transparent 40%, rgba(0,0,0,0.55) 100%)",
          }} />
          {/* Soft top light */}
          <div className="absolute inset-x-0 top-0 h-40 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(217 100% 60% / 0.35), transparent 70%)" }} />

          {/* Drag surface */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing"
            drag="x" dragMomentum={false} dragElastic={0.1}
            onDragStart={onDragStart} onDrag={onDrag}
          >
            <AvatarCharacter loadout={live} size={420} rotationY={rotY} zoom={zoom} animated />
          </motion.div>

          {/* Zoom + reset controls */}
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            <button onClick={() => setZoom((z) => Math.min(1.6, z + 0.12))}
              className="w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/10 flex items-center justify-center text-white/90 active:scale-95">
              <ZoomIn size={16} />
            </button>
            <button onClick={() => setZoom((z) => Math.max(0.7, z - 0.12))}
              className="w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/10 flex items-center justify-center text-white/90 active:scale-95">
              <ZoomOut size={16} />
            </button>
            <button onClick={() => { setZoom(1); setRotY(0); }}
              className="w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/10 flex items-center justify-center text-white/90 active:scale-95">
              <RotateCcw size={14} />
            </button>
          </div>

          {/* Coins pill */}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur border border-energy/40">
              <Coins size={14} className="text-energy" />
              <span className="text-sm font-display font-bold tabular-nums text-white">{coins.toLocaleString()}</span>
            </div>
            <button onClick={() => navigate("/market")}
              className="text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-full bg-primary/25 backdrop-blur text-primary-foreground font-bold border border-primary/40 active:scale-95">
              + Top Up
            </button>
          </div>

          {/* Bottom hint + name */}
          <div className="absolute inset-x-0 bottom-3 px-4 flex items-end justify-between gap-2">
            <div className="min-w-0">
              {loadout.display_name ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur border border-white/10">
                  <span className="text-sm font-display font-bold text-white truncate max-w-[180px]">{loadout.display_name}</span>
                </div>
              ) : null}
            </div>
            <span className="text-[10px] uppercase tracking-wider text-white/50">drag to rotate</span>
          </div>
        </motion.div>
      </div>

      {/* ============= NAME + SAVE ============= */}
      <div className="px-5 mt-4 flex gap-2">
        <Input value={loadout.display_name ?? ""} maxLength={24}
          onChange={(e) => setLoadout((p) => ({ ...p, display_name: e.target.value }))}
          placeholder="Display name" />
        <Button onClick={save} disabled={saving} className="shrink-0 bg-gradient-electric">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </Button>
      </div>

      {/* ============= CATEGORY BAR (icons) ============= */}
      <div className="relative mt-6">
        <div className="px-3 flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {ALL_CATEGORIES.map((c) => {
            const meta = CATEGORY_META[c];
            const Icon = ICONS[meta.icon] ?? Sparkles;
            const active = activeCat === c;
            return (
              <motion.button key={c}
                onClick={() => { setActiveCat(c); setPreviewItem(null); setRarityFilter("all"); setFilter("all"); }}
                whileTap={{ scale: 0.93 }}
                className={cn(
                  "shrink-0 flex flex-col items-center gap-1 px-3 py-2.5 rounded-2xl border transition-all duration-200 min-w-[72px]",
                  active
                    ? "bg-primary/20 border-primary text-primary shadow-glow-electric-soft"
                    : "bg-card/40 border-border text-muted-foreground hover:text-foreground",
                )}>
                <Icon size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">{meta.label}</span>
                {meta.free && <span className="text-[8px] font-bold text-success uppercase">Free</span>}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ============= FILTERS BAR ============= */}
      <div className="px-5 mt-4 space-y-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${CATEGORY_META[activeCat].label}…`} className="pl-9 h-9 text-sm" />
        </div>

        <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("shrink-0 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-full transition-all active:scale-95",
                filter === f ? "bg-foreground text-background" : "bg-card/60 text-muted-foreground border border-border")}>
              {f}
            </button>
          ))}
          <span className="w-px bg-border mx-1" />
          {(["all", "common", "rare", "epic", "legendary", "mythic"] as const).map((r) => (
            <button key={r} onClick={() => setRarityFilter(r)}
              className={cn("shrink-0 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-full transition-all active:scale-95",
                rarityFilter === r ? "bg-foreground/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ============= ITEM GRID ============= */}
      <motion.div layout className="px-4 mt-4 grid grid-cols-3 gap-2.5">
        <AnimatePresence mode="popLayout">
          {items.map((item, i) => {
            const isOwned = owned.has(item.id);
            const isEquipped = (loadout as Record<string, string | undefined>)[item.category] === item.id;
            const meta = RARITY_META[item.rarity];
            const canAfford = coins >= item.cost;
            const isColorSwatch = ["skin_tone", "hair_color", "eye_color"].includes(item.category);

            return (
              <motion.button key={item.id} layout
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: Math.min(i * 0.02, 0.25), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -3 }} whileTap={{ scale: 0.96 }}
                onMouseEnter={() => !isOwned && setPreviewItem(item)}
                onMouseLeave={() => setPreviewItem(null)}
                onClick={() => setDetail(item)}
                className={cn(
                  "relative rounded-2xl overflow-hidden text-start transition-all",
                  "border bg-card/60 backdrop-blur",
                  isEquipped ? "border-primary shadow-glow-electric" : "border-border",
                )}
                style={{ boxShadow: (item.rarity === "legendary" || item.rarity === "mythic")
                  ? `0 0 20px ${meta.glow}` : undefined }}
              >
                {/* Rarity animated border for high tiers */}
                {(item.rarity === "legendary" || item.rarity === "mythic") && (
                  <motion.div className="absolute inset-0 rounded-2xl pointer-events-none opacity-70"
                    style={{ padding: 1.5, background: meta.gradient, WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude" }}
                    animate={{ backgroundPosition: ["0% 0%", "100% 100%"] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }} />
                )}

                <div className="aspect-square relative overflow-hidden">
                  {isColorSwatch ? (
                    <div className="absolute inset-2 rounded-xl" style={{ background: item.color || "#000" }} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center"
                      style={{ background: "linear-gradient(160deg, hsl(217 40% 20% / 0.5), hsl(220 60% 8%))" }}>
                      <AvatarCharacter loadout={{ ...loadout, [item.category]: item.id }} size={140} animated={false} showBadge={false} />
                    </div>
                  )}

                  {/* Rarity chip */}
                  <span className="absolute top-1.5 left-1.5 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full backdrop-blur"
                    style={{ background: `${meta.color}25`, color: meta.color, border: `1px solid ${meta.color}55` }}>
                    {meta.label}
                  </span>

                  {isEquipped && (
                    <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check size={11} />
                    </span>
                  )}
                  {!isOwned && !canAfford && (
                    <span className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center">
                      <Lock size={10} className="text-muted-foreground" />
                    </span>
                  )}
                </div>

                <div className="p-2">
                  <p className="text-[11px] font-bold truncate">{item.name}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    {isOwned ? (
                      <span className="text-[9px] uppercase tracking-wider font-bold text-success">Owned</span>
                    ) : item.cost === 0 ? (
                      <span className="text-[10px] uppercase font-bold text-primary">Free</span>
                    ) : (
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold tabular-nums",
                        canAfford ? "text-energy" : "text-destructive")}>
                        <Coins size={10} /> {item.cost}
                      </span>
                    )}
                    {(item.rarity === "legendary" || item.rarity === "mythic") && <Star size={10} className="text-energy" />}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>

        {items.length === 0 && (
          <div className="col-span-3 text-center text-xs text-muted-foreground py-10">
            No items match. Try clearing filters.
          </div>
        )}
      </motion.div>

      {/* ============= DETAIL / PREVIEW SHEET ============= */}
      <AnimatePresence>
        {detail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDetail(null)}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed left-0 right-0 bottom-0 z-50 rounded-t-3xl border-t border-border overflow-hidden"
              style={{
                background: "linear-gradient(180deg, hsl(220 60% 10%), hsl(220 80% 5%))",
                boxShadow: `0 -20px 60px ${RARITY_META[detail.rarity].glow}`,
              }}>
              <div className="mx-auto w-10 h-1 rounded-full bg-white/20 mt-2" />
              <div className="p-5 pb-8">
                <div className="flex items-center gap-3">
                  <div className="w-24 h-24 rounded-2xl flex items-center justify-center overflow-hidden border border-white/10"
                    style={{ background: RARITY_META[detail.rarity].gradient }}>
                    {["skin_tone", "hair_color", "eye_color"].includes(detail.category) ? (
                      <div className="w-16 h-16 rounded-xl" style={{ background: detail.color }} />
                    ) : (
                      <AvatarCharacter loadout={{ ...loadout, [detail.category]: detail.id }} size={90} animated={false} showBadge={false} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: RARITY_META[detail.rarity].color }}>
                      {RARITY_META[detail.rarity].label} · {CATEGORY_META[detail.category].label}
                    </div>
                    <h3 className="text-xl font-display font-black leading-tight">{detail.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {detail.description ?? `A ${RARITY_META[detail.rarity].label.toLowerCase()} ${CATEGORY_META[detail.category].label.toLowerCase()} cosmetic for your athlete.`}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2">
                  <button onClick={() => { setPreviewItem(detail); toast("Previewing on avatar."); }}
                    className="rounded-xl border border-border bg-card/60 py-2.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95">
                    <Eye size={13} /> Preview
                  </button>
                  {owned.has(detail.id) ? (
                    <button onClick={() => { applyItem(detail); setDetail(null); toast.success("Equipped."); }}
                      className="col-span-2 rounded-xl bg-gradient-electric py-2.5 text-xs font-black uppercase tracking-wider text-white flex items-center justify-center gap-1.5 active:scale-95 shadow-glow-electric">
                      <Check size={13} /> Equip
                    </button>
                  ) : detail.cost === 0 ? (
                    <button onClick={() => { setOwned((s) => new Set(s).add(detail.id)); applyItem(detail); setDetail(null); }}
                      className="col-span-2 rounded-xl bg-gradient-electric py-2.5 text-xs font-black uppercase tracking-wider text-white active:scale-95">
                      Unlock (Free)
                    </button>
                  ) : (
                    <button onClick={() => purchase(detail)}
                      disabled={purchasingId === detail.id}
                      className="col-span-2 rounded-xl bg-gradient-electric py-2.5 text-xs font-black uppercase tracking-wider text-white flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-60 shadow-glow-electric">
                      {purchasingId === detail.id ? <Loader2 size={13} className="animate-spin" /> : <ShoppingBag size={13} />}
                      {coins < detail.cost ? `Get ${detail.cost - coins} more Coins` : <>Buy · <Coins size={11} className="inline" /> {detail.cost}</>}
                    </button>
                  )}
                </div>

                {!owned.has(detail.id) && detail.cost > 0 && coins < detail.cost && (
                  <button onClick={() => setTopUp({ gap: detail.cost - coins, itemName: detail.name })}
                    className="mt-2 w-full rounded-xl border border-energy/40 py-2 text-[11px] uppercase tracking-wider font-bold text-energy active:scale-95">
                    + Top up {detail.cost - coins} Coins
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <p className="text-center text-[10px] text-muted-foreground mt-8 px-8">
        Identity edits are free. Cosmetics unlock with Coins (1 credit = 7.5 Coins) · Get Coins in the Market · Your athlete appears everywhere in Vaylo Sports.
      </p>

      <CoinTopUpSheet
        open={topUp !== null}
        onClose={() => setTopUp(null)}
        gap={topUp?.gap ?? 0}
        itemName={topUp?.itemName}
        firstPurchaseAvailable={firstBundleAvailable}
      />
    </div>
  );
};

export default Avatar;
