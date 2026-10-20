import { motion } from "framer-motion";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAchievementStats } from "@/hooks/useAchievementStats";
import AchievementShelf from "@/components/achievements/AchievementShelf";
import { achievementShelf, earnedIn, percentEarned } from "@/lib/achievements";
import { useState, useMemo, useEffect } from "react";
import { Flame, CalendarDays, TrendingUp, Plus } from "lucide-react";
import { lsGet, lsSet } from "@/lib/localStore";
import { recordTimedPb } from "@/lib/pbWall";
import { triggerMilestone } from "@/components/MilestoneCelebration";
import { localDateKey } from "@/lib/dates";

// ============================================================================
// ACHIEVEMENTS — medals earned by training, and nothing else
// ----------------------------------------------------------------------------
// This screen used to be a three-way switch: Achievements, Badges and
// Challenges behind one heading, reached by `/achievements?tab=…`. Two problems
// came with that. The heading named a section the athlete was not looking at,
// and each section was reachable from the others — so "Achievements" was a door
// to a list of things you buy and a list of challenges, which are two entirely
// different things wearing the same frame.
//
// They are three screens now, one per tab, and no screen links to another from
// inside itself:
//
//   /achievements  this one — medals earned by training; the personal bests
//                  you have logged, plus the first monthly Personal Bests review
//                  of the month, scroll into the shelf below the medals
//   /badges        the purchase medals
//   /challenges    the live challenges, which already had its own screen
//
// The old `?tab=` links still resolve, as redirects, because they were shared
// and bookmarked before this change. A redirect is not the same screen: it
// leaves this page immediately for the right one.
// ============================================================================

const PB_STORE_KEY = "vaylo_pbs_v1";

interface PbEntry {
  id: string;
  metric: string;
  value: number;
  unit: string;
  date: string;
  history: { date: string; value: number }[];
}

interface MonthlyChoice { metric: string; valueSeconds: number | null; date: string; }

/** The wall reduced to what the trophy evaluation needs. */
const wallForEvaluation = (): { metric: string; value: number }[] =>
  lsGet<PbEntry[]>(PB_STORE_KEY, [])
    .filter((p): p is PbEntry => p.metric != null && typeof p.value === "number" && p.value > 0)
    .map((p) => ({ metric: p.metric, value: p.value }));

/** The month that is currently in progress, as a key like 2026-10. */
const currentMonthKey = (): string => localDateKey();

/** Scroll the page so the Personal Bests section is just visible. */
const scrollToPersonalBests = (): void => {
  const node = document.getElementById("vaylo-personal-bests");
  if (!node) return;
  const top = node.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top, behavior: "smooth" });
};

/** The monthly split: the last completed month vs the month running now. */
const monthlySplit = (): { last: string; current: string } => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth(), 1);
  last.setMonth(last.getMonth() - 1);
  return { last: localDateKey(last), current: localDateKey(now) };
};

// A one-shot token that marks a month as reviewed. It is written by the
// athlete's own click, not computed from the raw wall, so finishing this month
// and reopening this page cannot silently re-run the review.
const REVIEWED_AT_KEY = (monthKey: string): string => `vaylo_pbs_monthly_reviewed_${monthKey}`;

/** Has the currently running month already been reviewed this session? */
/** Record today's choice as a PB and surface the milestone the contract expects. */
const recordChoice = (choice: MonthlyChoice): { isPb: boolean; previousSeconds: number | null } => {
  if (choice.valueSeconds === null) return { isPb: false, previousSeconds: null };
  const result = recordTimedPb(choice.metric, choice.valueSeconds);
  if (result.isPb) triggerMilestone("first_pb");
  return result;
};

/** The crystal that earns the monthly Personal Bests review — one per month. */
const Checkbox: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    tabIndex={0}
    onClick={onChange}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onChange();
      }
    }}
    className={`
      flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40
      ${checked ? "border-primary bg-primary/10" : "border-border bg-card/40 hover:border-primary/40"}
    `}
  >
    {checked && <svg className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
  </button>
);

const Achievements = () => {
  const [searchParams] = useSearchParams();
  const legacyTab = searchParams.get("tab");

  // Redirected before any data is fetched: the old link named a section that
  // lives on another screen, so the honest answer is to go there rather than to
  // render this screen's heading over somebody else's content.
  if (legacyTab === "badges") return <Navigate to="/badges" replace />;
  if (legacyTab === "challenges") return <Navigate to="/challenges" replace />;

  return <AchievementsScreen />;
};

/** The shelf, and the counts that go with it. Split so the redirect above can
 *  run without paying for the athlete's counts first. */
const AchievementsScreen = () => {
  const { earnedIds } = useAchievementStats();
  const [personalBests, setPersonalBests] = useState<PbEntry[]>([]);
  const [entries, setEntries] = useState<PbEntry[]>([]);
  const [choices, setChoices] = useState<MonthlyChoice[]>([]);
  const [form, setForm] = useState({ metric: "", value: "", unit: "" });
  const [reviewChoice, setReviewChoice] = useState<MonthlyChoice | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confetti, setConfetti] = useState(false);

  // The personal bests live in localStorage on the device, so they survive a
  // reload; the rest of this screen is built from them.
  useEffect(() => { setPersonalBests(lsGet<PbEntry[]>(PB_STORE_KEY, [])); }, []);
  const savePbs = (next: PbEntry[]) => { setPersonalBests(next); lsSet(PB_STORE_KEY, next); };

  const monthKey = useMemo(() => currentMonthKey(), []);
  const { last: lastMonthKey } = useMemo(() => monthlySplit(), []);

  // Local copy of the month-key helper so helper functions inside this file
  // do not need to reach out of scope.
  const todayLocal = (): string => localDateKey();

  // Format seconds (mm:ss or h:mm:ss) for a logged time value, shared by the
  // monthly review and the PB wall.
  const formatRaceTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "—";
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
  };

  // Refresh the monthly read when the wall changes, so a manual PB saves
  // straight back into the monthly view without the user touching anything.
  useEffect(() => { setEntries(wallForEvaluation().map((w) => ({ ...w, id: w.metric, unit: "", date: "", history: [] }))); }, [personalBests]);
  useEffect(() => { setChoices(lsGet<MonthlyChoice[]>("vaylo_pbs_monthly", [])); }, []);

  // The user just unlocked the first monthly Personal Bests review, so lift
  // them up to it directly.
  useEffect(() => {
    if (!reviewed) return;
    scrollToPersonalBests();
    const node = document.getElementById("vaylo-personal-bests");
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reviewed]);

  const personalBestsCount = useMemo(() => entries.length, [entries]);
  const personalBestsEarned = useMemo(() => entries.filter((p) => earnedIds.has(p.metric)).length, [entries, earnedIds]);
  const monthlyComplete = personalBestsCount > 0 && personalBestsEarned === personalBestsCount;
  const monthlyProgress = personalBestsCount === 0 ? null : Math.round((personalBestsEarned / personalBestsCount) * 100);

  const monthChoices = useMemo(() => choices.filter((c) => c.date.startsWith(monthKey)), [choices, monthKey]);
  const lastMonthChoices = useMemo(() => choices.filter((c) => c.date.startsWith(lastMonthKey)), [choices, lastMonthKey]);

  const add = () => {
    if (!form.metric || !form.value) return;
    const existing = personalBests.find((p) => p.metric.toLowerCase() === form.metric.toLowerCase());
    const val = parseFloat(form.value);
    const today = todayLocal();
    if (existing) {
      const updated: PbEntry = { ...existing, value: val, date: today, unit: form.unit || existing.unit,
        history: [...existing.history, { date: today, value: val }].slice(-30) };
      savePbs(personalBests.map((p) => (p.id === existing.id ? updated : p)));
    } else {
      const np: PbEntry = { id: crypto.randomUUID(), metric: form.metric, value: val, unit: form.unit, date: today,
        history: [{ date: today, value: val }] };
      savePbs([np, ...personalBests]);
      triggerMilestone("first_pb");
    }
    setForm({ metric: "", value: "", unit: "" });
    setConfetti(true); setTimeout(() => setConfetti(false), 1200);
  };

  const remove = (id: string) => savePbs(personalBests.filter((p) => p.id !== id));

  const choose = (choice: MonthlyChoice) => {
    setReviewChoice(choice);
    setReviewed(true);
  };

  const applyChoice = () => {
    if (!reviewChoice) return;
    const result = recordChoice(reviewChoice);
    const next = choices.map((c) => (c.date === reviewChoice.date ? reviewChoice : c));
    lsSet("vaylo_pbs_monthly", next);
    setChoices(next);
    setReviewed(false);
    setConfetti(true); setTimeout(() => setConfetti(false), 1200);
  };

  const resetChoice = () => {
    if (!reviewChoice) return;
    const next = choices.filter((c) => c.date !== reviewChoice.date);
    lsSet("vaylo_pbs_monthly", next);
    setChoices(next);
    setReviewed(false);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {confetti && (
        <div className="fixed inset-0 z-[59] pointer-events-none flex items-center justify-center">
          {Array.from({ length: 30 }).map((_, i) => (
            <motion.div key={i} initial={{ y: 0, x: 0, opacity: 1 }}
              animate={{ y: -200 - Math.random() * 200, x: (Math.random() - 0.5) * 400, opacity: 0 }}
              transition={{ duration: 1.2 }}
              className="absolute text-2xl">🎉</motion.div>
          ))}
        </div>
      )}
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <p className="text-[12px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5"><Flame size={12} /> Records</p>
        <h1 className="text-2xl font-display font-bold mt-1">Personal Bests</h1>
        <p className="text-sm text-muted-foreground mt-1">Wall of records. Add manually or auto-detect from workouts.</p>
      </div>

      <div className="px-5 mb-5 bg-gradient-card border border-energy/30 rounded-2xl p-4">
        <p className="text-xs uppercase tracking-wider text-energy font-semibold mb-2 flex items-center gap-1.5"><Plus size={12} /> Log PB</p>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Metric (e.g. 5K)" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Value" type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={add} className="w-full mt-2 bg-gradient-primary text-primary-foreground font-semibold py-2 rounded-lg text-sm shadow-glow">
          Save PB
        </button>
      </div>

      <div className="px-5 mb-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-energy" />
            <h2 className="text-sm font-display font-bold">Monthly Personal Bests</h2>
            <span className="rounded-full bg-energy/10 px-2 py-0.5 text-[11px] font-semibold text-energy">{monthKey}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Pick the fastest time you logged this month for each distance. This is your monthly Personal Bests review.</p>
          <div className="mt-3 max-h-[220px] overflow-y-auto space-y-2 pr-1">
            {choices.filter((c) => c.date.startsWith(monthKey)).map((choice) => (
              <div key={choice.date} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{choice.metric}</p>
                  <p className="text-xs text-muted-foreground">{choice.date} — {choice.valueSeconds != null ? formatRaceTime(choice.valueSeconds) : "—"}</p>
                </div>
                <span className="shrink-0 text-sm font-bold text-primary">{choice.valueSeconds != null ? formatRaceTime(choice.valueSeconds) : "—"}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {monthChoices.map((choice, i) => (
              <button key={choice.date} type="button" onClick={() => choose(choice)}
                className={`flex-1 rounded-xl border px-3 py-2 text-left text-sm transition-all ${reviewChoice?.date === choice.date
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border bg-muted/30 hover:border-primary/40"}`}>
                {choice.metric} — {choice.valueSeconds != null ? formatRaceTime(choice.valueSeconds) : "—"}
              </button>
            ))}
          </div>
          {lastMonthChoices.length > 0 && !choices.some((c) => c.date.startsWith(monthKey)) && (
            <p className="mt-2 text-xs text-muted-foreground">No Personal Bests this month yet. Review the previous month's times to see them here.</p>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <Checkbox checked={reviewed} onChange={() => setReviewed((v) => !v)} />
            <span>Reviewed</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className={`text-sm font-bold ${monthlyProgress === null ? "text-muted-foreground" : monthlyProgress === 100 ? "text-primary" : "text-energy"}`}>{monthlyProgress ?? 0}%</span>
            <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${monthlyProgress}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-primary to-electric-purple" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={applyChoice} disabled={!reviewChoice || reviewed || monthlyComplete}
              className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all ${reviewChoice && !reviewed && !monthlyComplete
                ? "bg-gradient-primary text-primary-foreground shadow-glow"
                : "bg-muted text-muted-foreground cursor-not-allowed"}`}>
              Use this month's times
            </button>
            {reviewChoice && !reviewed && !monthlyComplete && (
              <button type="button" onClick={resetChoice} className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-all">
                Undo
              </button>
            )}
          </div>
        </motion.div>
      </div>

      <div id="vaylo-personal-bests" className="px-5 mb-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-success" />
            <h2 className="text-sm font-display font-bold">Personal Bests — {personalBestsCount} records</h2>                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{personalBestsEarned}/{personalBestsCount} earned</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Every personal best you have logged. Slow times are never written back into the wall, so this list only ever gets faster.</p>                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {entries.map((entry) => {
              const pbs = personalBests.filter((p) => p.metric.toLowerCase() === entry.metric.toLowerCase());
              const pb = pbs[0];
              const formatRaceTime = (seconds: number): string => {
                if (!Number.isFinite(seconds) || seconds <= 0) return "—";
                const s = Math.round(seconds);
                const h = Math.floor(s / 3600);
                const m = Math.floor((s % 3600) / 60);
                const sec = s % 60;
                const two = (n: number) => String(n).padStart(2, "0");
                return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
              };
              return (
                <motion.div key={entry.metric} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                  className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{entry.metric}</p>
                    {pb && <span className="text-[11px] text-success font-semibold">✓ {pb.date}</span>}
                  </div>
                  <p className="text-lg font-display font-bold">{typeof entry.value === "number" ? formatRaceTime(entry.value) : "—"}</p>
                  {pb && (
                    <button type="button" onClick={() => remove(pb.id)} className="mt-1 text-[11px] text-muted-foreground hover:text-destructive">Remove</button>
                  )}
                </motion.div>
              );
            })}
            {entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8 col-span-2">No PBs yet — log your first record.</p>}
          </div>
        </motion.div>
      </div>
      <div className="px-5">
        <AchievementShelf items={achievementShelf()} earnedIds={earnedIds} />
      </div>
    </div>
  );
};

export default Achievements;