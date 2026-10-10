import { useTranslation } from "react-i18next";
import { Dumbbell, Flame, ScanLine, Zap, CalendarRange, ClipboardList, Gamepad2, Apple, Brain, ShieldAlert } from "lucide-react";
import { HubPage } from "@/components/layout/HubPage";
import { useHubGroups } from "@/hooks/useHubPersonalization";
import { useSubscription } from "@/contexts/SubscriptionContext";

/**
 * TRAIN hub — every destination here is the existing page; nothing was rewritten
 * or moved on disk, only grouped. Links are filtered per athlete: a runner
 * never sees technique-first surfaces they can't use.
 */
const Train = () => {
  const { t } = useTranslation();
  // Bought unlocks open from here, not from the Market: the tile is always
  // listed and wears a lock until hasFeature() says it is owned (Unlimited
  // counts, same as the pages themselves check). Nutrition is a standard tab
  // with per-use charges, so it is never locked.
  const { hasFeature } = useSubscription();

  const groups = useHubGroups([
    {
      title: t("hub.train.groupDaily"),
      links: [
        { icon: Zap, label: t("hub.train.trainingPlans"), description: t("hub.train.trainingPlansDesc"), path: "/training", feature: "training.plans" },
        // Recording a finished session sits with the plan rather than in a
        // settings menu: it is the raw material the plan is adapted from.
        { icon: ClipboardList, label: t("hub.train.workouts"), description: t("hub.train.workoutsDesc"), path: "/workouts", feature: "training.workouts" },
        // Listed with the plan, not in a settings menu: recording a break is a
        // normal part of training, and an athlete who cannot find it will just
        // train through the holiday.
        { icon: CalendarRange, label: t("hub.train.availability"), description: t("hub.train.availabilityDesc"), path: "/availability", feature: "training.availability" },
        // Fuel is daily work, so nutrition lives here as well as under
        // Recover: one entry point from the bottom bar, no purchase ever.
        // The page unifies the nutrition plan builder and the AI calorie
        // scan in a single tab.
        { icon: Apple, label: t("hub.recover.nutrition"), description: t("hub.recover.nutritionDesc"), path: "/nutrition", feature: "recover.nutrition" },
        // Bought unlocks, openable the moment they are owned. The pages
        // carry their own paywalls; the lock here is the honest preview.
        { icon: Brain, label: t("hub.recover.mental"), description: t("hub.recover.mentalDesc"), path: "/mental", feature: "recover.mental", locked: !hasFeature("mental_gym") },
        { icon: ShieldAlert, label: t("hub.recover.injury"), description: t("hub.recover.injuryDesc"), path: "/injury", feature: "recover.injury", locked: !hasFeature("injury_management") },
      ],
    },
    {
      title: t("hub.train.groupProgress"),
      links: [
        { icon: Flame, label: t("hub.train.pbs"), description: t("hub.train.pbsDesc"), path: "/pbs", feature: "training.pbs" },
        { icon: ScanLine, label: t("hub.train.formAnalysis"), description: t("hub.train.formAnalysisDesc"), path: "/form", feature: "training.form" },
        // The reaction-time, memory and accuracy mini games. They train the
        // mental side of performance (reaction, peripheral vision, timing),
        // so they sit with training rather than only under Compete.
        { icon: Gamepad2, label: t("hub.train.miniGames"), description: t("hub.train.miniGamesDesc"), path: "/arcade", feature: "compete.arcade" },
      ],
    },
  ]);

  // No `primary` CTA, and it stays that way. The one that was here said
  // "Start workout" and opened the workout logger; there is still nothing in
  // this app that can start one — no location permission is declared, so a live
  // session would have no route and no distance. Logging a finished session is
  // a row in the groups below, not a button that appears to do more than it can.
  return (
    <HubPage
      icon={Dumbbell}
      title={t("hub.train.title")}
      subtitle={t("hub.train.subtitle")}
      groups={groups}
    />
  );
};

export default Train;
