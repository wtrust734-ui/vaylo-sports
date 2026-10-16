import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Coins, Sparkles, Star, Flame, ArrowRightLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { formatNumber } from "@/i18n/format";
import { COIN_BUNDLES, COINS_PER_CREDIT, FIRST_PURCHASE_BUNDLE, creditsToCoins } from "@/config/coins";
import { savingsLabelVs, totalCoins } from "@/lib/marketValue";
import ProductFacts from "./ProductFacts";

export default function CoinBundlesSection({
  currency = "USD",
  onBuy,
  priceLabel,
}: {
  currency?: string;
  /**
   * Direct two-tap purchase (confirm sheet → Buy now) — the default path for
   * a single bundle. Absent → falls back to the basket exactly as before.
   */
  onBuy?: (bundle: (typeof COIN_BUNDLES)[number]) => void;
  /** Display-ready price in the athlete's currency (closed-test aware). */
  priceLabel?: (cents: number) => string;
}) {
  const fmt = priceLabel ?? ((cents: number) => formatLocalPrice(cents, currency));
  // "Less per Coin than Starter" on every larger bundle — honest arithmetic
  // on the displayed ladder, identical to the credit side.
  const ladderBase = COIN_BUNDLES[0];
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [convertAmount, setConvertAmount] = useState("10");
  const [converting, setConverting] = useState(false);

  const credits = profile?.credits ?? 0;
  const coins = profile?.coins ?? 0;

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
    const { data, error } = await supabase.rpc("convert_credits_to_coins", { p_credits: n });
    setConverting(false);
    if (error) { toast({ title: "Conversion failed", description: error.message, variant: "destructive" }); return; }
    const awarded = (data as { awarded?: number } | null)?.awarded ?? creditsToCoins(n);
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
          <p className="text-[12px] text-muted-foreground">Coins buy avatar cosmetics only. Buy bundles or convert credits.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 rounded-2xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-2">
          <Coins size={14} className="text-energy" />
          <span className="text-sm font-bold tabular-nums">{formatNumber(coins)}</span>
          <span className="text-xs text-muted-foreground">Coins</span>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <span className="text-sm font-bold tabular-nums text-primary">{formatNumber(credits)}</span>
          <span className="text-xs text-muted-foreground">credits</span>
        </div>
      </div>

      {/* One-time first-purchase offer — the best coin rate in the app. */}
      {firstBundleAvailable && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-primary/40"
        >
          {/* No inner radius: the outer ring is a real 1px border now, not the
              old 1.5px gradient frame the inner padding compensated for. */}
          <div className="bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 rounded-2xl border border-primary/30 bg-primary/15 flex items-center justify-center">
                <Coins size={22} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold uppercase tracking-wider text-primary">{FIRST_PURCHASE_BUNDLE.label}</p>
                <p className="font-display text-xl font-bold">
                  {formatNumber(FIRST_PURCHASE_BUNDLE.coins)} Coins
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Best Coin rate in the app — available once per account.
                </p>
              </div>
              <p className="shrink-0 font-display text-xl font-bold text-foreground">
                {fmt(FIRST_PURCHASE_BUNDLE.price_cents)}
              </p>
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                if (onBuy) {
                  onBuy(FIRST_PURCHASE_BUNDLE);
                  return;
                }
                window.dispatchEvent(
                  new CustomEvent("vaylo:add-coin-bundle", { detail: FIRST_PURCHASE_BUNDLE })
                );
              }}
              className="mt-3 w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground"
            >
              Claim once · {fmt(FIRST_PURCHASE_BUNDLE.price_cents)}
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* Coin bundles (real-money purchase) */}
      <div className="space-y-3">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Coin bundles — real money</p>
        {COIN_BUNDLES.map((b, i) => {
          const total = totalCoins(b);
          const perCoin = b.price_cents / Math.max(1, total);
          const highlight = b.popular || b.best_value;
          const savings = i > 0 && ladderBase ? savingsLabelVs(ladderBase, b, "Coin") : null;
          return (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.02 + i * 0.04 }}
              className={`relative overflow-hidden rounded-3xl border ${highlight ? "border-primary/40" : "border-border"}`}
            >
              {highlight && (
                <span className={`absolute right-4 top-4 z-10 rounded-full border px-2.5 py-1 text-[12px] font-bold ${b.popular ? "border-border bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
                  {b.popular ? <><Star size={9} className="mr-1 inline" /> MOST POPULAR</> : <><Flame size={9} className="mr-1 inline" /> BEST VALUE</>}
                </span>
              )}
              <div className="bg-card p-5">
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
                        <span className="text-[12px] font-bold text-energy">+{b.bonus} bonus</span>
                      </span>
                    )}
                    {b.label && <p className="mt-1 text-[12px] uppercase tracking-wider text-muted-foreground">{b.label} · {formatNumber(total)} total</p>}
                    {savings && <p className="mt-1 text-[12px] font-semibold text-energy">{savings}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-2xl font-bold text-foreground">{fmt(b.price_cents)}</p>
                    <p className="text-[12px] text-muted-foreground">{formatLocalPrice(Math.round(perCoin * 100) / 100, currency)} / Coin</p>
                  </div>
                </div>
                <ProductFacts
                  receive={`${formatNumber(total)} Coins added instantly${b.bonus > 0 ? ` (${b.coins} + ${b.bonus} bonus)` : ""} — avatar cosmetics only`}
                  expires="Never expires"
                  renews="One-off purchase — nothing renews"
                  lifetime="Coins stay until you spend them on avatar items"
                  designedFor="Athletes customising their Vaylo Sports avatar"
                />
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    // Direct buy when the Market provides it; the basket event
                    // remains the fallback so no caller silently loses checkout.
                    if (onBuy) {
                      onBuy(b);
                      return;
                    }
                    const ev = new CustomEvent("vaylo:add-coin-bundle", { detail: b });
                    window.dispatchEvent(ev);
                  }}
                  className="mt-3 w-full rounded-2xl bg-energy py-3 font-bold text-background"
                >
                  {onBuy ? <>Buy now · {fmt(b.price_cents)}</> : <>Add to basket · {fmt(b.price_cents)}</>}
                </motion.button>
              </div>
            </motion.div>
          );
        })}
      </div>
      {/* Convert credits → coins — placed AFTER the paid bundles on purpose:
          the free-with-existing-credits path used to sit above them and bury
          the product. The copy's "above" now matches the layout. */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <ArrowRightLeft size={14} className="text-energy" />
          <h4 className="font-display text-sm font-bold">Convert credits → Coins</h4>
          <span className="ml-auto text-[12px] px-2 py-0.5 rounded-full bg-energy/15 text-energy font-bold">1 : {COINS_PER_CREDIT}</span>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
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
            <Coins size={13} className="text-energy" /> {formatNumber(previewCoins)} Coins
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

      <p className="text-[12px] text-muted-foreground text-center">
        Coin bundles are a separate product from credit packs. Coins only buy avatar cosmetics. Credits unlock features.
      </p>
    </div>
  );
}
