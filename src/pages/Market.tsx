import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, Zap, Coins, X, Infinity as InfinityIcon, Gift, Flame, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  purchaseItems,
  isPaymentsUnavailable,
  isFreeGrantUnavailable,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  FREE_GRANT_UNAVAILABLE_MESSAGE,
} from "@/lib/billing";
import { freeCreditsActive, CLOSED_TESTING } from "@/config/closedTesting";
import { disclaimerShort } from "@/config/disclaimers";
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
import { ageBand } from "@/lib/age";
import CreditPacksSection from "@/components/market/CreditPacksSection";
import CoinBundlesSection from "@/components/market/CoinBundlesSection";
import SubscriptionsSection from "@/components/market/SubscriptionsSection";
import LifetimeSection from "@/components/market/LifetimeSection";
import CoachingSection from "@/components/market/CoachingSection";
import CreditCostsList from "@/components/market/CreditCostsList";
import UnlocksSection from "@/components/market/UnlocksSection";
import FamilyPickBanner from "@/components/market/FamilyPickBanner";

/** Shown in place of a purchasing section when the athlete cannot buy. */
/**
 * Shown to an under-18 account instead of a block.
 *
 * It is information, not a sales pitch: it says who the purchase is expected to
 * involve and that it can be refunded, and it carries no discount, no urgency
 * and no call to action. That is the line this screen draws — an account the app
 * is not built for may buy, but nothing here is built to talk them into it.
 */
const GuardianNote = () => (
  <div className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
    <p className="font-semibold">If you are under 18</p>
    <p className="mt-1 text-xs text-muted-foreground">
      Vaylo Sports is built for 18–30-year-old athletes, so buying here is not what this account is
      for. A purchase on this account should involve a parent or guardian. If one is made and it is
      called up, we refund it in full — you or your guardian can ask, and no reason is needed.
      That is a commitment, not a favour. See Refunds and Cancellations.
    </p>
  </div>
);

// PHASE 4 — the Market is a four-section shop: Credit Packs, Credit Subscriptions,
// Lifetime Plans and Human Coaching. Purchase logic (basket + process-purchase) and
// the credit economy are untouched; this is a UX rebuild only.
const Market = () => {
  const { user, profile, refreshProfile } = useAuth();
  // Buying is open to every age, on the owner's instruction. An under-18
  // purchase is expected to involve a parent or guardian and is refunded in full
  // on request (legal/purchases.html section 8 and legal/refunds.html section 4),
  // which is the mitigation that makes opening it defensible.
  //
  // What stays adult-only is the PROMOTION, not the transaction: discount
  // banners, "double credits" pushes, the starter deal and the pick-for-you
  // recommendation are all gated below. Nudging a young athlete to spend is the
  // thing the Children's Code is aimed at, and a listed price is not a nudge. The
  // app now targets 18–30-year-olds, but it still turns no one away, so the same
  // separation is kept rather than retired with the positioning.
  // Unknown age is treated as NOT an adult, exactly as it is everywhere else.
  const isAdult = ageBand(profile?.date_of_birth) === "adult";
  const { toast } = useToast();

  const [section, setSection] = useState<MarketSection>("packs");
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [offers, setOffers] = useState<SpecialOffer[]>([]);
  const [region, setRegion] = useState<{ country: string; currency: string; tier_code: string }>({
    country: "US",
    currency: "USD",
    tier_code: "A",
  });
  type BasketRow = {
    id: string;
    product_id: string;
    product_type: string;
    product_name: string;
    price_cents: number;
    [key: string]: unknown;
  };
  const [basket, setBasket] = useState<BasketRow[]>([]);
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
  // Subscribed once: the handler reads the basket through a ref so it never
  // closes over a stale copy (re-subscribing on every basket change meant a
  // burst of bundle events could add the same row twice).
  const basketRef = useRef(basket);
  basketRef.current = basket;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doubleOffer = useMemo(() => getDoubleCreditsOffer(offers), [offers]);
  // Starter offers must be live rows: an expired row is hidden, not shown.
  const starterOffer = useMemo(
    () => offers.find((o) => o.offer_type === "starter" && (!o.ends_at || new Date(o.ends_at) > new Date())) ?? null,
    [offers]
  );

  const enhancedPacks = useMemo(
    () => packs.map((p) => (doubleOffer ? applyOffer(p, doubleOffer) : p)),
    [packs, doubleOffer],
  );

  /**
   * Add to basket — optimistically.
   *
   * The row lands in local state on the tap rather than after the round-trip,
   * so the badge and the sheet move in the same frame as the finger. The
   * server stays the authority: if the insert fails, the optimistic row is
   * removed and the athlete is told, instead of being left looking at a basket
   * item that will not be there at checkout — a phantom row in a purchase flow
   * is worse than a slow one.
   *
   * `id` is local-only while pending and is never sent anywhere: checkout maps
   * product_id/product_type/product_name/price_cents (see checkout() below), so
   * a synthetic id cannot reach the payment path.
   */
  const addToBasket = (item: {
    id: string; name: string; price_cents: number; type: string; credits?: number; bonus?: number;
  }) => {
    if (!user) return;
    // Read through the ref: event-driven callers (coin bundles) run outside
    // the render cycle and would otherwise see the basket from first mount.
    if (basketRef.current.some((b) => b.product_id === item.id)) {
      toast({ title: "Already in basket" });
      setShowBasket(true);
      return;
    }
    const optimisticId = `optimistic:${item.id}`;
    const optimistic: BasketRow = {
      id: optimisticId,
      user_id: user.id,
      product_id: item.id,
      product_name: item.name,
      price_cents: item.price_cents,
      product_type: item.type,
    };

    setBasket((prev) => (prev.some((b) => b.product_id === item.id) ? prev : [...prev, optimistic]));
    toast({ title: `${item.name} added 🛒` });

    void (async () => {
      const { data, error } = await supabase.from("basket_items").insert({
        user_id: user.id,
        product_id: item.id,
        product_name: item.name,
        price_cents: item.price_cents,
        product_type: item.type,
      }).select().single();
      if (error || !data) {
        setBasket((prev) => prev.filter((b) => b.id !== optimisticId));
        toast({ title: "Couldn't add to basket", description: error?.message ?? "Please try again.", variant: "destructive" });
        return;
      }
      // Swap the placeholder for the saved row: same position, real id.
      setBasket((prev) => prev.map((b) => (b.id === optimisticId ? data : b)));
      trackEconomyEvent({
        event_type: "add_to_basket",
        pack_id: item.id,
        amount_cents: item.price_cents,
        credits_granted: item.credits ?? 0,
        bonus_granted: item.bonus ?? 0,
      });
    })();
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

  /** Remove from basket — same optimistic rule, with the row restored on failure. */
  const removeFromBasket = (id: string) => {
    // A row that is still pending has nothing on the server to delete.
    if (id.startsWith("optimistic:")) {
      setBasket((prev) => prev.filter((b) => b.id !== id));
      return;
    }
    const removed = basket.find((b) => b.id === id);
    setBasket((prev) => prev.filter((b) => b.id !== id));
    void (async () => {
      const { error } = await supabase.from("basket_items").delete().eq("id", id);
      if (error) {
        if (removed) setBasket((prev) => (prev.some((b) => b.id === id) ? prev : [...prev, removed]));
        toast({ title: "Couldn't remove from basket", description: error.message, variant: "destructive" });
      }
    })();
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
      // Until a payment provider is live, every basket is refused by design.
      // Saying so plainly beats a red "Purchase failed" over a button the
      // athlete pressed deliberately.
      if (isPaymentsUnavailable(result)) {
        toast({ title: "Purchases aren't available yet", description: PAYMENTS_UNAVAILABLE_MESSAGE });
        return;
      }
      // The closed-test switch and the server secret disagree: the UI says
      // "free" and the server will not grant. Nothing was charged, so this is
      // reported as a configuration wait, not a payment failure.
      if (isFreeGrantUnavailable(result)) {
        toast({ title: "Free credits aren't on yet", description: FREE_GRANT_UNAVAILABLE_MESSAGE });
        return;
      }
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
    // The server tells us whether this was a free grant rather than us assuming
    // it from the client flag, so the receipt cannot claim "free" for a basket
    // that was actually charged.
    const wasFree = data?.free === true;
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
      title: wasFree ? "Added — free during closed testing" : "Purchase complete! 🎉",
      description: credits > 0
        ? `+${credits}${bonus > 0 ? ` & ${bonus} bonus` : ""} credits added${wasFree ? " — nothing was charged" : ""}`
        : "Unlocked.",
    });
  };

  const basketTotal = basket.reduce((s, b) => s + b.price_cents, 0);
  const activeSection = MARKET_SECTIONS.find((s) => s.key === section) ?? MARKET_SECTIONS[0];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero — plain page background, deliberately. The body already paints
          the app-wide mesh gradient, and an extra purple wash here made the
          top of the Market read as a different surface from every other tab
          (a visible band where the wash faded out). No local gradient. */}
      <div className="relative overflow-hidden">
        <div className="relative px-5 pb-5 pt-[var(--vaylo-screen-top)]">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="font-display text-3xl font-bold text-gradient-electric">Market</motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
                className="mt-1 text-sm text-muted-foreground">{/* The shop's own blurb must not advertise a section the flag hides:
                    promising "coaching" on a screen with no Coaches tab is the
                    one way a switched-off feature still shows itself. */}
                Credits, plans{isFlagOn("coachMarketplace") ? " and coaching" : " and coins"} — all in one place.</motion.p>
            </div>
            <motion.button onClick={() => setShowBasket(!showBasket)} whileTap={{ scale: 0.9 }}
              className="relative rounded-xl border border-border bg-card/80 p-3 backdrop-blur">
              <ShoppingCart size={20} />
              {basket.length > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-primary text-[12px] font-bold text-primary-foreground shadow-glow">
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
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-electric-purple/10 px-2 py-0.5 text-[12px] font-bold text-electric-purple">
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
                        {/* While the closed test runs, the price is what will be
                            charged once billing is live — showing it as a total
                            to pay today would be false. */}
                        <p className="text-xs text-muted-foreground">
                          {freeCreditsActive()
                            ? <><span className="text-success font-medium">{CLOSED_TESTING.label}</span> · <s>{formatLocalPrice(item.price_cents, region.currency)}</s> after testing</>
                            : formatLocalPrice(item.price_cents, region.currency)}
                        </p>
                      </div>
                      <motion.button onClick={() => removeFromBasket(item.id)} whileTap={{ scale: 0.9 }}
                        className="text-muted-foreground hover:text-destructive">
                        <X size={14} />
                      </motion.button>
                    </div>
                  ))}
                </div>
                <div className="mb-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">{freeCreditsActive() ? "You pay" : "Total"}</span>
                  {freeCreditsActive() ? (
                    <span className="text-end">
                      <span className="font-display text-lg font-bold text-success">Free</span>
                      <span className="block text-[11px] text-muted-foreground">
                        <s>{formatLocalPrice(basketTotal, region.currency)}</s> after closed testing
                      </span>
                    </span>
                  ) : (
                    <span className="font-display text-lg font-bold text-gradient-electric">
                      {formatLocalPrice(basketTotal, region.currency)}
                    </span>
                  )}
                </div>
                {freeCreditsActive() && (
                  <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                    {CLOSED_TESTING.explanation}
                  </p>
                )}
                <motion.button whileTap={{ scale: 0.97 }} onClick={checkout}
                  className="w-full rounded-xl bg-gradient-primary py-3 font-bold text-primary-foreground shadow-glow">
                  {freeCreditsActive() ? "Add to my account — free" : "Checkout"}
                </motion.button>
                {freeCreditsActive() && (
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    {disclaimerShort("closedTesting")}
                  </p>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live promo */}
      {isAdult && doubleOffer && section === "packs" && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="mx-5 mb-4 relative overflow-hidden rounded-2xl border border-energy/30">
          <div className="absolute inset-0 bg-gradient-to-r from-energy/20 via-electric-purple/15 to-primary/20" />
          <div className="relative flex items-center gap-3 p-4">
            <div className="rounded-xl bg-energy/20 p-2"><Flame size={20} className="text-energy" /></div>
            <div className="flex-1">
              <p className="font-display text-sm font-bold">{doubleOffer.title}</p>
              <p className="text-[12px] text-muted-foreground">{doubleOffer.description}</p>
            </div>
            <div className="text-right">
              <Clock size={14} className="mb-0.5 inline text-energy" />
              <p className="text-[12px] font-bold text-energy">LIVE</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Section nav */}
      <MarketSectionNav active={section} onChange={setSection} />
      <p className="px-5 pb-4 pt-2 text-xs text-muted-foreground">{activeSection.blurb}</p>

      {/* Starter offer (packs only) — totals derived from the linked pack, never hard-coded */}
      {isAdult && starterOffer && section === "packs" && (
        <div className="mb-4 px-5">
          <motion.button
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.98 }}
            onClick={() => addToBasket({
              id: `offer_${starterOffer.slug}`,
              name: starterOffer.title,
              price_cents: starterOffer.price_cents ?? 0,
              type: "offer",
              credits: (packs.find((p) => p.id === starterOffer.pack_id)?.credits ?? 0) + (packs.find((p) => p.id === starterOffer.pack_id)?.bonus ?? 0),
              bonus: starterOffer.bonus_flat,
            })}
            className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-electric-purple via-primary to-electric-purple p-[1px] text-start">
            <div className="rounded-[22px] bg-card p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-full bg-electric-purple/15 px-2 py-1 text-[12px] font-bold text-electric-purple">
                  <Gift size={10} className="mr-1 inline" /> ONE-TIME OFFER
                </span>
                <span className="text-[12px] text-muted-foreground">Available once per account</span>
              </div>
              <h3 className="font-display text-xl font-bold">{starterOffer.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{starterOffer.description}</p>
              <div className="flex items-end justify-between">
                <div className="flex items-baseline gap-2">
                  <Zap size={18} className="text-primary" />
                  <span className="font-display text-2xl font-bold">
                    {(packs.find((p) => p.id === starterOffer.pack_id)?.credits ?? 0) + (packs.find((p) => p.id === starterOffer.pack_id)?.bonus ?? 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">credits</span>
                  {starterOffer.bonus_flat > 0 && (
                    <span className="ml-1 text-sm font-bold text-energy">+{starterOffer.bonus_flat} bonus</span>
                  )}
                </div>
                <span className="font-display text-xl font-bold text-gradient-electric">
                  {formatLocalPrice(starterOffer.price_cents ?? 0, region.currency)}
                </span>
              </div>
            </div>
          </motion.button>
        </div>
      )}

      {/* Picked for you — one unlock recommendation per sport family */}
      {isAdult && (section === "packs" || section === "unlocks") && <FamilyPickBanner currency={region.currency} />}

      {/* No age block on these sections any more: purchasing is open to every
          age, and the under-18 case is handled by an informational note inside
          each section (GuardianNote) rather than by hiding the shop. Sponsored
          brand content is still gated to 18+ in the DATABASE, which is the
          control that actually matters for advertising. */}
      {!isAdult && (section === "unlocks" || section === "coins" || section === "subscriptions" || section === "lifetime" || section === "coaching") && (
        <div className="px-5 pt-4"><GuardianNote /></div>
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
              {/* What credits cost and what they unlock stays visible to
                  everyone — the economy should never be a mystery. */}
              <CreditPacksSection packs={enhancedPacks} currency={region.currency} loading={loading} onAdd={addPack} />
              {!isAdult && <div className="px-5 pt-4"><GuardianNote /></div>}
              <div className="px-5 pt-3"><CreditCostsList /></div>
            </>
          )}
          {section === "unlocks" && <UnlocksSection />}
          {section === "coins" && <CoinBundlesSection currency={region.currency} />}
          {section === "subscriptions" && <SubscriptionsSection />}
          {section === "lifetime" && <LifetimeSection />}
          {section === "coaching" && isFlagOn("coachMarketplace") && <CoachingSection />}
        </motion.div>
      </AnimatePresence>

      <p className="px-5 pt-6 text-center text-[12px] text-muted-foreground">
        Prices shown in {region.currency}. Credits unlock premium features across Vaylo Sports.
      </p>
    </div>
  );
};

export default Market;
