// ============================================================================
// ActiveBreakBanner — "there is an availability window covering today"
// ----------------------------------------------------------------------------
// Shared by the dashboard card and the plan screen so an active break is
// visible wherever the athlete lands, not only on /availability (2026-10-06
// audit, finding B1). Always links to /availability: that is where a break is
// managed, and where the rest of its effects are explained.
// ============================================================================

import { Link } from "react-router-dom";
import { ArrowRight, CalendarOff } from "lucide-react";
import { formatPeriod, lifeEventType, type LifeEvent } from "@/lib/lifeEvents";

export default function ActiveBreakBanner({ event }: { event: LifeEvent }) {
  const label = lifeEventType(event.event_type).label;
  const paused = event.allow_training === "no";
  return (
    <Link
      to="/availability"
      className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.08] px-3.5 py-3 transition-colors hover:bg-primary/[0.12]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
        <CalendarOff size={15} className="text-primary-foreground" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">
          {label} · {formatPeriod(event.start_date, event.end_date)}
        </span>
        <span className="block text-[12px] text-muted-foreground">
          {paused
            ? "Training is paused for this window."
            : "Availability is set for this window."}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-primary">
        Manage <ArrowRight size={13} aria-hidden />
      </span>
    </Link>
  );
}
