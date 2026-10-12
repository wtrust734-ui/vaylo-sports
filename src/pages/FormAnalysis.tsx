import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ScanLine, ChevronRight, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { creditCost } from "@/lib/credits";
import { DISCLAIMERS } from "@/config/disclaimers";
import { usePersonalization } from "@/hooks/usePersonalization";
import {
  drillsForFamilies,
  isSportUnknown,
  sportDrillsFor,
  foundationDrills,
  type DrillFamily,
  type FormDrill,
} from "@/lib/formDrills";

/**
 * FORM — the technique tab, available to every athlete.
 *
 * Two halves, and the difference between them is the price model:
 *
 *   * The drills and cues are FREE and personal. What is listed is chosen from
 *     the athlete's own sport family (src/lib/formDrills.ts), so a runner reads
 *     running work and a lifter reads lifting work, and neither is handed the
 *     other's. An athlete whose sport the app cannot classify gets the whole
 *     library rather than an empty tab — the same fail-open rule the
 *     personalisation engine uses everywhere else.
 *   * The AI analysis is the paid half: video-only and strictly per analysis,
 *     there is no photo upload and no unlimited unlock on this screen, because
 *     a flat rate on a metered video call loses money. The price comes from the
 *     credit config rather than the button copy, so the two cannot drift.
 *
 * The paid card sits BELOW the drills on purpose. The tab is for everyone, and
 * an athlete who will never buy an analysis should still meet the free half
 * first rather than a paywall with a list underneath it.
 */
const FormAnalysis = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const videoCost = creditCost("video_form_analysis");
  // `active` is the "Show everything" escape hatch as well as the no-sport case:
  // either way the athlete asked for, or needs, the unfiltered app.
  const { athlete, families, active } = usePersonalization();

  const drillFamilies = useMemo<DrillFamily[]>(
    () => (active ? families : ["*"]),
    [active, families],
  );
  const unknownSport = isSportUnknown(drillFamilies);
  const drills = useMemo(() => drillsForFamilies(drillFamilies), [drillFamilies]);
  const ownDrills = useMemo(() => sportDrillsFor(drillFamilies), [drillFamilies]);
  const sharedDrills = useMemo(() => foundationDrills(), []);
  const sportLabel = athlete.sports.slice(0, 3).join(", ");

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">
          {t("form.title")}
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">
          {t("form.subtitle")}
        </motion.p>
      </div>

      {/* Free drills and cues — personalised to the athlete's sport. */}
      <div className="px-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("form.drillsTitle")}</h2>
          <span className="text-[11px] font-bold uppercase tracking-wider text-success bg-success/10 border border-success/20 rounded-full px-2 py-0.5">
            {t("form.free")}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">
          {unknownSport ? t("form.allSports") : t("form.tunedFor", { sport: sportLabel })}
        </p>

        {unknownSport ? (
          <div className="space-y-2 mb-6">
            {drills.map((drill, i) => (
              <DrillCard key={drill.id} drill={drill} index={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-5 mb-6">
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-electric-purple mb-2">
                {t("form.foundations")}
              </h3>
              <div className="space-y-2">
                {sharedDrills.map((drill, i) => (
                  <DrillCard key={drill.id} drill={drill} index={i} />
                ))}
              </div>
            </section>
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-electric-purple mb-2">
                {t("form.yourSport")}
              </h3>
              <div className="space-y-2">
                {ownDrills.map((drill, i) => (
                  <DrillCard key={drill.id} drill={drill} index={i} />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* AI Form Analysis — video only, per analysis. No photo upload, no
          unlimited unlock: a flat rate on a metered video call loses money, so
          every analysis carries its own price, stated on the button. */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mx-5 bg-gradient-card border border-electric-purple/20 rounded-2xl p-4 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <ScanLine size={16} className="text-electric-purple" />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-electric-purple">{t("form.analysisBadge")}</span>
        </div>
        <h3 className="font-display font-bold text-lg mb-1">{t("form.analysisTitle")}</h3>
        <p className="text-sm text-muted-foreground mb-3">{t("form.analysisBody", { cost: videoCost })}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground mb-3">
          {DISCLAIMERS.formAnalysis.full}
        </p>
        <motion.button whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/form/video")}
          className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
          <Video size={18} /> {t("form.analysisCta", { cost: videoCost })}
        </motion.button>
      </motion.div>
    </div>
  );
};

/**
 * One drill, collapsed to its name and what it is, expanded to the why, the
 * how-to and the cues. An accordion rather than a page per drill: the athlete
 * reads these standing in a gym or on a track, and a drill they can scan is a
 * drill they will actually do.
 */
const DrillCard = ({ drill, index }: { drill: FormDrill; index: number }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full p-3 flex items-center justify-between gap-3 text-start"
      >
        <div className="min-w-0">
          <h4 className="font-semibold text-sm">{drill.title}</h4>
          <p className="text-[12px] text-muted-foreground">{drill.what}</p>
        </div>
        <motion.div animate={{ rotate: open ? 90 : 0 }} className="shrink-0">
          <ChevronRight size={14} className="text-muted-foreground" />
        </motion.div>
      </button>

      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className="px-3 pb-3 border-t border-border pt-3 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-electric-purple mb-1">{t("form.why")}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{drill.why}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-electric-purple mb-1">{t("form.how")}</p>
            <ol className="space-y-1.5">
              {drill.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="w-5 h-5 rounded-full bg-electric-purple/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[12px] font-bold text-electric-purple">{i + 1}</span>
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-electric-purple mb-1">{t("form.cues")}</p>
            <div className="flex flex-wrap gap-1.5">
              {drill.cues.map((cue, i) => (
                <span key={i} className="text-[12px] rounded-lg bg-electric-purple/10 border border-electric-purple/20 px-2 py-1">
                  {cue}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default FormAnalysis;
