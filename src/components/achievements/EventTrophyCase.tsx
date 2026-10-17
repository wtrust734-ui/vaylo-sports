import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { EVENT_TROPHY_EVENTS, TIER_META, formatRaceTime, trophyRewardId } from "@/lib/eventTrophies";
import { formatShortDate } from "@/i18n/format";

// ============================================================================
// EVENT TROPHY CASE — Bronze/Silver/Gold time-ladder trophies per event
// ----------------------------------------------------------------------------
// Shows one card per timed event (5K, 10K, 40K ride, 1K swim…): each tier is
// either earned (coloured, dated) or locked (showing the time to beat).
//
// THE GATE, which is the rule the athlete asked for: a trophy "shouldn't show
// up if you don't do that sport". So events are filtered by the sports this
// athlete has actually logged in performance_logs — never by a claim on
// onboarding. Log your first Cycling ride and the Cycling cards appear; a
// Basketball player sees no Cycling card at all. The whole section is skipped
// when there is nothing to show, so nobody's trophy case is an empty cabinet.
// ============================================================================

type OwnedMap = Map<string, string>; // reward_id → acquired_at

const EventTrophyCase = () => {
  const { user } = useAuth();
  const [owned, setOwned] = useState<OwnedMap>(new Map());
  const [loggedSports, setLoggedSports] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [ownedRes, sportsRes] = await Promise.all([
        supabase.from("user_rewards").select("reward_id, acquired_at").eq("user_id", user.id).eq("category", "event_trophy"),
        supabase.from("performance_logs").select("sport").eq("user_id", user.id),
      ]);
      if (cancelled) return;
      const map: OwnedMap = new Map(
        (ownedRes.data ?? []).map((r) => [r.reward_id, r.acquired_at]),
      );
      const sports = Array.from(
        new Set((sportsRes.data ?? []).map((r) => (r.sport ?? "").trim()).filter(Boolean)),
      );
      setOwned(map);
      setLoggedSports(sports);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Gate: keep only events whose sport the athlete has logged.
  const events = useMemo(
    () =>
      EVENT_TROPHY_EVENTS.filter((e) => {
        const lower = e.sport.toLowerCase();
        return loggedSports.some((s) => s.toLowerCase() === lower);
      }),
    [loggedSports],
  );

  // Any eventId the athlete earned a trophy for stays visible even if the sport
  // string later drifts (e.g. logged as "running" once and "Running" now) —
  // earned things never vanish.
  const earnedEvents = useMemo(
    () =>
      EVENT_TROPHY_EVENTS.filter((e) =>
        e.tiers.some((t) => owned.has(trophyRewardId(e.id, t.tier))),
      ),
    [owned],
  );
  const visible = useMemo(() => {
    const seen = new Set(events.map((e) => e.id));
    return [...events, ...earnedEvents.filter((e) => !seen.has(e.id))];
  }, [events, earnedEvents]);

  // Signed out, empty wall, or a sport the ladder simply does not time — the
  // honest result is that there is no trophy case to show at all.
  if (!loaded || visible.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} className="text-primary" />
        <h2 className="text-lg font-display font-bold">Trophy Case</h2>
        <span className="text-[12px] text-muted-foreground">Times by event</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visible.map((e, i) => {
          const hasAny = e.tiers.some((t) => owned.has(trophyRewardId(e.id, t.tier)));
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`bg-card border rounded-2xl p-4 ${hasAny ? "border-primary/30" : "border-border"}`}
            >
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{e.sport}</p>
              <p className="font-semibold text-sm mt-0.5">{e.label.replace(`${e.sport} · `, "")}</p>
              <div className="mt-3 space-y-1.5">
                {["gold", "silver", "bronze"].map((tier) => {
                  const def = e.tiers.find((t) => t.tier === tier)!;
                  const meta = TIER_META[def.tier];
                  const at = owned.get(trophyRewardId(e.id, def.tier));
                  return (
                    <div key={def.tier}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border"
                      style={at ? { borderColor: meta.color, backgroundColor: `${meta.color}14` } : undefined}>
                      <span className="text-[12px] font-semibold uppercase tracking-wider"
                        style={{ color: at ? meta.color : undefined }}>
                        {at ? "🏆" : "🔒"} {meta.label}
                      </span>
                      {at ? (
                        <span className="text-[11px] text-muted-foreground">{formatShortDate(`${at.slice(0, 10)}T00:00:00`)}</span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          sub {formatRaceTime(def.time_seconds)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default EventTrophyCase;
