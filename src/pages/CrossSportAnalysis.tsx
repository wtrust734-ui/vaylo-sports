import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeftRight, ShoppingBag, TrendingUp, TriangleAlert, BarChart3 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useVprSystem, rankFactors } from "@/lib/vprSystem";
import { crossSportFit, getSportWeights, type VPRScores } from "@/lib/performance";
import { creditCost } from "@/lib/credits";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";

// ============================================================================
// CROSS-SPORT ANALYSIS — what the athlete's other sports are actually adding
// ----------------------------------------------------------------------------
// The Market sold this unlock for a long time with nothing behind it: the price
// was listed, the product id was mapped server-side, and the route it claimed to
// live at was /training — the free plan screen. An athlete could pay for it and
// see no change anywhere in the app, which is the defect this page answers. It
// is now a real screen, listed in the Train hub once the unlock is owned (the
// hub drops paid routes until hasFeature says otherwise — see ROUTE_UNLOCKS).
//
// What it does NOT do is call a model. Everything here is arithmetic over data
// the athlete has already logged: their six VPR indices and the sport weights
// and transfer matrix in `performance.ts`. That is deliberate. "Cross-sport
// transfer" is a known table of demands — what Basketball asks of an athlete
// versus what Football does — and the athlete's own profile against those
// demands is a projection we can show honestly and recompute for free. Charging
// for a per-use AI essay here would be selling a guess about numbers we already
// have. The unlock buys the analysis itself, once.
//
// Honesty about what a score means: this is a projection from logged metrics,
// not a measurement of how the athlete would play a second sport. The page says
// so, and it refuses to render a number at all until there are metrics to
// project from — an empty screen with a prompt is better than a confident 62.
// ============================================================================

const TRANSFER_LIMIT = 5;

/** The VPR keys as the words an athlete would use for them. */
const FACTOR_WORD: Record<string, string> = {
  speed_index: "speed",
  power_index: "power",
  endurance_capacity: "endurance",
  repeatability: "repeatability",
  skill_consistency: "skill",
  reaction_efficiency: "reaction",
};

/** The first two demands of a sport, heaviest first. Names, not numbers. */
const topDemands = (sport: string): string[] =>
  Object.entries(getSportWeights(sport))
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => FACTOR_WORD[key] ?? key.replace(/_/g, " "));

const TransferCard = ({
  sport,
  score,
  reason,
  vpr,
  index,
  from,
}: {
  sport: string;
  score: number;
  reason: string;
  vpr: VPRScores;
  index: number;
  from: string;
}) => {
  const weights = getSportWeights(sport);
  const demands = topDemands(sport);
  // The sport's two heaviest demands, read against the athlete's own numbers:
  // "this is the thing Rugby would ask of you, and this is where you are". A
  // demand the athlete is already strong in is shown as a strength rather than
  // hidden, because "you could play this tomorrow" is as useful as a gap.
  const rows = Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, weight]) => ({
      key,
      weight,
      value: (vpr[key as keyof VPRScores] as number) ?? 0,
    }));

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), type: "spring", stiffness: 220, damping: 26 }}
      className="rounded-[22px] border border-white/[0.07] bg-card/60 p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            #{index + 1} from {from}
          </p>
          <h3 className="mt-0.5 font-display text-lg font-bold leading-tight">{sport}</h3>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-2xl font-bold text-gradient-electric">{score}</p>
          <p className="text-[11px] text-muted-foreground">projected fit</p>
        </div>
      </div>

      <div
        role="img"
        aria-label={`Projected fit for ${sport}: ${score} out of 100`}
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{reason}</p>

      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <p className="w-[38%] truncate text-[12px] font-semibold capitalize">
              {FACTOR_WORD[r.key] ?? r.key.replace(/_/g, " ")}
            </p>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(3, Math.min(100, r.value))}%` }} />
            </div>
            <p className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(r.value)}</p>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
        {sport} leans hardest on {demands.join(" and ").toLowerCase()} — the bars are your own indices, weighted for that sport.
      </p>
    </motion.section>
  );
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-background pb-28">
    <header className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1">
        <ArrowLeftRight size={12} className="text-primary" aria-hidden />
        <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">Train</span>
      </div>
      <h1 className="mt-3 text-[30px] font-display font-bold tracking-tight leading-none">Cross-Sport Analysis</h1>
      <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
        What your other sports are actually adding to your main one, read from the metrics you have logged.
      </p>
    </header>
    <div className="px-5">{children}</div>
  </div>
);

const CrossSportAnalysis = () => {
  const { user, profile } = useAuth();
  const { hasFeature, loading: entitlementsLoading, refresh } = useSubscription();
  const unlock = useUnlockFeature();
  const [unlocking, setUnlocking] = useState(false);

  // The sports the athlete listed in their profile. They are the "from" side of
  // the transfer, so the page is only meaningful once at least one is set.
  const sports = useMemo(
    () => (profile?.sport ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    [profile?.sport],
  );
  const [chosenFrom, setChosenFrom] = useState<string | null>(null);
  const primary = chosenFrom ?? sports[0] ?? null;

  const owned = hasFeature("cross_sport");
  const sys = useVprSystem(owned ? primary : null, user?.id);

  const handleUnlock = async () => {
    setUnlocking(true);
    try {
      const res = await unlock("cross_sport");
      if (res.status !== "unlocked") {
        // "insufficient" means the top-up sheet was shown and dismissed — the
        // price is the useful thing to repeat, not a generic failure.
        toast.error(
          res.status === "insufficient"
            ? `Not enough credits — this unlock costs ${res.cost}.`
            : res.error || "Could not unlock Cross-Sport Analysis",
        );
        return;
      }
      toast.success("Cross-Sport Analysis unlocked", {
        description: "It is now in the Train hub, under Progress.",
      });
      await refresh();
    } catch (e) {
      toast.error((e as Error)?.message || "Failed to unlock");
    } finally {
      setUnlocking(false);
    }
  };

  if (entitlementsLoading) return <div className="min-h-screen bg-background" />;

  if (!owned) {
    return (
      <Shell>
        <div className="rounded-[22px] border border-primary/25 bg-gradient-card p-5 shadow-card">
          <h2 className="font-display text-base font-bold">Not unlocked yet</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Cross-Sport Analysis takes the six indices you already log — speed, power, endurance,
            repeatability, skill and reaction — and reads them against what a different sport demands,
            so you can see which of your abilities carry over and which ones a switch would expose.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-foreground/85">
            <li>· A transfer report built from your own logged metrics, not from a questionnaire</li>
            <li>· Ranked by how well your profile actually fits each sport</li>
            <li>· The two demands of each sport you would feel most and least</li>
          </ul>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleUnlock}
            disabled={unlocking}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-60"
          >
            <ShoppingBag size={18} />
            {unlocking ? "Unlocking…" : `Unlock for ${creditCost("cross_sport_unlock")} credits`}
          </motion.button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            One-time unlock, kept for good. Also included with Unlimited.
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          Everything on this screen runs on your device. There is no per-analysis charge after the unlock.
        </p>
      </Shell>
    );
  }

  if (sports.length === 0) {
    return (
      <Shell>
        <EmptyCard
          title="Add your sports first"
          body="Cross-sport transfer compares your profile against a sport, so it needs to know which sport is yours. Add it in your profile and this page fills in."
          to="/profile"
          cta="Open profile"
        />
      </Shell>
    );
  }

  if (sys.loading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Reading your metrics…</p>
      </Shell>
    );
  }

  if (!sys.vpr || !primary) {
    return (
      <Shell>
        <EmptyCard
          title="No metrics to read yet"
          body="This report is arithmetic over the performance metrics you log — sprint times, distances, strength and reaction numbers. Log a few in the VPR screen and the transfer report appears here, ranked."
          to="/vpr"
          cta="Log a metric"
        />
      </Shell>
    );
  }

  const vpr = sys.vpr;
  const report = crossSportFit(primary, vpr).slice(0, TRANSFER_LIMIT);
  const ranked = rankFactors(vpr, primary);
  const strongest = [...ranked].sort((a, b) => b.value - a.value)[0];
  const headroom = ranked[0];

  return (
    <Shell>
      {sports.length > 1 && (
        <div className="mb-4">
          <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Transfer from
          </p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Transfer from sport">
            {sports.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={primary === s}
                onClick={() => setChosenFrom(s)}
                className={`min-h-[44px] whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition-all ${
                  primary === s
                    ? "border-transparent bg-gradient-to-r from-primary to-electric-purple text-primary-foreground shadow-glow"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="rounded-[22px] border border-white/[0.07] bg-card/60 p-4 shadow-card">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-primary" />
          <h2 className="text-sm font-bold">Your profile, weighted for {primary}</h2>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">Overall VPR</p>
            <p className="font-display text-xl font-bold">{Math.round(vpr.overall_vpr)}</p>
          </div>
          {strongest && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">Strongest</p>
              <p className="font-display text-xl font-bold">
                {strongest.label} <span className="text-sm font-semibold text-muted-foreground">{Math.round(strongest.value)}</span>
              </p>
            </div>
          )}
          {headroom && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">Most headroom</p>
              <p className="font-display text-xl font-bold">
                {headroom.label} <span className="text-sm font-semibold text-muted-foreground">{Math.round(headroom.value)}</span>
              </p>
            </div>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          From {sys.snapshotCount > 0 ? `${sys.snapshotCount} snapshots` : "your latest metrics"}
          {sys.delta != null ? ` · ${sys.delta >= 0 ? "+" : ""}${sys.delta} on the last snapshot` : ""}.
          {headroom ? ` ${headroom.label} is weighted heavily for ${primary} and is your lowest of the six, so it is where a block of work moves this the most.` : ""}
        </p>
      </section>

      <h2 className="mb-2 mt-5 px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        Sports your profile transfers to
      </h2>
      <div className="space-y-3">
        {report.map((row, i) => (
          <TransferCard
            key={row.sport}
            sport={row.sport}
            score={row.score}
            reason={row.reason}
            vpr={vpr}
            index={i}
            from={primary}
          />
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
        <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A transfer score is a projection of your logged profile against what a sport demands, not a
          measurement of how you would play it. It tells you where your training already carries over —
          not whether to switch sports. Nothing here is sent to a model: the numbers are computed on your
          device from your own training data.
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
        <TrendingUp size={14} className="shrink-0 text-primary" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Log metrics regularly and this ranking moves with you —{" "}
          <Link to="/vpr" className="font-semibold text-primary underline-offset-2 hover:underline">
            open the VPR screen
          </Link>
          .
        </p>
      </div>
    </Shell>
  );
};

const EmptyCard = ({ title, body, to, cta }: { title: string; body: string; to: string; cta: string }) => (
  <div className="rounded-[22px] border border-border bg-card/60 p-5">
    <h2 className="font-display text-base font-bold">{title}</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    <Link
      to={to}
      className="press mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-gradient-primary px-4 text-sm font-semibold text-primary-foreground shadow-glow"
    >
      {cta}
    </Link>
  </div>
);

export default CrossSportAnalysis;
