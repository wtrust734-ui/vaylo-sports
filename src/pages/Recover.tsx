import { useTranslation } from "react-i18next";
import { HeartPulse, Apple, Brain, ShieldAlert, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HubPage } from "@/components/layout/HubPage";
import { useHubGroups } from "@/hooks/useHubPersonalization";
import { useSubscription } from "@/contexts/SubscriptionContext";

/**
 * RECOVER hub — adaptation lives here: readiness, fuel, mind, and injury.
 * Filtered per athlete by sport family; nutrition shows for every family.
 */
const Recover = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Same lock preview as the Train hub: bought unlocks show a lock until
  // owned, and the pages themselves enforce it.
  const { hasFeature } = useSubscription();

  const groups = useHubGroups([
    {
      title: t("hub.recover.groupRecovery"),
      links: [
        { icon: HeartPulse, label: t("hub.recover.recovery"), description: t("hub.recover.recoveryDesc"), path: "/recovery", feature: "recover.recovery" },
        { icon: Brain, label: t("hub.recover.mental"), description: t("hub.recover.mentalDesc"), path: "/mental", feature: "recover.mental", locked: !hasFeature("mental_gym") },
        { icon: ShieldAlert, label: t("hub.recover.injury"), description: t("hub.recover.injuryDesc"), path: "/injury", feature: "recover.injury", locked: !hasFeature("injury_management") },
      ],
    },
    {
      title: t("hub.recover.groupFuel"),
      links: [
        { icon: Apple, label: t("hub.recover.nutrition"), description: t("hub.recover.nutritionDesc"), path: "/nutrition", feature: "recover.nutrition" },
      ],
    },
  ]);

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
      groups={groups}
    />
  );
};

export default Recover;
