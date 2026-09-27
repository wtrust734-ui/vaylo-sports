import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Zap, Calendar, Target, CheckCircle2, ArrowLeft } from "lucide-react";
import { BUILT_IN_EVENT_PACKS } from "@/config/eventPacks";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { useAuth } from "@/contexts/AuthContext";
import { publicAppUrl } from "@/lib/share";

// ============================================================================
// PUBLIC EVENT-PACK LANDING PAGE (/packs/:packId)
// ----------------------------------------------------------------------------
// Race-prep packs are the product an outsider is already searching for
// ("half marathon plan"). This page gives every pack a shareable, crawlable
// destination: no auth required, honest pack details, one clear CTA.
//
//   Logged out → CTA creates an account (referral handled by /auth?ref=).
//   Signed in  → straight into the in-app EventPacks flow to buy/claim.
//
// The page only shows built-in pack data — nothing user-specific, nothing
// private — so it can be rendered for anyone.
// ============================================================================

const EventPackLanding = () => {
  const { packId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const pack = BUILT_IN_EVENT_PACKS.find((p) => p.id === packId);

  if (!pack) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Target className="text-muted-foreground" size={28} />
        <h1 className="text-lg font-semibold">Pack not found</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          This training pack doesn't exist or is no longer available.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-2 text-sm text-primary font-semibold"
        >
          Explore Vaylo Sports
        </button>
      </div>
    );
  }

  const price = formatLocalPrice(pack.priceCents, "GBP");
  const weeksPerDay = Math.max(2, Math.round(pack.weeks / 4));

  const cta = () => {
    if (user) {
      navigate("/event-packs");
    } else {
      navigate("/auth");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <button onClick={() => navigate(-1)} className="absolute top-4 left-4 z-10 p-2 rounded-xl bg-card/80 border border-border">
        <ArrowLeft size={18} />
      </button>

      {/* Hero */}
      <div className="bg-gradient-to-b from-primary/20 via-primary/5 to-background px-5 pt-20 pb-8">
        <p className="text-[11px] uppercase tracking-widest text-energy font-semibold">
          {pack.sport} · {pack.category}
        </p>
        <h1 className="text-3xl font-display font-bold mt-2 tracking-tight">{pack.name}</h1>
        {pack.distance && (
          <p className="text-sm text-muted-foreground mt-1">Prepare for your {pack.distance}</p>
        )}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-semibold">
            <Calendar size={12} className="text-primary" /> {pack.weeks}-week plan
          </span>
          <span className="inline-flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-semibold">
            <Zap size={12} className="text-energy" /> ~{weeksPerDay} sessions/week
          </span>
          {pack.distance && (
            <span className="inline-flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-semibold">
              <Target size={12} className="text-electric-purple" /> {pack.distance}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="px-5">
        <p className="text-sm text-muted-foreground leading-relaxed">{pack.description}</p>

        {/* What's included — honest, derived from what the pack actually delivers */}
        <h3 className="text-sm font-semibold mt-6 mb-2 uppercase tracking-wider text-muted-foreground">What's inside</h3>
        <ul className="space-y-2">
          {[
            `A structured ${pack.weeks}-week plan built around your ${pack.distance || pack.targetEvent}`,
            "Sessions adapt to your sport, level and available days",
            "Intensity ramps and a taper so you arrive fresh on race day",
            "Tracks progress and readiness alongside your Vaylo Sports VPR score",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm">
              <CheckCircle2 size={15} className="text-green-500 mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{line}</span>
            </li>
          ))}
        </ul>

        {/* Price + CTA */}
        <div className="mt-8 bg-gradient-to-br from-card via-card to-primary/15 border border-primary/30 rounded-2xl p-5 text-center">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">One-time purchase</p>
          <p className="text-4xl font-display font-bold text-primary mt-1">{price}</p>
          <p className="text-xs text-muted-foreground mt-1">Yours forever · works with the free plan</p>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={cta}
            className="w-full mt-4 bg-gradient-to-r from-primary to-electric-purple text-primary-foreground font-semibold py-3.5 rounded-xl shadow-glow"
          >
            {user ? "Open in Vaylo Sports" : "Start training — get the plan"}
          </motion.button>
          {!user && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Free account · 50 starter credits · no card needed
            </p>
          )}
        </div>

        {/* Brand footer */}
        <p className="text-[11px] text-muted-foreground text-center mt-8">
          Part of <button onClick={() => navigate("/")} className="text-primary font-semibold">Vaylo Sports</button> — the all-sports performance operating system.
        </p>
      </div>
    </div>
  );
};

export default EventPackLanding;
