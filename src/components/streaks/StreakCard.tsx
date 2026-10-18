import { Flame } from "lucide-react";
import { useStreakPanel } from "@/lib/streakRewards";
import { useNavigate } from "react-router-dom";

/**
 * Dashboard streak tile — links into the full Streaks screen. Data comes from
 * the same server RPC as the screen; nothing is estimated client-side.
 */
export default function StreakCard() {
  const { panel } = useStreakPanel();
  const navigate = useNavigate();

  const current = panel?.current_streak ?? 0;
  const next = panel?.next_milestone;

  return (
    <button
      onClick={() => navigate("/streaks")}
      className="mx-5 flex w-[calc(100%-2.5rem)] items-center gap-3 rounded-[22px] border border-white/[0.07] bg-card/70 px-4 py-3 text-left sm:bg-card/60 sm:backdrop-blur-xl overflow-hidden"
      aria-label={`Streak: ${current} days. Open your streak rewards.`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-energy/20">
        <Flame size={20} className="text-energy" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{current} day{current === 1 ? "" : "s"} — your streak</span>
        <span className="block truncate text-xs text-muted-foreground">
          {next && next.remaining > 0
            ? `${next.remaining} more day${next.remaining === 1 ? "" : "s"} to ${next.name} (+${next.xp} XP)`
            : "Open your streak rewards"}
        </span>
      </span>
      <span aria-hidden className="text-muted-foreground">→</span>
    </button>
  );
}
