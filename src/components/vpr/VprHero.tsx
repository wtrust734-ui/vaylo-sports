import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVprSystem } from "@/lib/vprSystem";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { Delta, VprFactorBar } from "@/components/ui/section";

const RING_SIZE = 168;
const STROKE = 9;
const R = (RING_SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

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

  return (
    <div
      ref={ref}
      className="rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl p-5 shadow-card overflow-hidden relative"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(circle at center, hsla(272 84% 62% / 0.22), transparent 68%)" }} />
      <div className="relative">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <div
            aria-hidden
            className="absolute inset-0 rounded-full blur-2xl opacity-30"
            style={{ background: `radial-gradient(circle at 50% 50%, ${ringColor} 0%, transparent 68%)` }}
          />
          <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90 relative">
            <defs>
              <linearGradient id="vpr-hero-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="hsl(var(--electric-purple))" />
                <stop offset="100%" stopColor={ringColor} />
              </linearGradient>
              <filter id="vpr-glow">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={ringColor} floodOpacity="0.35" />
              </filter>
            </defs>
            <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={R} stroke="hsl(var(--border))" strokeWidth={STROKE} fill="none" opacity={0.9} />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={R}
              stroke="url(#vpr-hero-grad)"
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={C}
              filter={overall != null ? "url(#vpr-glow)" : undefined}
              initial={{ strokeDashoffset: C }}
              animate={inView && overall != null ? { strokeDashoffset: C - (C * overall) / 100 } : {}}
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
                className="text-5xl font-display font-bold tabular-nums leading-none tracking-tight"
                initial={{ opacity: 0, y: 6 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.5, duration: 0.4 }}
              >
                <AnimatedNumber value={overall} duration={1.1} />
              </motion.span>
            )}
            <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{t("vpr.title")}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1">
            <Activity size={12} className="text-primary" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {sport ?? t("vpr.performance")}
            </span>
          </div>
          <Delta value={sys.delta} unit={sys.snapshotCount < 2 ? t("vpr.trendNeedsTwo") : undefined} className="text-sm" />
          <p className="text-xs leading-relaxed text-muted-foreground">
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
