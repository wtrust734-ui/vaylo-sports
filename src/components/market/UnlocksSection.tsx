import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, Loader2, Lock, Ticket, Zap, ArrowRight, Infinity as InfinityIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useToast } from "@/hooks/use-toast";
import { creditCost } from "@/lib/credits";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { UNLOCK_CATALOG, type UnlockCatalogEntry } from "@/config/unlocks";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";

/**
 * THE UNLOCK STORE — everything the app sells that is not credits, coins or a plan.
 *
 * This screen exists because of one specific complaint, and it is worth writing
 * down so it is not undone: the Market listed a price for every one-off unlock
 * ("Mental Gym 30", "Cross-Sport Analysis 15") in a passive reference list,
 * and there was nothing to press. Either way the shop's own list was a page of
 * prices an athlete could not act on.
 *
 * Only permanent one-off entitlements are sold here. Form analysis is per
 * analysis and nutrition is a standard tab with per-use charges — neither is
 * an unlock, so neither is listed, and the catalogue refuses to sell flat
 * rates on metered AI calls.
 *
 * So the rule here is narrow and absolute: every row in this section is
 * buyable from this section. The purchase goes through the same call the feature
 * screens use (useUnlockFeature → process-purchase), which is the same call
 * Injury Management already used — the price is read server-side from
 * public.credit_cost() and the entitlement is written by the service role, so
 * this screen cannot grant anything it did not pay for.
 *
 * A shortfall is not a dead end. useUnlockFeature opens the top-up sheet for the
 * exact gap the server reported and retries the unlock once the purchase lands;
 * dismissing the sheet leaves everything as it was.
 */
const UnlockCard = ({
  entry,
  owned,
  buying,
  credits,
  onBuy,
  onOpen,
}: {
  entry: UnlockCatalogEntry;
  owned: boolean;
  buying: boolean;
  credits: number;
  onBuy: () => void;
  onOpen: () => void;
}) => {
  const price = creditCost(entry.costKey);
  // A locked card must still be readable by someone who cannot afford it: the
  // price is a fact, the shortfall is the athlete's business.
  const cannotAfford = !owned && credits < price;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`overflow-hidden rounded-2xl border bg-gradient-card p-4 ${
        owned ? "border-energy/40" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold">{entry.label}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{entry.tagline}</p>
        </div>
        {owned ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-energy/40 bg-energy/10 px-2 py-1 text-[12px] font-bold text-energy">
            <Check size={11} /> Owned
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[12px] font-bold text-primary">
            <Zap size={11} /> {price}
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-1.5">
        {entry.unlocks.map((line) => (
          <li key={line} className="flex items-start gap-2 text-xs text-foreground/85">
            <Check size={11} className="mt-[3px] shrink-0 text-energy" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {owned ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onOpen}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-2.5 text-sm font-bold text-primary-foreground shadow-glow"
          >
            {entry.routeLabel} <ArrowRight size={14} />
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onBuy}
            disabled={buying}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-2.5 text-sm font-bold text-primary-foreground shadow-glow disabled:opacity-60"
          >
            {buying ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            {buying ? "Unlocking…" : `Unlock for ${price} credits`}
          </motion.button>
        )}
      </div>

      {cannotAfford && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          You have {credits} credits. Unlocking will offer a top-up for the exact difference —
          credits never expire, and nothing renews.
        </p>
      )}

      {entry.pairsWith && entry.pairsWith.length > 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Pairs with{" "}
          {entry.pairsWith
            .map((p) => UNLOCK_CATALOG.find((e) => e.product === p)?.label)
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </motion.div>
  );
};

export default function UnlocksSection() {
  const { user, profile, refreshProfile } = useAuth();
  const { hasFeature, refresh: refreshEntitlements } = useSubscription();
  const { toast } = useToast();
  const navigate = useNavigate();
  const unlock = useUnlockFeature();
  const [buying, setBuying] = useState<string | null>(null);

  const credits = profile?.credits ?? 0;
  const owned = UNLOCK_CATALOG.filter((entry) => hasFeature(entry.feature));
  const locked = UNLOCK_CATALOG.filter((entry) => !hasFeature(entry.feature));

  const buy = async (entry: UnlockCatalogEntry) => {
    if (!user) {
      toast({ title: "Sign in to unlock", description: "Your unlocks are kept on your account, so they restore on any device.", variant: "destructive" });
      return;
    }
    setBuying(entry.product);
    try {
      const result = await unlock(entry.product);
      if (result.status === "failed") {
        hapticWarning();
        toast({ title: `Couldn't unlock ${entry.label}`, description: result.error, variant: "destructive" });
        return;
      }
      hapticSuccess();
      // Entitlements and the credit balance are two separate reads; refresh both
      // so the card flips to "Owned" and the balance above it drops together.
      await Promise.all([refreshEntitlements(), refreshProfile()]);
      toast({
        title: `${entry.label} unlocked`,
        description: "Yours permanently — opening it now.",
      });
      // Open it straight away: buying something and landing back on the price
      // list is what made unlocks feel like they had not stuck. The entry
      // stays in the sidebar and hub under its own tab from here on, and the
      // entitlement behind it is the user_purchases row, so it restores on
      // every device and every visit.
      navigate(entry.route);
    } finally {
      setBuying(null);
    }
  };

  return (
    <div className="space-y-3 px-5">
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-4">
        <div className="flex items-center gap-2">
          <InfinityIcon size={16} className="text-primary" />
          <h4 className="font-display text-sm font-bold">Unlock once, keep it forever</h4>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          These are permanent unlocks, not subscriptions. They come out of your credit balance, they
          never renew, and they restore on every device you sign in to.
        </p>
        <p className="mt-2 text-[12px] font-semibold text-primary">
          {owned.length} of {UNLOCK_CATALOG.length} unlocked · {credits} credits available
        </p>
      </div>

      {locked.length === 0 && (
        <div className="rounded-2xl border border-energy/40 bg-energy/5 p-4 text-sm">
          <p className="font-semibold text-energy">Everything here is yours.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Open any feature from the list above, or spend what is left on Event Packs below.
          </p>
        </div>
      )}

      {[...locked, ...owned].map((entry) => (
        <UnlockCard
          key={entry.product}
          entry={entry}
          owned={hasFeature(entry.feature)}
          buying={buying === entry.product}
          credits={credits}
          onBuy={() => void buy(entry)}
          onOpen={() => navigate(entry.route)}
        />
      ))}

      {/*
        Event Packs — back in the shop, and bought with credits.
        Packs were always credit-priced (see EVENT_PACK_CREDITS_PER_DOLLAR and
        claim_event_pack) but the only way in was a card at the bottom of the
        Lifetime tab. They belong next to the other credit purchases, because
        that is what they are.
      */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate("/event-packs")}
        className="w-full rounded-2xl border border-energy/30 bg-gradient-to-br from-energy/10 via-card to-card p-4 text-start"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-energy/15">
            <Ticket size={18} className="text-energy" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-sm font-bold">Event Packs — buy with credits</h3>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              Race, fight and season programmes for your sport. Hundreds of packs, each one a single
              credit purchase that stays yours.
            </p>
          </div>
          <ArrowRight size={16} className="mt-1 shrink-0 text-muted-foreground" />
        </div>
      </motion.button>
    </div>
  );
}
