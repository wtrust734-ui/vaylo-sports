import { useTranslation } from "react-i18next";
import { HeartPulse, Apple, Brain, ShieldAlert, Moon, Watch } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HubPage } from "@/components/layout/HubPage";

/**
 * RECOVER hub — adaptation lives here: readiness, fuel, mind, and injury.
 */
const Recover = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <HubPage
      icon={HeartPulse}
      title={t("hub.recover.title")}
      subtitle={t("hub.recover.subtitle")}
      primary={
        <button
          type="button"
          onClick={() => navigate("/recovery")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-glow"
        >
          <Moon size={16} /> {t("hub.recover.primaryCta")}
        </button>
      }
      groups={[
        {
          title: t("hub.recover.groupRecovery"),
          links: [
            { icon: HeartPulse, label: t("hub.recover.recovery"), description: t("hub.recover.recoveryDesc"), path: "/recovery" },
            { icon: Watch, label: t("hub.recover.wearables"), description: t("hub.recover.wearablesDesc"), path: "/health-sync" },
            { icon: Brain, label: t("hub.recover.mental"), description: t("hub.recover.mentalDesc"), path: "/mental" },
            { icon: ShieldAlert, label: t("hub.recover.injury"), description: t("hub.recover.injuryDesc"), path: "/injury" },
          ],
        },
        {
          title: t("hub.recover.groupFuel"),
          links: [
            { icon: Apple, label: t("hub.recover.nutrition"), description: t("hub.recover.nutritionDesc"), path: "/nutrition" },
          ],
        },
      ]}
    />
  );
};

export default Recover;
