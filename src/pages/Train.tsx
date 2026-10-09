import { useTranslation } from "react-i18next";
import { Dumbbell, Timer, Flame, ScanLine, Shuffle, Zap, CalendarRange, ClipboardList } from "lucide-react";
import { HubPage } from "@/components/layout/HubPage";
import { useHubGroups } from "@/hooks/useHubPersonalization";

/**
 * TRAIN hub — every destination here is the existing page; nothing was rewritten
 * or moved on disk, only grouped. Links are filtered per athlete: a runner
 * never sees technique-first surfaces they can't use.
 */
const Train = () => {
  const { t } = useTranslation();

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
        { icon: Timer, label: t("hub.train.routines"), description: t("hub.train.routinesDesc"), path: "/routines", feature: "training.routines" },
        { icon: Shuffle, label: t("hub.train.crossTraining"), description: t("hub.train.crossTrainingDesc"), path: "/cross-training", feature: "training.crossTraining" },
      ],
    },
    {
      title: t("hub.train.groupProgress"),
      links: [
        { icon: Flame, label: t("hub.train.pbs"), description: t("hub.train.pbsDesc"), path: "/pbs", feature: "training.pbs" },
        { icon: ScanLine, label: t("hub.train.formAnalysis"), description: t("hub.train.formAnalysisDesc"), path: "/form", feature: "training.form" },
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
