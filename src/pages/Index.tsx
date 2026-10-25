import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HeartPulse, Sparkles, Calendar, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useVprSystem } from "@/lib/vprSystem";
import { getCurrentStreak as getRecoveryStreak } from "@/lib/recoveryStreak";
import VprHero from "@/components/vpr/VprHero";
import {
  SectionHeader,
  Metric,
  Delta,
} from "@/components/ui/section";
import { PageHeader } from "@/components/layout/PageShell";
import DailyTrainingCard from "@/components/dashboard/DailyTrainingCard";
import { usePersonalization } from "@/hooks/usePersonalization";
import { supabase } from "@/integrations/supabase/client";

/** VPR factor labels come from the engine in English; map the known ones. */
const useFactorLabel = () => {
  const { t } = useTranslation();
  return (label: string) => {
    const key = label.toLowerCase().replace(/\s+/g, "");
    const known: Record<string, string> = {
      performance: t("vpr.performance"),
      recovery: t("vpr.recovery"),
      skill: t("vpr.skill"),
      consistency: t("vpr.consistency"),
      speed: t("vpr.speedIndex"),
      power: t("vpr.powerIndex"),
      endurance: t("vpr.endurance"),
    };
    return known[key] ?? label;
  };
};

const Insights = () => {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const factorLabel = useFactorLabel();
  const navigate = useNavigate();
  const sys = useVprSystem(profile?.sport?.split(",")[0]?.trim() ?? null, user?.id);
  const [upcoming, setUpcoming] = useState<{ title: string; event_date: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("events")
      .select("title, event_date")
      .eq("user_id", user.id)
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true })
      .limit(1)
      .then(({ data }) => { setUpcoming(data?.[0] ?? null); setLoaded(true); });
  }, [user]);

  if (sys.loading || !loaded) {
    return <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[var(--vaylo-elev-card)] px-3 py-3 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> {t("loading.dashboard")}</div>;
  }

  const insights: { icon: typeof Sparkles; text: string; cta: string; path: string }[] = [];
  const lowest = sys.factors[0];
  if (sys.vpr && lowest && lowest.value < 60) {
    insights.push({
      icon: Sparkles,
      text: t("dashboard.insightLowestFactor", { factor: factorLabel(lowest.label), value: lowest.value, weight: lowest.weight.toFixed(2) }),
      cta: t("dashboard.viewVpr"),
      path: "/vpr",
    });
  }
  if (sys.readiness != null && sys.readiness < 50) {
    insights.push({
      icon: HeartPulse,
      text: t("dashboard.insightReadinessLow", { value: sys.readiness }),
      cta: t("dashboard.openRecovery"),
      path: "/recovery",
    });
  } else if (sys.readiness != null && sys.readinessDelta != null && sys.readinessDelta <= -10) {
    insights.push({
      icon: HeartPulse,
      text: t("dashboard.insightReadinessDropped", { value: Math.abs(sys.readinessDelta) }),
      cta: t("dashboard.openRecovery"),
      path: "/recovery",
    });
  }
  if (upcoming) {
    const days = Math.max(0, Math.ceil((new Date(upcoming.event_date).getTime() - Date.now()) / 86400000));
    insights.push({
      icon: Calendar,
      text: days === 0
        ? t("dashboard.insightEventToday", { title: upcoming.title })
        : days === 1
          ? t("dashboard.insightEventTomorrow", { title: upcoming.title })
          : t("dashboard.insightEventDaysOut", { title: upcoming.title, days }),
      cta: t("dashboard.viewEvents"),
      path: "/events",
    });
  }
  const recoveryStreak = getRecoveryStreak();
  if (recoveryStreak.current >= 3) {
    insights.push({
      icon: Sparkles,
      text: t("dashboard.insightStreak", { days: recoveryStreak.current }),
      cta: t("dashboard.viewMetrics"),
      path: "/recovery",
    });
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[var(--vaylo-elev-card)] p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{t("dashboard.unlockInsights")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {insights.slice(0, 2).map((ins, i) => (
        <motion.button
          key={ins.text}
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          onClick={() => navigate(ins.path)}
          className="press flex w-full items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[var(--vaylo-elev-card)] px-3.5 py-3.5 text-start transition-all hover:bg-white/[0.07] hover:border-white/[0.10]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow border border-white/10 mt-0.5">
            <ins.icon size={16} className="text-primary-foreground" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-start">
            <p className="text-[13.5px] leading-snug">{ins.text}</p>
            {/* Decorative, not a control: the whole row is already a <button>,
                and a button inside a button is invalid DOM — React warns and a
                screen reader announces two targets for one action. The pill
                keeps the affordance; the tap target is the row. */}
            <span
              aria-hidden
              className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[12px] font-bold text-primary"
            >
              {ins.cta}
              <ChevronRight size={12} aria-hidden />
            </span>
          </span>
        </motion.button>
      ))}
    </div>
  );
};

const Index = () => {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("dashboard.goodMorning") : hour < 18 ? t("dashboard.goodAfternoon") : t("dashboard.goodEvening");
  const name = profile?.full_name?.split(" ")[0] || t("dashboard.athleteFallbackName");
  const [showExtras, setShowExtras] = useState(false);

  return (
    <div className="min-h-screen pb-28">
      {/* The greeting is the Home tab's eyebrow and the athlete's name is its
          title — the same PageHeader every other tab and every list screen
          uses, rather than a fourth header size with its own tracking and its
          own trailing space. The only difference left between tabs is the
          words. */}
      <header className="px-5 pt-[var(--vaylo-screen-top)]">
        <PageHeader eyebrow={greeting} icon={Sparkles} title={name} />
      </header>

      <section className="px-5 pb-5 sm:pb-6" aria-label="Your performance">
        <VprHero />
      </section>

      <section className="pb-5 sm:pb-6" aria-label="Today">
        <div className="px-5">
          <SectionHeader title={t("dashboard.today")} onAction={() => navigate("/training")} actionLabel={t("dashboard.plan")} />
        </div>
        <DailyTrainingCard />
      </section>

      <section className="px-5 pb-5 sm:pb-6" aria-label="Readiness">
        <SectionHeader title={t("dashboard.readiness")} icon={HeartPulse} onAction={() => navigate("/recovery")} actionLabel={t("dashboard.checkIn")} />
        <ReadinessStrip />
      </section>

      <section className="px-5 pb-5 sm:pb-6" aria-label="Insights">
        <SectionHeader title={t("dashboard.coachInsight")} icon={Sparkles} />
        <Insights />
      </section>

      <div className="px-5">
        <button
          type="button"
          onClick={() => setShowExtras(!showExtras)}
          aria-expanded={showExtras}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.04] py-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground transition-all hover:bg-white/[0.06] hover:text-foreground hover:border-white/[0.12]"
        >
          {showExtras ? t("dashboard.hideExtras") : t("dashboard.moreForToday")}
          <ChevronRight size={14} className={`transition-transform ${showExtras ? "rotate-90" : ""}`} aria-hidden />
        </button>
      </div>
      {showExtras && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-4 space-y-3 px-5">
          <DailyExtras />
        </motion.div>
      )}
    </div>
  );
};

const ReadinessStrip = () => {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sys = useVprSystem(profile?.sport?.split(",")[0]?.trim() ?? null, user?.id);

  if (sys.loading) return <div className="h-[86px] animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[var(--vaylo-elev-card)]" aria-label="Loading readiness" />;

  if (sys.readiness == null) {
    return (
      <button type="button" onClick={() => navigate("/recovery")} className="press flex w-full items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[var(--vaylo-elev-card)] px-4 py-4 text-start hover:bg-white/[0.06] transition-colors">
        <div className="min-w-0 flex-1 pe-3 text-start">
          <p className="text-sm font-bold">{t("dashboard.noCheckInToday")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("dashboard.noCheckInTodayDesc")}</p>
        </div>
        {/* `whitespace-nowrap` + `shrink-0`: the label is two words and the tile
            beside it is content-sized, so at 390px "Check in" was breaking
            across two lines inside its own button — a two-line pill for a
            two-word label. A control label should never wrap. */}
        {/* A visual twin of SlideAction, not SlideAction itself: the whole
            strip is one <button> (navigation lives here), and a button inside
            a button is invalid DOM — React warns and assistive tech gets two
            targets for one action. The pill here is decoration; the pill as a
            real control stays in the insights rows, which are not buttons. */}
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[12px] font-bold text-primary">
          {t("dashboard.checkIn")}
          <ChevronRight size={12} aria-hidden />
        </span>
      </button>
    );
  }

  const statement =
    sys.readiness >= 85 ? t("dashboard.readyForHardTraining")
      : sys.readiness >= 70 ? t("dashboard.readyToTrain")
      : sys.readiness >= 50 ? t("dashboard.keepItModerate")
      : t("dashboard.prioritiseRecovery");

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[var(--vaylo-elev-card)] px-4 py-4">
      {/* `min-w-0 flex-1`: the readiness statement is a whole sentence and the
          pill beside it is content-sized, so without a floor the sentence used
          to run under the pill instead of wrapping beside it. */}
      <div className="min-w-0 flex-1">
        <Metric
          label={statement}
          value={sys.readiness}
          hint={<Delta value={sys.readinessDelta} unit={t("dashboard.firstCheckIn")} />}
        />
      </div>
      <span
        className="shrink-0 whitespace-nowrap rounded-xl border border-white/[0.06] bg-white/[0.06] px-3 py-2 text-xs font-bold text-foreground"
        aria-hidden
      >
        {t("dashboard.details")}
      </span>
    </div>
  );
};

const DailyExtras = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const rows = [
    { label: t("hub.perform.goals"), desc: t("dashboard.goalsDesc"), path: "/goals", feature: "perform.goals" as const },
    { label: t("hub.compete.challenges"), desc: t("dashboard.challengesDesc"), path: "/challenges", feature: "compete.challenges" as const },
  ];
  const personalization = usePersonalization();
  const visibleRows = personalization.visible(rows);
  return (
    <div className="space-y-2.5">
      {visibleRows.map((r) => (
        <button key={r.path} type="button" onClick={() => navigate(r.path)} className="press flex w-full items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[var(--vaylo-elev-card)] px-4 py-4 text-start hover:bg-white/[0.06] hover:border-white/[0.10] transition-colors">
          <span className="min-w-0 flex-1 pe-3 text-start">
            <span className="block text-sm font-semibold">{r.label}</span>
            <span className="block text-xs leading-relaxed text-muted-foreground">{r.desc}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-muted-foreground rtl-flip" />
        </button>
      ))}
      <p className="px-1 pt-1 text-center text-[12px] leading-relaxed text-muted-foreground">{t("dashboard.extrasNote")}</p>
    </div>
  );
};

export default Index;
