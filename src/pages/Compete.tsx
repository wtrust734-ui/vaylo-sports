import { useTranslation } from "react-i18next";
import { Swords, Flag, Calendar, Trophy, Users, Gamepad2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HubPage } from "@/components/layout/HubPage";

/**
 * COMPETE hub — everything about testing yourself against others.
 */
const Compete = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <HubPage
      icon={Swords}
      title={t("hub.compete.title")}
      subtitle={t("hub.compete.subtitle")}
      primary={
        <button
          type="button"
          onClick={() => navigate("/events")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-glow"
        >
          <Calendar size={16} /> {t("hub.compete.primaryCta")}
        </button>
      }
      groups={[
        {
          title: t("hub.compete.groupCompetitions"),
          links: [
            { icon: Calendar, label: t("hub.compete.events"), description: t("hub.compete.eventsDesc"), path: "/events" },
            { icon: Flag, label: t("hub.compete.challenges"), description: t("hub.compete.challengesDesc"), path: "/challenges" },
            { icon: Users, label: t("hub.compete.opponents"), description: t("hub.compete.opponentsDesc"), path: "/opponents" },
          ],
        },
        {
          title: t("hub.compete.groupRankings"),
          links: [
            { icon: Trophy, label: t("hub.compete.leaderboard"), description: t("hub.compete.leaderboardDesc"), path: "/leaderboard" },
            { icon: Swords, label: t("hub.compete.eventRivals"), description: t("hub.compete.eventRivalsDesc"), path: "/events" },
            { icon: Gamepad2, label: t("hub.compete.arcade"), description: t("hub.compete.arcadeDesc"), path: "/arcade" },
          ],
        },
      ]}
    />
  );
};

export default Compete;
