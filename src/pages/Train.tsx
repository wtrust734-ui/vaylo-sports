import { useTranslation } from "react-i18next";
import { Dumbbell, Activity, Timer, Flame, ScanLine, Eye, Shuffle, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { HubPage } from "@/components/layout/HubPage";

/**
 * TRAIN hub — every destination here is the existing page; nothing was rewritten
 * or moved on disk, only grouped.
 */
const Train = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <HubPage
      icon={Dumbbell}
      title={t("hub.train.title")}
      subtitle={t("hub.train.subtitle")}
      primary={
        <button
          type="button"
          onClick={() => navigate("/workouts")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-glow"
        >
          <Play size={16} className="fill-primary-foreground" /> {t("hub.train.primaryCta")}
        </button>
      }
      groups={[
        {
          title: t("hub.train.groupDaily"),
          links: [
            { icon: Activity, label: t("hub.train.workouts"), description: t("hub.train.workoutsDesc"), path: "/workouts" },
            { icon: Zap, label: t("hub.train.trainingPlans"), description: t("hub.train.trainingPlansDesc"), path: "/training" },
            { icon: Timer, label: t("hub.train.routines"), description: t("hub.train.routinesDesc"), path: "/routines" },
            { icon: Shuffle, label: t("hub.train.crossTraining"), description: t("hub.train.crossTrainingDesc"), path: "/cross-training" },
          ],
        },
        {
          title: t("hub.train.groupProgress"),
          links: [
            { icon: Flame, label: t("hub.train.pbs"), description: t("hub.train.pbsDesc"), path: "/pbs" },
            { icon: ScanLine, label: t("hub.train.formAnalysis"), description: t("hub.train.formAnalysisDesc"), path: "/form" },
            { icon: Eye, label: t("hub.train.arOverlay"), description: t("hub.train.arOverlayDesc"), path: "/ar-overlay" },
          ],
        },
      ]}
    />
  );
};

export default Train;
