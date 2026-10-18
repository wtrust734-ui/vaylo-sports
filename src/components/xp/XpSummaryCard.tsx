import { useEffect, useState } from "react";
import { TrendingUp, Zap } from "lucide-react";
import { useXpProfile, xpThreshold, fetchXpHistory, XP_KIND_LABELS, type XpTransaction } from "@/lib/xp";
import { formatDate } from "@/i18n/format";

/**
 * The XP summary card: current level, total XP, progress towards the next
 * level, recent XP activity and a plain-language explanation of how XP works.
 * Progression only — no currency, no purchases, no leaderboard.
 */
export default function XpSummaryCard() {
  const { profile, loading } = useXpProfile();
  const [history, setHistory] = useState<XpTransaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!showHistory) return;
    void fetchXpHistory(20).then(setHistory);
  }, [showHistory, profile?.total_xp]);

  if (loading) {
    return (
      <div className="card-surface mx-5 mb-5 rounded-2xl border border-border p-4">
        <p className="text-[12px] text-muted-foreground">Loading your progress…</p>
      </div>
    );
  }

  const level = profile?.level ?? 1;
  const totalXp = profile?.total_xp ?? 0;
  const intoLevel = profile?.xp_into_level ?? 0;
  const forNext = profile?.xp_for_next_level ?? xpThreshold(level + 1) - xpThreshold(level);
  const toNext = profile?.xp_to_next_level ?? forNext - intoLevel;
  const pct = forNext > 0 ? Math.min(100, Math.round((intoLevel / forNext) * 100)) : 0;

  return (
    <div className="card-surface mx-5 mb-5 rounded-2xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wider text-electric-purple">Athlete level</p>
          <p className="font-display font-bold text-lg">
            Level {level} · {totalXp.toLocaleString()} XP total
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {toNext > 0
              ? `${toNext.toLocaleString()} XP to Level ${level + 1}`
              : "Level complete — next tier unlocks with more XP"}
          </p>
        </div>
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-electric-purple/15 text-lg font-black text-electric-purple"
          aria-label={`Level ${level}`}
        >
          {level}
        </span>
      </div>

      <div className="mt-3">
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress to level ${level + 1}`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-electric-purple transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {forNext > 0 ? `${intoLevel.toLocaleString()} / ${forNext.toLocaleString()} XP into this level` : ""}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        aria-expanded={showHistory}
        className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-primary"
      >
        <TrendingUp size={12} /> {showHistory ? "Hide recent XP" : "Recent XP"}
      </button>

      {showHistory && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          {history.length === 0 && (
            <p className="py-2 text-[12px] text-muted-foreground">
              No XP yet — train, check in on recovery days or finish a lesson.
            </p>
          )}
          {history.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                {t.reason ?? XP_KIND_LABELS[t.kind as keyof typeof XP_KIND_LABELS] ?? t.kind}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatDate(t.created_at, { month: "short", day: "numeric" })}
              </span>
              <span className={`shrink-0 font-bold ${t.xp_amount >= 0 ? "text-electric-purple" : "text-destructive"}`}>
                {t.xp_amount >= 0 ? "+" : ""}
                {t.xp_amount}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-white/[0.03] p-2.5 text-[11px] leading-5 text-muted-foreground">
        <Zap size={12} className="mt-0.5 shrink-0 text-electric-purple" aria-hidden />
        <span>
          XP tracks your progression — completed sessions, recovery days, lessons
          and training goals. It is not money or credits, cannot be bought or
          sold, and never expires. Rest days count: a recovery check-in is enough.
        </span>
      </p>
    </div>
  );
}
