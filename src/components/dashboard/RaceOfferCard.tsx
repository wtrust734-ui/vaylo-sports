import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ageBand } from "@/lib/age";
import { localDateKey } from "@/lib/dates";
import { creditCost } from "@/lib/credits";
import { formatNumber } from "@/i18n/format";

/** How far ahead a race has to be before a plan for it is worth offering. */
const HORIZON_DAYS = 84;
/** Shortest run-in worth a plan; anything closer is too late to plan for. */
const MIN_WEEKS = 2;

type UpcomingRace = { startDate: string; weeks: number };

const daysBetween = (fromKey: string, toKey: string): number => {
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
};

const addDays = (key: string, days: number): string => {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
};

/**
 * Race-season offer. When an athlete has a competition in life_events within the
 * next HORIZON_DAYS, the card names the real run-in and the real credit cost of
 * planning it week by week, and opens the Market. Nothing is discounted or
 * invented: the price is the training_plan_week cost from the shared config.
 *
 * Adult-only, like the other promotional surfaces: a listed price on a plan the
 * athlete asked for is not the nudging a minor is protected from, but a race
 * prompt is a push, and pushes stay with adults.
 */
const RaceOfferCard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdult = ageBand(profile?.date_of_birth) === "adult";
  const [race, setRace] = useState<UpcomingRace | null>(null);

  useEffect(() => {
    if (!user || !isAdult) return;
    let alive = true;
    const today = localDateKey();
    const horizon = addDays(today, HORIZON_DAYS);

    (async () => {
      const { data, error } = await supabase
        .from("life_events")
        .select("start_date")
        .eq("user_id", user.id)
        .eq("event_type", "competition")
        .gte("start_date", today)
        .lte("start_date", horizon)
        .order("start_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!alive || error || !data?.start_date) return;

      const days = daysBetween(today, String(data.start_date));
      const weeks = Math.ceil(days / 7);
      if (weeks < MIN_WEEKS) return;
      setRace({ startDate: String(data.start_date), weeks });
    })();

    return () => {
      alive = false;
    };
  }, [user, isAdult]);

  if (!race) return null;

  const cost = creditCost("training_plan_week", race.weeks);
  const weekWord = race.weeks === 1 ? "week" : "weeks";

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-5 mb-5 rounded-2xl border border-border bg-card p-4"
      aria-label="Race plan"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Trophy size={15} className="text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Race in {race.weeks} {weekWord}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Planning every week to race day is {formatNumber(cost)} credits. Each week is priced on its own,
            so you only pay for the weeks you use.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate("/market")}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-semibold transition-colors hover:border-primary/40"
      >
        See credit packs <ChevronRight size={14} />
      </button>
    </motion.section>
  );
};

export default RaceOfferCard;
