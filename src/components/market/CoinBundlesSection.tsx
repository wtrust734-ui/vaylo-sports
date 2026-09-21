import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Coins, Sparkles, Star, Flame, ArrowRightLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { COIN_BUNDLES, COINS_PER_CREDIT, FIRST_PURCHASE_BUNDLE, creditsToCoins } from "@/config/coins";
import ProductFacts from "./ProductFacts";

export default function CoinBundlesSection({ currency = "USD" }: { currency?: string }) {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [convertAmount, setConvertAmount] = useState("10");
  const [converting, setConverting] = useState(false);

  const credits = profile?.credits ?? 0;
  const coins = (profile as any)?.coins ?? 0;

  // The one-time first-purchase bundle is only shown while it is unused.
  const [firstBundleAvailable, setFirstBundleAvailable] = useState(false);
  useEffect(() => {
    if (!profile?.user_id) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("user_purchases")
        .select("id")
        .eq("user_id", profile.user_id)
        .eq("product_id", FIRST_PURCHASE_BUNDLE.id)
        .limit(1)
        .maybeSingle();
      if (alive) setFirstBundleAvailable(!data);
    })();
    return () => { alive = false; };
  }, [profile?.user_id]);

  const handleConvert = async () => {
    const n = Math.floor(Number(convertAmount));
    if (!n || n <= 0) { toast({ title: "Enter a valid credit amount", variant: "destructive" }); return; }
    if (n > credits) { toast({ title: `Not enough credits (you have ${credits})`, variant: "destructive" }); return; }
    setConverting(true);
    const { data, error } = await supabase.rpc("convert_credits_to_coins" as any, { p_credits: n });
    setConverting(false);
    if (error) { toast({ title: "Conversion failed", description: error.message, variant: "destructive" }); return; }
    const awarded = (data as any)?.awarded ?? creditsToCoins(n);
    await refreshProfile();
    toast({ title: `Converted ${n} credits → ${awarded} Coins`, description: `Rate: 1 credit = ${COINS_PER_CREDIT} Coins.` });
  };

  const previewCoins = (() => {
    const n = Math.floor(Number(convertAmount) || 0);
    if (n <= 0) return 0;
    return creditsToCoins(n);
  })();

  return (
    <div className="px-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-energy/15 border border-energy/30 flex items-center justify-center">
          <Coins size={16} className="text-energy" />
        </div>
        <div>
          <h3 className="font-display font-bold text-sm">Coins — avatar cosmetics</h3>
          <p className="text-[11px] text-muted-foreground">Coins buy avatar cosmetics only. Buy bundles or convert credits.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 rounded-2xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-2">
          <Coins size={14} className="text-energy" />
          <span className="text-sm font-bold tabular-nums">{coins.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">Coins</span>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <span className="text-sm font-bold tabular-nums text-primary">{credits.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">credits</span>
        </div>
      </div>

      {/* Convert credits → coins */}
      <div className="rounded-2xl border border-border bg-gradient-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <ArrowRightLeft size={14} className="text-energy" />
          <h4 className="font-display text-sm font-bold">Convert credits → Coins</h4>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-energy/15 text-energy font-bold">1 : {COINS_PER_CREDIT}</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          1 credit = {COINS_PER_CREDIT} Coins. Convert any amount instantly — or buy a Coin bundle above and get bonus Coins on top.
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={1}
            max={credits}
            value={convertAmount}
            onChange={(e) => setConvertAmount(e.target.value)}
            className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Credits"
          />
          <span className="text-muted-foreground text-sm">→</span>
          <div className="flex-1 rounded-xl border border-energy/30 bg-energy/10 px-3 py-2.5 text-sm font-bold tabular-nums flex items-center gap-1.5">
            <Coins size={13} className="text-energy" /> {previewCoins.toLocaleString()} Coins
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          {[5, 10, 25, 50].map((n) => (
            <button
              key={n}
              onClick={() => setConvertAmount(String(n))}
              className="flex-1 rounded-full border border-border bg-card py-1.5 text-xs font-bold hover:bg-muted/50"
            >
              {n}
            </button>
          ))}
        </div>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleConvert}
          disabled={converting || !convertAmount || Number(convertAmount) <= 0 || Number(convertAmount) > credits}
          className="mt-3 w-full rounded-xl bg-energy py-2.5 text-sm font-bold text-background disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {converting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
          Convert to Coins
        </motion.button>
      </div>

      {/* One-time first-purchase offer — the best coin rate in the app. */}
      {firstBundleAvailable && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl p-[1.5px] bg-gradient-to-br from-primary via-energy to-electric-purple"
        >
          <div className="rounded-[22px] bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 rounded-2xl border border-primary/30 bg-primary/15 flex items-center justify-center">
                <Coins size={22} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">{FIRST_PURCHASE_BUNDLE.label}</p>
                <p className="font-display text-xl font-bold">
                  {FIRST_PURCHASE_BUNDLE.coins.toLocaleString()} Coins
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Best Coin rate in the app — available once per account.
                </p>
              </div>
              <p className="shrink-0 font-display text-xl font-bold text-gradient-electric">
                {formatLocalPrice(FIRST_PURCHASE_BUNDLE.price_cents, currency)}
              </p>
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("vaylo:add-coin-bundle", { detail: FIRST_PURCHASE_BUNDLE })
                )
              }
              className="mt-3 w-full rounded-2xl bg-gradient-electric py-3 font-bold text-white"
            >
              Claim once · {formatLocalPrice(FIRST_PURCHASE_BUNDLE.price_cents, currency)}
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* Coin bundles (real-money purchase) */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Coin bundles — real money</p>
        {COIN_BUNDLES.map((b, i) => {
          const total = b.coins + (b.bonus || 0);
          const perCoin = b.price_cents / Math.max(1, total);
          const highlight = b.popular || b.best_value;
          return (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.02 + i * 0.04 }}
              className={`relative overflow-hidden rounded-3xl ${highlight ? "p-[1.5px] bg-gradient-to-br from-energy via-primary to-electric-purple" : "p-[1px] bg-border"}`}
            >
              {highlight && (
                <span className={`absolute right-4 top-4 z-10 rounded-full px-2.5 py-1 text-[9px] font-bold text-background ${b.popular ? "bg-energy" : "bg-gradient-to-r from-energy to-primary text-background"}`}>
                  {b.popular ? <><Star size={9} className="mr-1 inline" /> MOST POPULAR</> : <><Flame size={9} className="mr-1 inline" /> BEST VALUE</>}
                </span>
              )}
              <div className="rounded-[22px] bg-card p-5">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-energy/15 border border-energy/20 flex items-center justify-center">
                    <Coins size={26} className="text-energy" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-3xl font-bold">{b.coins}</span>
                      <span className="text-xs text-muted-foreground">Coins</span>
                    </div>
                    {b.bonus > 0 && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-energy/30 bg-energy/15 px-2 py-0.5">
                        <Sparkles size={10} className="text-energy" />
                        <span className="text-[11px] font-bold text-energy">+{b.bonus} bonus</span>
                      </span>
                    )}
                    {b.label && <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{b.label} · {total.toLocaleString()} total</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-2xl font-bold text-gradient-electric">{formatLocalPrice(b.price_cents, currency)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatLocalPrice(Math.round(perCoin * 100) / 100, currency)} / Coin</p>
                  </div>
                </div>
                <ProductFacts
                  receive={`${total.toLocaleString()} Coins added instantly${b.bonus > 0 ? ` (${b.coins} + ${b.bonus} bonus)` : ""} — avatar cosmetics only`}
                  expires="Never expires"
                  renews="One-off purchase — nothing renews"
                  lifetime="Coins stay until you spend them on avatar items"
                  designedFor="Athletes customising their Vaylo avatar"
                />
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    // Bundles are purchased via the unified basket → process-purchase.
                    // Market page wires the add using the standard basket; Coin bundles
                    // are routed here so the checkout path stays single.
                    const ev = new CustomEvent("vaylo:add-coin-bundle", { detail: b });
                    window.dispatchEvent(ev);
                  }}
                  className="mt-3 w-full rounded-2xl bg-energy py-3 font-bold text-background"
                >
                  Add to basket · {formatLocalPrice(b.price_cents, currency)}
                </motion.button>
              </div>
            </motion.div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        Coin bundles are a separate product from credit packs. Coins only buy avatar cosmetics. Credits unlock features.
      </p>
    </div>
  );
}
