import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, Zap, Coins, X, Infinity as InfinityIcon, Gift, Flame, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { purchaseItems } from "@/lib/billing";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import {
  loadEconomyConfig,
  applyOffer,
  getDoubleCreditsOffer,
  formatLocalPrice,
  trackEconomyEvent,
  type CreditPack,
  type SpecialOffer,
} from "@/lib/creditEconomy";
import MarketSectionNav, { MARKET_SECTIONS, type MarketSection } from "@/components/market/MarketSectionNav";
import { isFlagOn } from "@/config/featureFlags";
import CreditPacksSection from "@/components/market/CreditPacksSection";
import CoinBundlesSection from "@/components/market/CoinBundlesSection";
import SubscriptionsSection from "@/components/market/SubscriptionsSection";
import LifetimeSection from "@/components/market/LifetimeSection";
import CoachingSection from "@/components/market/CoachingSection";
import CreditCostsList from "@/components/market/CreditCostsList";

// PHASE 4 — the Market is a four-section shop: Credit Packs, Credit Subscriptions,
// Lifetime Plans and Human Coaching. Purchase logic (basket + process-purchase) and
// the credit economy are untouched; this is a UX rebuild only.
const Market = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [section, setSection] = useState<MarketSection>("packs");
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [offers, setOffers] = useState<SpecialOffer[]>([]);
  const [region, setRegion] = useState<{ country: string; currency: string; tier_code: string }>({
    country: "US",
    currency: "USD",
    tier_code: "A",
  });
  const [basket, setBasket] = useState<any[]>([]);
  const [showBasket, setShowBasket] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const cfg = await loadEconomyConfig();
      setPacks(cfg.packs);
      setOffers(cfg.offers);
      let regionValue = cfg.region;
      if (user) {
        const { data: settings } = await supabase
          .from("user_settings").select("currency").eq("user_id", user.id).maybeSingle();
        if (settings?.currency) regionValue = { ...regionValue, currency: settings.currency };
      }
      setRegion(regionValue);
      setLoading(false);
      trackEconomyEvent({ event_type: "view" });
    })();
    if (user) {
      supabase.from("basket_items").select("*").eq("user_id", user.id)
        .then(({ data }) => setBasket(data || []));
    }
  }, [user]);

  // Coin bundles dispatch through the same unified basket → process-purchase path.
  useEffect(() => {
    const handler = (e: Event) => {
      const b = (e as CustomEvent).detail as { id: string; coins: number; bonus?: number; price_cents: number };
      if (!b) return;
      void addToBasket({
        id: b.id,
        name: `${b.coins} Coins${b.bonus ? ` + ${b.bonus}` : ""}`,
        price_cents: b.price_cents,
        type: "coins",
        credits: b.coins,
        bonus: b.bonus ?? 0,
      });
      setShowBasket(true);
    };
    window.addEventListener("vaylo:add-coin-bundle", handler);
    return () => window.removeEventListener("vaylo:add-coin-bundle", handler);
  }, [basket]);

  const doubleOffer = useMemo(() => getDoubleCreditsOffer(offers), [offers]);
  const starterOffer = useMemo(() => offers.find((o) => o.offer_type === "starter") ?? null, [offers]);

  const enhancedPacks = useMemo(
    () => packs.map((p) => (doubleOffer ? applyOffer(p, doubleOffer) : p)),
    [packs, doubleOffer],
  );

  const addToBasket = async (item: {
    id: string; name: string; price_cents: number; type: string; credits?: number; bonus?: number;
  }) => {
    if (!user) return;
    if (basket.find((b) => b.product_id === item.id)) {
      toast({ title: "Already in basket" });
      setShowBasket(true);
      return;
    }
    const { data, error } = await supabase.from("basket_items").insert({
      user_id: user.id,
      product_id: item.id,
      product_name: item.name,
      price_cents: item.price_cents,
      product_type: item.type,
    }).select().single();
    if (error) { toast({ title: "Couldn't add to basket", description: error.message, variant: "destructive" }); return; }
    if (data) setBasket([...basket, data]);
    trackEconomyEvent({
      event_type: "add_to_basket",
      pack_id: item.id,
      amount_cents: item.price_cents,
      credits_granted: item.credits ?? 0,
      bonus_granted: item.bonus ?? 0,
    });
    toast({ title: `${item.name} added 🛒` });
  };

  const addPack = (pack: CreditPack) =>
    addToBasket({
      id: pack.id,
      name: `${pack.credits} Credits${pack.bonus ? ` + ${pack.bonus}` : ""}`,
      price_cents: pack.price_cents,
      type: "credits",
      credits: pack.credits,
      bonus: pack.bonus,
    });

  const removeFromBasket = async (id: string) => {
    const { error } = await supabase.from("basket_items").delete().eq("id", id);
    if (error) { toast({ title: "Couldn't remove from basket", description: error.message, variant: "destructive" }); return; }
    setBasket(basket.filter((b) => b.id !== id));
  };

  const checkout = async () => {
    if (!user || basket.length === 0) return;
    // Through the billing seam (src/lib/billing.ts) so store billing can replace
    // web checkout later without touching this page. Same payload as before.
    const result = await purchaseItems(
      basket.map((item) => ({
        product_id: item.product_id,
        product_type: item.product_type,
        product_name: item.product_name,
        price_cents: item.price_cents,
      }))
    );
    if (!result.ok) {
      if (!result.cancelled) hapticWarning();
      toast({
        title: result.cancelled ? "Purchase cancelled" : "Purchase failed",
        description: result.cancelled ? undefined : result.error,
        variant: "destructive",
      });
      return;
    }
    hapticSuccess();
    const data = result.data;
    const credits = data?.credits_added || 0;
    const bonus = data?.bonus_added || 0;
    for (const item of basket) {
      trackEconomyEvent({
        event_type: "purchase",
        pack_id: item.product_id,
        amount_cents: item.price_cents,
        credits_granted: credits,
        bonus_granted: bonus,
      });
    }
    setBasket([]);
    setShowBasket(false);
    await refreshProfile();
    toast({
      title: "Purchase complete! 🎉",
      description: credits > 0 ? `+${credits}${bonus > 0 ? ` & ${bonus} bonus` : ""} credits added` : "Unlocked.",
    });
  };

  const basketTotal = basket.reduce((s, b) => s + b.price_cents, 0);
  const activeSection = MARKET_SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-electric-purple/15 via-primary/5 to-transparent" />
        <div className="relative px-5 pb-5 pt-14">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="font-display text-3xl font-bold text-gradient-electric">Market</motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
                className="mt-1 text-sm text-muted-foreground">Credits, plans and coaching — all in one place.</motion.p>
            </div>
            <motion.button onClick={() => setShowBasket(!showBasket)} whileTap={{ scale: 0.9 }}
              className="relative rounded-xl border border-border bg-card/80 p-3 backdrop-blur">
              <ShoppingCart size={20} />
              {basket.length > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-primary text-[10px] font-bold text-primary-foreground shadow-glow">
                  {basket.length}
                </motion.span>
              )}
            </motion.button>
          </div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="flex w-fit flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-2.5 backdrop-blur">
            <span className="inline-flex items-center gap-1.5"><Zap size={16} className="text-primary" /><span className="text-sm font-bold text-primary">{profile?.credits ?? 0}</span><span className="text-xs text-muted-foreground">credits</span></span>
            <span className="h-4 w-px bg-border" />
            <span className="inline-flex items-center gap-1.5"><Coins size={16} className="text-energy" /><span className="text-sm font-bold text-energy">{profile?.coins ?? 0}</span><span className="text-xs text-muted-foreground">Coins</span></span>
            {profile?.infinite_credits && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-electric-purple/10 px-2 py-0.5 text-[10px] font-bold text-electric-purple">
                <InfinityIcon size={10} /> UNLIMITED
              </span>
            )}
          </motion.div>
        </div>
      </div>

      {/* Basket */}
      <AnimatePresence>
        {showBasket && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="mx-5 mb-5 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display font-bold">Basket</h3>
              <button onClick={() => setShowBasket(false)} className="text-muted-foreground"><X size={18} /></button>
            </div>
            {basket.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Your basket is empty.</p>
            ) : (
              <>
                <div className="mb-3 space-y-2">
                  {basket.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
                      <div>
                        <p className="text-sm font-semibold">{item.product_name}</p>
                        <p className="text-xs text-muted-foreground">{formatLocalPrice(item.price_cents, region.currency)}</p>
                      </div>
                      <motion.button onClick={() => removeFromBasket(item.id)} whileTap={{ scale: 0.9 }}
                        className="text-muted-foreground hover:text-destructive">
                        <X size={14} />
                      </motion.button>
                    </div>
                  ))}
                </div>
                <div className="mb-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <span className="font-display text-lg font-bold text-gradient-electric">
                    {formatLocalPrice(basketTotal, region.currency)}
                  </span>
                </div>
                <motion.button whileTap={{ scale: 0.97 }} onClick={checkout}
                  className="w-full rounded-xl bg-gradient-primary py-3 font-bold text-primary-foreground shadow-glow">
                  Checkout
                </motion.button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live promo */}
      {doubleOffer && section === "packs" && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="mx-5 mb-4 relative overflow-hidden rounded-2xl border border-energy/30">
          <div className="absolute inset-0 bg-gradient-to-r from-energy/20 via-electric-purple/15 to-primary/20" />
          <div className="relative flex items-center gap-3 p-4">
            <div className="rounded-xl bg-energy/20 p-2"><Flame size={20} className="text-energy" /></div>
            <div className="flex-1">
              <p className="font-display text-sm font-bold">{doubleOffer.title}</p>
              <p className="text-[11px] text-muted-foreground">{doubleOffer.description}</p>
            </div>
            <div className="text-right">
              <Clock size={14} className="mb-0.5 inline text-energy" />
              <p className="text-[10px] font-bold text-energy">LIVE</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Section nav */}
      <MarketSectionNav active={section} onChange={setSection} />
      <p className="px-5 pb-4 pt-2 text-xs text-muted-foreground">{activeSection.blurb}</p>

      {/* Starter offer (packs only) */}
      {starterOffer && section === "packs" && (
        <div className="mb-4 px-5">
          <motion.button
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.98 }}
            onClick={() => addToBasket({
              id: `offer_${starterOffer.slug}`,
              name: starterOffer.title,
              price_cents: starterOffer.price_cents ?? 0,
              type: "offer",
              credits: 120,
              bonus: starterOffer.bonus_flat,
            })}
            className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-electric-purple via-primary to-electric-purple p-[1px] text-start">
            <div className="rounded-[22px] bg-card p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-full bg-electric-purple/15 px-2 py-1 text-[10px] font-bold text-electric-purple">
                  <Gift size={10} className="mr-1 inline" /> ONE-TIME OFFER
                </span>
                <span className="text-[10px] text-muted-foreground">Available once per account</span>
              </div>
              <h3 className="font-display text-xl font-bold">{starterOffer.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{starterOffer.description}</p>
              <div className="flex items-end justify-between">
                <div className="flex items-baseline gap-2">
                  <Zap size={18} className="text-primary" />
                  <span className="font-display text-2xl font-bold">120</span>
                  <span className="text-xs text-muted-foreground">credits</span>
                  <span className="ml-1 text-sm font-bold text-energy">+{starterOffer.bonus_flat} bonus</span>
                </div>
                <span className="font-display text-xl font-bold text-gradient-electric">
                  {formatLocalPrice(starterOffer.price_cents ?? 0, region.currency)}
                </span>
              </div>
            </div>
          </motion.button>
        </div>
      )}

      {/* Sections */}
      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {section === "packs" && (
            <>
              <CreditPacksSection packs={enhancedPacks} currency={region.currency} loading={loading} onAdd={addPack} />
              <div className="px-5 pt-3"><CreditCostsList /></div>
            </>
          )}
          {section === "coins" && <CoinBundlesSection currency={region.currency} />}
          {section === "subscriptions" && <SubscriptionsSection />}
          {section === "lifetime" && <LifetimeSection />}
          {section === "coaching" && isFlagOn("coachMarketplace") && <CoachingSection currency={region.currency} />}
        </motion.div>
      </AnimatePresence>

      <p className="px-5 pt-6 text-center text-[10px] text-muted-foreground">
        Prices shown in {region.currency}. Credits unlock premium features across Vaylo Sports.
      </p>
    </div>
  );
};

export default Market;
