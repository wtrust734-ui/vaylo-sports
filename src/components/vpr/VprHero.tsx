import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVprSystem } from "@/lib/vprSystem";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { Delta, VprFactorBar } from "@/components/ui/section";

const RING_SIZE = 168;
const RING_SIZE_SM = 132;
const STROKE = 9;
const R = (RING_SIZE - STROKE) / 2;
const R_SM = (RING_SIZE_SM - STROKE) / 2;
const C = 2 * Math.PI * R;
const C_SM = 2 * Math.PI * R_SM;

const VprHero = ({ compact = false }: { compact?: boolean }) => {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const sport = profile?.sport?.split(",")[0]?.trim() || null;
  const sys = useVprSystem(sport, user?.id);

  const overall = sys.vpr?.overall_vpr ?? null;
  const ringColor =
    overall == null
      ? "hsl(var(--muted-foreground))"
      : overall >= 70
        ? "hsl(var(--primary))"
        : overall >= 45
          ? "hsl(var(--energy))"
          : "hsl(var(--destructive))";

  const isSmall = typeof window !== "undefined" && window.innerWidth < 400;
  const RS = isSmall ? RING_SIZE_SM : RING_SIZE;
  const Rr = isSmall ? R_SM : R;
  const Cc = isSmall ? C_SM : C;

  return (
    <div
      ref={ref}
      className="rounded-[22px] border border-white/[0.07] bg-card/60 sm:backdrop-blur-xl p-4 sm:p-5 shadow-card overflow-hidden relative"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(circle at center, hsla(272 84% 62% / 0.22), transparent 68%)" }} />
      <div className="relative">
      <div className="flex items-center gap-3 sm:gap-5 [@media(max-width:360px)]:flex-col [@media(max-width:360px)]:items-start">
        <div className="relative shrink-0" style={{ width: RS, height: RS }}>
          <div
            aria-hidden
            className="absolute inset-0 rounded-full blur-2xl opacity-30 hidden sm:block"
            style={{ background: `radial-gradient(circle at 50% 50%, ${ringColor} 0%, transparent 68%)` }}
          />
          <svg width={RS} height={RS} className="-rotate-90 relative">
            <defs>
              <linearGradient id="vpr-hero-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="hsl(var(--electric-purple))" />
                <stop offset="100%" stopColor={ringColor} />
              </linearGradient>
              <filter id="vpr-glow">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={ringColor} floodOpacity="0.35" />
              </filter>
            </defs>
            <circle cx={RS / 2} cy={RS / 2} r={Rr} stroke="hsl(var(--border))" strokeWidth={STROKE} fill="none" opacity={0.9} />
            <motion.circle
              cx={RS / 2}
              cy={RS / 2}
              r={Rr}
              stroke="url(#vpr-hero-grad)"
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={Cc}
              filter={overall != null ? "url(#vpr-glow)" : undefined}
              initial={{ strokeDashoffset: Cc }}
              animate={inView && overall != null ? { strokeDashoffset: Cc - (Cc * overall) / 100 } : {}}
              transition={{ duration: 1.35, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {sys.loading ? (
              <div className="h-10 w-16 animate-pulse rounded-xl bg-white/10" aria-label="Loading VPR" />
            ) : overall == null ? (
              <span className="text-3xl font-display font-bold text-muted-foreground">—</span>
            ) : (
              <motion.span
                className="text-[38px] sm:text-5xl font-display font-bold tabular-nums leading-none tracking-tight"
                initial={{ opacity: 0, y: 6 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.5, duration: 0.4 }}
              >
                <AnimatedNumber value={overall} duration={1.1} />
              </motion.span>
            )}
            <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{t("vpr.title")}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 max-w-full">
            <Activity size={12} className="text-primary shrink-0" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground truncate">
              {sport ?? t("vpr.performance")}
            </span>
          </div>
          <Delta value={sys.delta} unit={sys.snapshotCount < 2 ? t("vpr.trendNeedsTwo") : undefined} className="text-sm" />
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
            {overall == null
              ? t("vpr.logFirstMetric")
              : overall >= 70
                ? t("vpr.strongProfile")
                : overall >= 45
                  ? t("vpr.developingProfile")
                  : t("vpr.earlyProfile")}
          </p>
        </div>
      </div>

      {!compact && sys.factors.length > 0 && (
        <div className="mt-6 space-y-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
          {sys.factors.slice(0, 4).map((f) => (
            <VprFactorBar key={f.key} label={f.label} value={f.value} weight={f.weight} animated={inView} />
          ))}
          {sys.factors.length > 4 && (
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t("vpr.lowestVsWeighting", { factor: sys.factors[0].label, sport: sport ?? t("vpr.sportFallback") })}
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
};

export default VprHero;
