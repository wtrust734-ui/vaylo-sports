import { useStreakPanel } from "@/lib/streakRewards";
import { useAuth } from "@/contexts/AuthContext";
import { appHref } from "@/lib/routerBase";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Flame, Trophy, ChevronLeft, Calendar, ShieldCheck, Sparkles, CheckCircle2, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";

// ============================================================================
// STREAKS — the one screen that explains everything
// ----------------------------------------------------------------------------
// All data comes from the server's streak_panel() RPC: the run, the milestones
// (their names and XP amounts are configured rows, not copies of hard-coded
// values), and the honest history. The client adds no XP numbers of its own.
// ============================================================================

const QUALIFIES = [
  "Completing a scheduled training session",
  "Completing a scheduled recovery or mobility check-in",
  "Completing a validated learning activity (knowledge check)",
  "Completing your weekly training-plan goal",
  "A scheduled rest or active-recovery day in your plan (no exercise needed)",
];

const RULES = [
  "The day counts where you actually are — your local calendar, not a server clock.",
  "Missing a whole day ends the run; your longest streak is never taken away.",
  "Each milestone reward is granted once per account, even after a streak restart.",
  "Duplicate submissions, forced backdates and device-date changes are rejected server-side.",
];

export default function Streaks() {
  const { user, loading: authLoading } = useAuth();
  const { panel, loading } = useStreakPanel();
  const navigate = useNavigate();

  if (authLoading || loading) {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading your streak…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-2">Streaks</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to start building your streak.</p>
        <Button onClick={() => navigate("/auth")}>Sign in</Button>
      </div>
    );
  }
  const p = panel;

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        aria-label="Back"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <h1 className="text-2xl font-display font-bold flex items-center gap-2 mb-1">
        <Flame className="h-6 w-6 text-energy" /> Streaks
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        Show up most days in a way that is actually healthy — training, recovery, learning or a scheduled rest all count.
      </p>

      {/* Current + longest */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl border border-energy/40 bg-energy/10 p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Current streak</p>
          <p className="text-3xl font-bold flex items-center gap-2">
            <Flame size={22} className="text-energy" />
            {p?.current_streak ?? 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">days in a row</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Longest streak</p>
          <p className="text-3xl font-bold">{p?.longest_streak ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">days — yours forever</p>
        </div>
      </div>

      {/* Next milestone */}
      {p?.next_milestone && p.next_milestone.remaining > 0 && (
        <div className="rounded-2xl border border-electric-purple/40 bg-electric-purple/10 p-4 mb-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Next reward</p>
          <p className="text-sm font-semibold">{p.next_milestone.name}</p>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{
                width: `${Math.min(100, Math.round(((p.next_milestone.days - p.next_milestone.remaining) / p.next_milestone.days) * 100))}%`,
              }}
              transition={{ duration: 0.5 }}
              className="h-full bg-gradient-to-r from-electric-purple to-energy"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {p.next_milestone.remaining} more day{p.next_milestone.remaining === 1 ? "" : "s"} — {p.next_milestone.xp} XP waiting
          </p>
        </div>
      )}

      {/* The eight milestones */}
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Milestone rewards</h2>
      <ul className="space-y-2 mb-6">
        {(p?.milestones ?? []).map((m) => (
          <li
            key={m.kind}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
              m.earned ? "border-energy/50 bg-energy/10" : "border-border bg-card"
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              m.earned ? "bg-energy/25 text-energy" : "bg-muted text-muted-foreground"
            }`}>
              {m.earned ? <CheckCircle2 size={18} /> : <Lock size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-semibold ${m.earned ? "text-foreground" : "text-muted-foreground"}`}>
                {m.name}
              </span>
              <span className="block text-xs text-muted-foreground">{m.days} consecutive days</span>
            </span>
            <span className={`text-sm font-bold ${m.earned ? "text-energy" : ""}`}>{m.xp} XP</span>
          </li>
        ))}
      </ul>

      {/* History */}
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
        <Calendar size={14} /> Recent qualifying days
      </h2>
      {p && p.history.length > 0 ? (
        <ul className="mb-6 space-y-1.5">
          {p.history.slice(0, 20).map((h) => (
            <li key={h.day} className="flex items-center justify-between rounded-xl bg-card border border-border px-3 py-2 text-sm">
              <span className="font-mono text-xs">{h.day}</span>
              <span className="text-xs text-muted-foreground">
                {h.source === "rest_day"
                  ? `Rest day${h.detail?.reason ? ` — ${h.detail.reason}` : ""}`
                  : h.source.replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground mb-6">No qualifying days recorded yet — complete any session or check-in to start.</p>
      )}

      {/* Rules — honest, spelled out */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-4">
        <h2 className="text-sm font-bold mb-2 flex items-center gap-2">
          <ShieldCheck size={16} className="text-primary" /> What counts
        </h2>
        <ul className="space-y-1.5">
          {QUALIFIES.map((q) => (
            <li key={q} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" /> {q}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 mb-4">
        <h2 className="text-sm font-bold mb-2 flex items-center gap-2">
          <ShieldCheck size={16} className="text-primary" /> The rules
        </h2>
        <ul className="space-y-1.5">
          {RULES.map((r) => (
            <li key={r} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-primary" /> {r}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Rest days are part of training. Nothing here pushes you to train through injury, illness or pain — a scheduled recovery or
          rest day keeps your streak alive without a single kilometre.
        </p>
      </div>

      {/* The catalogue lives on Achievements; what is already earned is in the
          Trophy Room. This goes to the catalogue, because a streak page is a
          reason to look at what else can be earned. */}
      <a
        href={appHref("/achievements")}
        className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold"
      >
        <span className="flex items-center gap-2"><Trophy size={16} /> See all achievements</span>
        <span aria-hidden>→</span>
      </a>
    </div>
  );
}
