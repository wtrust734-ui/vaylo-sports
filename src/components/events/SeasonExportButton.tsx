import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { buildSeasonIcs, type SeasonRace } from "@/lib/eventFeed";
import { flattenPlan, type TrainingPlanLike } from "@/lib/planSchedule";

/**
 * "Your season, in your calendar." Pulls the athlete's active training plan
 * and their events, merges them through buildSeasonIcs, downloads client-side.
 *
 * Deliberately self-contained (one fetch of two rows of data, straight to a
 * blob) rather than a settings page per sport: the file is the feature. An
 * athlete with no plan still gets their races; an athlete with no events
 * still gets their plan.
 */
const SeasonExportButton = () => {
  const { user } = useAuth();
  const [races, setRaces] = useState<SeasonRace[]>([]);
  const [plan, setPlan] = useState<TrainingPlanLike | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;

    void (async () => {
      const [{ data: evData }, { data: planData }] = await Promise.all([
        supabase.from("events").select("title, event_date").eq("user_id", user.id).order("event_date"),
        supabase
          .from("training_plans")
          .select("id, title, week_current, duration_weeks, plan_data, created_at")
          .eq("user_id", user.id)
          .eq("active", true)
          .limit(1)
          .maybeSingle(),
      ]);
      if (!alive) return;
      setRaces(
        ((evData ?? []) as Array<{ title: string; event_date: string }>)
          .filter((e) => e.event_date)
          .map((e) => ({ date: e.event_date, title: e.title })),
      );
      setPlan((planData as unknown as TrainingPlanLike) ?? null);
    })();

    return () => {
      alive = false;
    };
  }, [user]);

  if (!user || (races.length === 0 && !plan)) return null;

  const download = () => {
    setBusy(true);
    try {
      const sessions = plan ? flattenPlan(plan) : [];
      const title = plan?.title ?? "Your season";
      const text = buildSeasonIcs(title, sessions, races);
      const blob = new Blob([text], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vaylo-season.ics";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      title="Download your season as a calendar file (.ics) for your phone, computer or watch"
    >
      <Calendar size={13} /> Add season to calendar
    </button>
  );
};

export default SeasonExportButton;
