// ============================================================================
// useActiveBreak — the availability window covering today, if any
// ----------------------------------------------------------------------------
// One reader behind every "you are on a break right now" surface. The 2026-10-06
// audit found an active holiday was visible on /availability and nowhere else:
// the dashboard and the plan screen both said "No training plan yet" while a
// break sat in the athlete's calendar (finding B1).
//
// Deliberately a plain live read, not the offline queue: it renders a banner,
// never a write, and the two surfaces that use it already read live rows the
// same way. When several windows overlap, a training-stopping one wins — a
// banner reading "busy period" while the athlete has the flu would understate
// the very thing it exists to say.
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { dayKey, type LifeEvent } from "@/lib/lifeEvents";

export function useActiveBreak(): LifeEvent | null {
  const { user } = useAuth();
  const [event, setEvent] = useState<LifeEvent | null>(null);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setEvent(null);
      return () => {
        alive = false;
      };
    }
    const today = dayKey(new Date());
    void supabase
      .from("life_events")
      .select("*")
      .eq("user_id", user.id)
      .lte("start_date", today)
      .gte("end_date", today)
      .order("start_date", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (!alive) return;
        const rows = (data ?? []) as unknown as LifeEvent[];
        setEvent(rows.find((r) => r.allow_training === "no") ?? rows[0] ?? null);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  return event;
}
