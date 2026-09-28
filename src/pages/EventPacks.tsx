import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, ShoppingCart, X, Search, Check, ChevronRight, Flame, TrendingUp, Award,
  Calendar, Target, Sparkles, Infinity as InfinityIcon, Smartphone, RefreshCw,
  BadgeCheck, SlidersHorizontal, Trophy, Clock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatLocalPrice, loadEconomyConfig } from "@/lib/creditEconomy";
import { useToast } from "@/hooks/use-toast";
import {
  loadEventPacks, loadOwnedPackIds, claimEventPack, relatedPacks, SECTION_LABELS,
  type EventPack, type EventPackSection,
} from "@/lib/eventPacks";
import { EVENT_PACK_SPORTS, EVENT_PACK_DIFFICULTIES, type EventPackDifficulty } from "@/config/eventPacks";
import { requestCreditTopUp } from "@/lib/topUpStore";

type SortKey = "popular" | "price_low" | "price_high" | "duration_short" | "duration_long";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "Popularity" },
  { key: "price_low", label: "Price: low" },
  { key: "price_high", label: "Price: high" },
  { key: "duration_short", label: "Shortest" },
  { key: "duration_long", label: "Longest" },
];

const DURATIONS: { key: string; label: string; test: (w: number) => boolean }[] = [
  { key: "any", label: "Any length", test: () => true },
  { key: "short", label: "Up to 6 weeks", test: (w) => w <= 6 },
  { key: "mid", label: "7–12 weeks", test: (w) => w >= 7 && w <= 12 },
  { key: "long", label: "13+ weeks", test: (w) => w >= 13 },
];

const PRICES: { key: string; label: string; test: (c: number) => boolean }[] = [
  { key: "any", label: "Any price", test: () => true },
  { key: "low", label: "Under $20", test: (c) => c < 2000 },
  { key: "mid", label: "$20 – $40", test: (c) => c >= 2000 && c <= 4000 },
  { key: "high", label: "Over $40", test: (c) => c > 4000 },
];

const diffStyle = (d: string) =>
  ({
    Beginner: { bg: "bg-energy/10", text: "text-energy", border: "border-energy/30", grad: "from-energy/10 to-transparent" },
    Intermediate: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/30", grad: "from-primary/10 to-transparent" },
    Advanced: { bg: "bg-electric-purple/10", text: "text-electric-purple", border: "border-electric-purple/30", grad: "from-electric-purple/10 to-transparent" },
    Elite: { bg: "bg-destructive/10", text: "text-destructive", border: "border-destructive/30", grad: "from-destructive/15 to-transparent" },
  }[d] || { bg: "bg-muted", text: "text-foreground", border: "border-border", grad: "from-muted to-transparent" });

const badgeFor = (pack: EventPack, sectionKey?: EventPackSection) => {
  // A card in a sectioned rail does not need a badge: the rail heading already
  // says why it is there. It was worse than redundant — every card in the
  // recommended rail wore the same "Most Popular" badge, which reads as an
  // automated stamp rather than a fact about that pack. Badges stay where a
  // card appears in a mixed list: search results and "All Event Packs".
  if (sectionKey) return null;
  return rawBadgeFor(pack);
};

const rawBadgeFor = (pack: EventPack) => {
  if (pack.sections.includes("featured")) return { label: "Featured", icon: Award, color: "bg-energy text-background" };
  if (pack.sections.includes("popular")) return { label: "Most Popular", icon: TrendingUp, color: "bg-electric-purple text-primary-foreground" };
  if (pack.sections.includes("new")) return { label: "New", icon: Sparkles, color: "bg-primary text-primary-foreground" };
  if (pack.sections.includes("seasonal")) return { label: "In Season", icon: Flame, color: "bg-destructive text-destructive-foreground" };
  return null;
};

function LifetimeBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-electric-purple/40 bg-electric-purple/10 px-2 py-0.5 text-[10px] font-semibold text-electric-purple">
      <InfinityIcon size={10} /> Lifetime Access
    </span>
  );
}

function PackCard({
  pack, owned, inBasket, onOpen, onAdd, currency, sectionKey,
}: {
  pack: EventPack; owned: boolean; inBasket: boolean;
  onOpen: () => void; onAdd: () => void;
  currency: string; sectionKey?: EventPackSection;
}) {
  const ds = diffStyle(pack.difficulty);
  const badge = badgeFor(pack, sectionKey);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl border ${ds.border} bg-gradient-card p-4 shadow-card`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${ds.grad}`} />
      <div className="relative z-10">
        <div className="mb-2 flex items-start justify-between gap-2">
          <button onClick={onOpen} className="min-w-0 flex-1 text-start">
            <h3 className="truncate font-display text-sm font-bold">{pack.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{pack.description}</p>
          </button>
          {badge && (
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${badge.color}`}>
              <badge.icon size={9} /> {badge.label}
            </span>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-electric-purple/10 px-2 py-0.5 text-[10px] font-semibold text-electric-purple">{pack.sport}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ds.bg} ${ds.text}`}>{pack.difficulty}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            <Clock size={9} /> {pack.weeks}w
          </span>
          {pack.distance && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{pack.distance}</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-base font-bold text-primary">
              {pack.creditPrice.toLocaleString()}<span className="text-[10px] font-semibold"> credits</span>
            </p>
            <p className="text-[9px] text-muted-foreground">or {formatLocalPrice(pack.priceCents, currency)} · v{pack.version}</p>
          </div>
          {owned ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-energy/40 bg-energy/10 px-3 py-2 text-xs font-bold text-energy">
              <BadgeCheck size={13} /> Purchased
            </span>
          ) : (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onAdd}
              disabled={inBasket}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${
                inBasket ? "border border-border bg-muted/40 text-muted-foreground" : "bg-gradient-primary text-primary-foreground shadow-glow"
              }`}
            >
              {inBasket ? "In basket" : "Add to basket"}
            </motion.button>
          )}
        </div>
        {owned && <div className="mt-2"><LifetimeBadge /></div>}
      </div>
    </motion.div>
  );
}

const EventPacks = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [packs, setPacks] = useState<EventPack[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("All");
  const [difficulty, setDifficulty] = useState<"All" | EventPackDifficulty>("All");
  const [duration, setDuration] = useState("any");
  const [price, setPrice] = useState("any");
  const [sort, setSort] = useState<SortKey>("popular");
  const [showFilters, setShowFilters] = useState(false);

  const [basket, setBasket] = useState<EventPack[]>([]);
  const [showBasket, setShowBasket] = useState(false);
  const [detail, setDetail] = useState<EventPack | null>(null);
  // The cash price is a reference next to the credit price, so it has to be in
  // the athlete's currency: the Market showed the same credits at £3.15 while
  // every pack card said "or $24.99".
  const [currency, setCurrency] = useState("USD");
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    (async () => {
      const cfg = await loadEconomyConfig();
      let value = cfg.region.currency;
      if (userId) {
        const { data: settings } = await supabase
          .from("user_settings").select("currency").eq("user_id", userId).maybeSingle();
        if (settings?.currency) value = settings.currency;
      }
      if (active) setCurrency(value);
    })();
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [all, ids] = await Promise.all([loadEventPacks(), user ? loadOwnedPackIds() : Promise.resolve([])]);
      if (!active) return;
      setPacks(all);
      setOwned(ids);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user?.id]);

  const filtersActive = search.trim() !== "" || sport !== "All" || difficulty !== "All" || duration !== "any" || price !== "any";

  const visible = useMemo(() => {
    const dur = DURATIONS.find((d) => d.key === duration)!;
    const pr = PRICES.find((p) => p.key === price)!;
    const q = search.trim().toLowerCase();
    let list = packs.filter((p) => {
      if (p.retired && !owned.includes(p.id)) return false;
      if (sport !== "All" && p.sport !== sport) return false;
      if (difficulty !== "All" && p.difficulty !== difficulty) return false;
      if (!dur.test(p.weeks)) return false;
      if (!pr.test(p.priceCents)) return false;
      if (q) {
        const hay = `${p.name} ${p.sport} ${p.category} ${p.targetEvent} ${p.distance ?? ""} ${p.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "price_low": return a.priceCents - b.priceCents;
        case "price_high": return b.priceCents - a.priceCents;
        case "duration_short": return a.weeks - b.weeks;
        case "duration_long": return b.weeks - a.weeks;
        default: return b.popularity - a.popularity;
      }
    });
    return list;
  }, [packs, owned, sport, difficulty, duration, price, search, sort]);

  const recommended = useMemo(() => {
    const mySport = profile?.sport ?? undefined;
    const myLevel = profile?.experience_level?.toLowerCase();
    const levelMap: Record<string, EventPackDifficulty> = {
      beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", elite: "Elite",
    };
    const wanted = myLevel ? levelMap[myLevel] : undefined;
    return packs
      .filter((p) => !p.retired)
      .map((p) => {
        let s = p.popularity / 100;
        if (mySport && p.sport.toLowerCase() === mySport.toLowerCase()) s += 4;
        if (wanted && p.difficulty === wanted) s += 2;
        return { p, s };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.p);
  }, [packs, profile]);

  const sections = useMemo(() => {
    // One card per pack across the whole page. Every section used to draw from
    // the same pool, so "Open Water 1K — Beginner" appeared three times: as a
    // recommendation, again under Most Popular, and again under Beginner
    // Friendly. `recommended` is already ranked, so it is not re-sorted.
    const seen = new Set<string>();
    return SECTION_LABELS.map((s) => {
      const pool =
        s.key === "recommended"
          ? recommended
          : packs.filter((p) => !p.retired && p.sections.includes(s.key)).sort((a, b) => b.popularity - a.popularity);
      const items = pool
        .filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        })
        .slice(0, 6);
      return { ...s, items };
    }).filter((s) => s.items.length > 0);
  }, [packs, recommended]);

  const addToBasket = (pack: EventPack) => {
    if (owned.includes(pack.id)) { toast({ title: "You already own this pack" }); return; }
    if (basket.some((b) => b.id === pack.id)) { toast({ title: "Already in basket" }); return; }
    setBasket((b) => [...b, pack]);
    toast({ title: `${pack.name} added 📦` });
  };

  const basketTotal = basket.reduce((s, b) => s + b.priceCents, 0);
  const basketCredits = basket.reduce((s, b) => s + b.creditPrice, 0);

  /**
   * Claims the basket one pack at a time. The server prices each pack; this
   * loop never sends or computes a cost.
   *
   * A shortfall is not a dead end: `claim_event_pack` answers with the exact gap
   * (rather than raising), so the top-up sheet can be offered for that number
   * and the pack the athlete actually wanted is retried once they've bought the
   * credits. Dismissing the sheet leaves the basket untouched.
   */
  const checkout = async () => {
    if (!user) { toast({ title: "Sign in to buy Event Packs", variant: "destructive" }); return; }
    if (basket.length === 0) return;

    const pending = [...basket];
    let spent = 0;

    try {
      for (const pack of pending) {
        let result = await claimEventPack(pack);

        if (!result.ok) {
          const outcome = await requestCreditTopUp({
            shortfall: result.shortfall,
            balance: result.balance,
            reasonLabel: pack.name,
          });
          if (!outcome.purchased) return; // dismissed: nothing was charged
          result = await claimEventPack(pack);
          if (!result.ok) {
            toast({
              title: "Still short of credits",
              description: `${pack.name} needs ${result.required.toLocaleString()} credits.`,
              variant: "destructive",
            });
            return;
          }
        }

        spent += result.creditsPaid;
        setOwned((o) => [...new Set([...o, pack.id])]);
        setBasket((b) => b.filter((x) => x.id !== pack.id));
      }

      setShowBasket(false);
      void refreshProfile();
      toast({
        title: pending.length === 1 ? "Event Pack unlocked 🎉" : `${pending.length} Event Packs unlocked 🎉`,
        description: spent > 0
          ? `${spent.toLocaleString()} credits spent · lifetime access, restored on any device you sign in to.`
          : "Lifetime access — they'll restore on any device you sign in to.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      // The purchase branch is still reachable: a pack is cash-only until its
      // credit price is set. Say that plainly rather than reporting a failure
      // that reads like the athlete's card was declined.
      if (/purchase required/i.test(msg)) {
        toast({
          title: "This pack is cash-only for now",
          description: "Nothing has been charged — contact support to complete this one.",
        });
        return;
      }
      toast({ title: "Purchase failed", description: msg || "Please try again", variant: "destructive" });
    }
  };

  /* ---------------------------- Detail view ---------------------------- */
  if (detail) {
    const ds = diffStyle(detail.difficulty);
    const isOwned = owned.includes(detail.id);
    const inBasket = basket.some((b) => b.id === detail.id);
    const related = relatedPacks(detail, packs);

    return (
      <div className="min-h-screen bg-background pb-28">
        <div className="flex items-center gap-3 px-5 pb-4 pt-14">
          <motion.button onClick={() => setDetail(null)} whileTap={{ scale: 0.9 }} className="-ml-1 p-1 text-muted-foreground">
            <ChevronRight size={22} className="rotate-180" />
          </motion.button>
          <h1 className="flex-1 font-display text-lg font-bold leading-tight">{detail.name}</h1>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className={`relative mx-5 mb-4 overflow-hidden rounded-2xl border ${ds.border} bg-gradient-card p-5 shadow-card`}
        >
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${ds.grad}`} />
          <div className="relative z-10">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-electric-purple/10 px-2 py-0.5 text-[10px] font-semibold text-electric-purple">{detail.sport}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{detail.category}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ds.bg} ${ds.text}`}>{detail.difficulty}</span>
              <LifetimeBadge />
            </div>
            <p className="mb-4 text-sm leading-relaxed text-foreground/90">{detail.description}</p>

            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
                <Target size={14} className="mx-auto mb-1 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">Target event</p>
                <p className="truncate text-xs font-display font-bold">{detail.targetEvent}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
                <Calendar size={14} className="mx-auto mb-1 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">Duration</p>
                <p className="text-xs font-display font-bold">{detail.weeks} weeks</p>
              </div>
              <div className="rounded-xl border border-primary/30 bg-card/60 p-3 text-center">
                <Trophy size={14} className="mx-auto mb-1 text-primary" />
                <p className="text-[10px] text-muted-foreground">Price</p>
                <p className="text-xs font-display font-bold text-primary">
                  {detail.creditPrice.toLocaleString()} credits
                </p>
                <p className="text-[9px] text-muted-foreground">or {formatLocalPrice(detail.priceCents, currency)}</p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Version</p>
                <p className="font-semibold">v{detail.version}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last updated</p>
                <p className="font-semibold">{detail.updatedAt}</p>
              </div>
            </div>

            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Who this plan is designed for</h4>
            <p className="mb-4 rounded-xl border border-border/60 bg-muted/30 p-3 text-[12px] leading-relaxed text-foreground/85">
              <span className="font-semibold">{detail.difficulty}.</span> {detail.designedFor}
            </p>

            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">What's included</h4>
            <div className="mb-4 space-y-2">
              {detail.includes.map((inc) => (
                <div key={inc} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                    <Check size={11} className="text-primary" strokeWidth={3} />
                  </span>
                  {inc}
                </div>
              ))}
            </div>

            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Purchase information</h4>
            <ul className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] text-foreground/85">
              <li className="flex items-start gap-2"><Check size={12} className="mt-[2px] shrink-0 text-energy" /> One-time payment — nothing renews and you are never billed again</li>
              <li className="flex items-start gap-2"><InfinityIcon size={12} className="mt-[2px] shrink-0 text-electric-purple" /> Lifetime access — this pack never expires</li>
              <li className="flex items-start gap-2"><Smartphone size={12} className="mt-[2px] shrink-0 text-primary" /> Available on every device you sign in to, restored automatically</li>
              <li className="flex items-start gap-2">
                <RefreshCw size={12} className="mt-[2px] shrink-0 text-primary" />
                {detail.futureUpdatesIncluded
                  ? "Future updates to this pack are included at no extra cost"
                  : "Future updates are NOT included — you own version " + detail.version}
              </li>
            </ul>
          </div>
        </motion.div>

        {related.length > 0 && (
          <div className="mb-4 px-5">
            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Related Event Packs</h4>
            <div className="space-y-2">
              {related.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setDetail(r)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-start"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Package size={15} className="text-primary" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{r.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {r.sport} · {r.weeks}w · {r.creditPrice.toLocaleString()} credits
                    </span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 p-4 backdrop-blur">
          {isOwned ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-energy/40 bg-energy/10 py-3.5 text-sm font-bold text-energy">
              <BadgeCheck size={16} /> Purchased · Lifetime Access
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => addToBasket(detail)}
              disabled={inBasket}
              className={`w-full rounded-2xl py-3.5 text-sm font-bold ${
                inBasket ? "border border-border bg-muted/40 text-muted-foreground" : "bg-gradient-primary text-primary-foreground shadow-glow"
              }`}
            >
              {inBasket ? "In basket" : `Add to basket · ${detail.creditPrice.toLocaleString()} credits`}
            </motion.button>
          )}
        </div>
      </div>
    );
  }

  /* ---------------------------- Browse view ---------------------------- */
  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="px-5 pb-4 pt-14">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Event Packs</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Complete event preparation programmes. Pay once with credits, keep them for life.
            </p>
            {profile && typeof profile.credits === "number" && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                <Sparkles size={11} /> {profile.credits.toLocaleString()} credits available
              </p>
            )}
          </div>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setShowBasket(true)}
            className="relative rounded-2xl border border-border bg-card p-3"
          >
            <ShoppingCart size={18} />
            {basket.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {basket.length}
              </span>
            )}
          </motion.button>
        </div>

        {owned.length > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-energy/30 bg-energy/10 px-3 py-2 text-[11px] text-energy">
            <BadgeCheck size={13} /> You own {owned.length} pack{owned.length === 1 ? "" : "s"} — permanently, on every device.
          </div>
        )}
      </div>

      {/* Search + filters */}
      <div className="px-5">
        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
            <Search size={15} className="text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sport, event or distance"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {search && <button onClick={() => setSearch("")}><X size={14} className="text-muted-foreground" /></button>}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`rounded-2xl border px-3 ${showFilters ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"}`}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-3 rounded-2xl border border-border bg-card p-3">
                {[
                  { label: "Sport", value: sport, set: setSport as (v: string) => void, options: EVENT_PACK_SPORTS },
                  { label: "Difficulty", value: difficulty, set: setDifficulty as (v: string) => void, options: ["All", ...EVENT_PACK_DIFFICULTIES] },
                ].map((row) => (
                  <div key={row.label}>
                    <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{row.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {row.options.map((o) => (
                        <button
                          key={o}
                          onClick={() => row.set(o)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            row.value === o ? "bg-gradient-primary text-primary-foreground" : "border border-border bg-muted/30 text-muted-foreground"
                          }`}
                        >{o}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Duration</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DURATIONS.map((d) => (
                      <button key={d.key} onClick={() => setDuration(d.key)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${duration === d.key ? "bg-gradient-primary text-primary-foreground" : "border border-border bg-muted/30 text-muted-foreground"}`}
                      >{d.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Price</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRICES.map((p) => (
                      <button key={p.key} onClick={() => setPrice(p.key)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${price === p.key ? "bg-gradient-primary text-primary-foreground" : "border border-border bg-muted/30 text-muted-foreground"}`}
                      >{p.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Sort by</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SORTS.map((s) => (
                      <button key={s.key} onClick={() => setSort(s.key)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${sort === s.key ? "bg-gradient-primary text-primary-foreground" : "border border-border bg-muted/30 text-muted-foreground"}`}
                      >{s.label}</button>
                    ))}
                  </div>
                </div>
                {filtersActive && (
                  <button
                    onClick={() => { setSport("All"); setDifficulty("All"); setDuration("any"); setPrice("any"); setSearch(""); }}
                    className="w-full rounded-xl border border-border py-2 text-[11px] font-semibold text-muted-foreground"
                  >Clear filters</button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {loading ? (
        <div className="space-y-3 px-5 pt-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-card" />)}
        </div>
      ) : filtersActive ? (
        <div className="px-5 pt-4">
          <p className="mb-3 text-[11px] text-muted-foreground">{visible.length} pack{visible.length === 1 ? "" : "s"}</p>
          <div className="space-y-3">
            {visible.slice(0, 60).map((p) => (
              <PackCard
                key={p.id} pack={p} owned={owned.includes(p.id)} inBasket={basket.some((b) => b.id === p.id)}
                currency={currency}
                onOpen={() => setDetail(p)} onAdd={() => addToBasket(p)}
              />
            ))}
          </div>
          {visible.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-8 text-center">
              <Package size={26} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-semibold">No packs match those filters</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Try a different sport, difficulty or price range.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6 pt-5">
          {owned.length > 0 && (
            <section>
              <div className="mb-2.5 px-5">
                <h2 className="font-display text-base font-bold">Your Library</h2>
                <p className="text-[11px] text-muted-foreground">Purchased packs — yours forever</p>
              </div>
              <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 pb-1">
                {packs.filter((p) => owned.includes(p.id)).map((p) => (
                  <div key={p.id} className="w-[240px] shrink-0">
                    <PackCard pack={p} owned inBasket={false} currency={currency} onOpen={() => setDetail(p)} onAdd={() => {}} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {sections.map((s) => (
            <section key={s.key}>
              <div className="mb-2.5 px-5">
                <h2 className="font-display text-base font-bold">{s.label}</h2>
                <p className="text-[11px] text-muted-foreground">{s.blurb}</p>
              </div>
              <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 pb-1">
                {s.items.map((p) => (
                  <div key={p.id} className="w-[240px] shrink-0">
                    <PackCard
                      pack={p} owned={owned.includes(p.id)} inBasket={basket.some((b) => b.id === p.id)}
                      currency={currency} sectionKey={s.key}
                      onOpen={() => setDetail(p)} onAdd={() => addToBasket(p)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section>
            <div className="mb-2.5 px-5">
              <h2 className="font-display text-base font-bold">All Event Packs</h2>
              <p className="text-[11px] text-muted-foreground">{visible.length} programmes across every sport</p>
            </div>
            <div className="space-y-3 px-5">
              {visible.slice(0, 30).map((p) => (
                <PackCard
                  key={p.id} pack={p} owned={owned.includes(p.id)} inBasket={basket.some((b) => b.id === p.id)}
                  currency={currency}
                  onOpen={() => setDetail(p)} onAdd={() => addToBasket(p)}
                />
              ))}
            </div>
            {visible.length > 30 && (
              <p className="px-5 pt-3 text-center text-[11px] text-muted-foreground">
                Use search or filters to find more of the {visible.length} packs.
              </p>
            )}
          </section>
        </div>
      )}

      {/* Basket */}
      <AnimatePresence>
        {showBasket && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end bg-background/80 backdrop-blur-sm"
            onClick={() => setShowBasket(false)}
          >
            <motion.div
              initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">Your Basket</h3>
                <button onClick={() => setShowBasket(false)}><X size={18} className="text-muted-foreground" /></button>
              </div>
              {basket.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Your basket is empty.</p>
              ) : (
                <>
                  <div className="mb-4 space-y-2">
                    {basket.map((b) => (
                      <div key={b.id} className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold">{b.name}</p>
                          <p className="text-[10px] text-muted-foreground">{b.sport} · {b.weeks}w · lifetime access</p>
                        </div>
                        <p className="text-xs font-bold text-primary">{b.creditPrice.toLocaleString()} cr</p>
                        <button onClick={() => setBasket(basket.filter((x) => x.id !== b.id))}>
                          <X size={14} className="text-muted-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total (one-time)</span>
                    <span className="font-display text-lg font-bold text-primary">
                      {basketCredits.toLocaleString()} credits
                    </span>
                  </div>
                  <p className="mb-3 text-end text-[10px] text-muted-foreground">
                    or ${(basketTotal / 100).toFixed(2)} once store billing is live
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.97 }} onClick={checkout}
                    className="w-full rounded-2xl bg-gradient-primary py-3.5 text-sm font-bold text-primary-foreground shadow-glow"
                  >
                    Unlock {basket.length} pack{basket.length === 1 ? "" : "s"} — lifetime access
                  </motion.button>
                  <p className="mt-2 text-center text-[10px] text-muted-foreground">
                    Lifetime access, deducted from your credit balance. Nothing recurs.
                  </p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EventPacks;
