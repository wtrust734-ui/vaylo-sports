import { useTranslation } from "react-i18next";
import { Gauge, Activity, Target, TrendingUp, Fingerprint, Crosshair, Scale } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HubPage } from "@/components/layout/HubPage";

/**
 * PERFORM hub — the measurement side of the app: your VPR and everything it is
 * built from.
 */
const Perform = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <HubPage
      icon={Gauge}
      title={t("hub.perform.title")}
      subtitle={t("hub.perform.subtitle")}
      primary={
        <button
          type="button"
          onClick={() => navigate("/vpr")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-glow"
        >
          <Gauge size={16} /> {t("hub.perform.primaryCta")}
        </button>
      }
      groups={[
        {
          title: t("hub.perform.groupPerformance"),
          links: [
            { icon: Gauge, label: t("hub.perform.vpr"), description: t("hub.perform.vprDesc"), path: "/vpr" },
            { icon: Activity, label: t("hub.perform.metricsHub"), description: t("hub.perform.metricsHubDesc"), path: "/metrics" },
            { icon: Target, label: t("hub.perform.skills"), description: t("hub.perform.skillsDesc"), path: "/skills" },
            { icon: TrendingUp, label: t("hub.perform.development"), description: t("hub.perform.developmentDesc"), path: "/development" },
          ],
        },
        {
          title: t("hub.perform.groupAthleteProfile"),
          links: [
            { icon: Fingerprint, label: t("hub.perform.identity"), description: t("hub.perform.identityDesc"), path: "/identity" },
            { icon: Crosshair, label: t("hub.perform.goals"), description: t("hub.perform.goalsDesc"), path: "/goals" },
            { icon: Scale, label: t("hub.perform.compare"), description: t("hub.perform.compareDesc"), path: "/compare" },
          ],
        },
      ]}
    />
  );
};

export default Perform;
