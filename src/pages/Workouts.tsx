import { useCallback, useEffect, useState } from "react";
import { Check, Dumbbell, Plus, Sparkles, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { loadColumnsFor } from "@/lib/recoveryPlanning";
import { creditCost } from "@/lib/credits";
import { runWorkoutReview, type WorkoutReviewResult } from "@/lib/runWorkoutReview";

// ============================================================================
// WORKOUTS — the log, and only the log
// ----------------------------------------------------------------------------
// This screen exists to record a session that has already happened. There is
// deliberately no Start button, no timer and no elapsed clock: the Android
// build declares no location permission (see the note in featureFlags.ts), so
// anything that offered to track a live workout would be a control that
// silently does nothing — the athlete would press it, get a stopwatch, and
// discover the distance never moves.
//
// What replaced the old workout logger is the manual entry path that Wearables
// already had: the same columns, the same pricing, written by the same helper,
// so a session recorded here is indistinguishable from one that arrived from a
// watch and is read by the recovery, streak and analytics screens.
// ============================================================================

/** The sports the manual path prices. Matches the list Wearables offers. */
const SESSION_TYPES = ["run", "cycle", "swim", "gym", "hiit", "sport", "yoga", "row"] as const;

type SessionType = (typeof SESSION_TYPES)[number];

const TYPE_LABELS: Record<SessionType, string> = {
  run: "Run",
  cycle: "Ride",
  swim: "Swim",
  gym: "Gym",
  hiit: "HIIT",
  sport: "Sport",
  yoga: "Yoga",
  row: "Row",
};

interface WorkoutRow {
  id: string;
  title: string;
  type: string | null;
  sport: string | null;
  duration_minutes: number | null;
  distance_km: number | string | null;
  completed_at: string | null;
  created_at: string;
}

/** The active plan, only as far as the review needs it. */
interface ActivePlanRow {
  id: string;
  plan_data: unknown;
  week_current: number | null;
  duration_weeks: number | null;
}

/** "longRunPace" / "long_run" → "Long run pace" / "Long run". */
const humanize = (key: string) =>
  key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());

type ReviewBlock = { label: string | null; lines: string[] };

/**
 * The AI answers with JSON, and the first version of this screen dropped that
 * JSON into a `<pre>`: braces, escaped quotes and a horizontal scrollbar, on a
 * phone. Every other AI surface in the app shows sentences, so this one does
 * too.
 *
 * The flattening is deliberately shape-tolerant. The stats call can answer
 * with a string, a list, or an object of strings and lists of strings or
 * objects, and none of those shapes is pinned by a schema the client can rely
 * on. Anything this does not recognise still falls through to the raw JSON, so
 * a new field is never silently dropped — it is just the last resort now
 * instead of the only rendering.
 */
const reviewBlocks = (data: unknown): ReviewBlock[] => {
  if (data == null) return [];
  if (typeof data === "string") return [{ label: null, lines: [data] }];
  if (Array.isArray(data)) {
    const lines = data.filter((v) => v != null && v !== "").map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
    return lines.length ? [{ label: null, lines }] : [];
  }
  if (typeof data === "object") {
    const blocks: ReviewBlock[] = [];
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value == null || value === "") continue;
      if (typeof value === "string" || typeof value === "number") {
        blocks.push({ label: humanize(key), lines: [String(value)] });
        continue;
      }
      if (Array.isArray(value)) {
        const lines = value
          .map((entry) => {
            if (typeof entry === "string") return entry;
            if (entry && typeof entry === "object") {
              const rec = entry as Record<string, unknown>;
              const heading =
                typeof rec.title === "string" ? rec.title
                  : typeof rec.label === "string" ? rec.label
                    : typeof rec.day === "string" ? rec.day
                      : null;
              const body =
                typeof rec.detail === "string" ? rec.detail
                  : typeof rec.description === "string" ? rec.description
                    : typeof rec.action === "string" ? rec.action
                      : typeof rec.summary === "string" ? rec.summary
                        : null;
              if (heading && body) return `${heading} — ${body}`;
              return heading ?? body ?? JSON.stringify(entry);
            }
            return String(entry);
          })
          .filter((line): line is string => Boolean(line));
        if (lines.length) blocks.push({ label: humanize(key), lines });
        continue;
      }
      blocks.push({ label: humanize(key), lines: [JSON.stringify(value)] });
    }
    if (blocks.length) return blocks;
  }
  return [{ label: null, lines: [JSON.stringify(data, null, 2)] }];
};

const inputClass =
  "w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25";

const cardClass =
  "rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[var(--vaylo-elev-card)]";

/** The athlete's own sport, when it is one this form can price. */
const defaultType = (sport: string | null | undefined): SessionType => {
  const needle = (sport ?? "").toLowerCase();
  const hit = SESSION_TYPES.find((t) => needle.includes(t));
  if (hit) return hit;
  if (needle.includes("bike") || needle.includes("cycl")) return "cycle";
  if (needle.includes("weight") || needle.includes("strength")) return "gym";
  if (needle.includes("football") || needle.includes("basket") || needle.includes("rugby")) return "sport";
  return "run";
};

const fmtDate = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "Undated";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const Workouts = () => {
  const { user, profile } = useAuth();

  const [type, setType] = useState<SessionType>(() => defaultType(profile?.sport));
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState<WorkoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<WorkoutReviewResult>({ kind: "empty", reason: "" });
  // The active plan, read alongside the log: the review compares execution
  // against the week the athlete is actually in.
  const [plan, setPlan] = useState<ActivePlanRow | null>(null);

  // The profile arrives after the first render, so the default sport follows it
  // until the athlete picks a type themselves.
  const [touchedType, setTouchedType] = useState(false);
  useEffect(() => {
    if (!touchedType && profile?.sport) setType(defaultType(profile.sport));
  }, [profile?.sport, touchedType]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [log, planRes] = await Promise.all([
        supabase
          .from("workouts")
          .select("id,title,type,sport,duration_minutes,distance_km,completed_at,created_at")
          .eq("user_id", user.id)
          .order("completed_at", { ascending: false, nullsFirst: false })
          .limit(20),
        supabase
          .from("training_plans")
          .select("id,plan_data,week_current,duration_weeks")
          .eq("user_id", user.id)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (log.error) {
        toast.error(log.error.message);
        return;
      }
      setRows((log.data ?? []) as WorkoutRow[]);
      // A missing plan is not an error: "Analyse my workouts" still works, it
      // just says no active plan was supplied rather than inventing one.
      setPlan((planRes.data ?? null) as ActivePlanRow | null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const logSession = async () => {
    if (!user || saving) return;
    const minutes = Number(duration);
    if (!minutes || minutes <= 0) {
      toast.error("How long was it? Enter the minutes.");
      return;
    }
    const km = distance ? Number(distance) : null;
    const kcal = calories ? Number(calories) : null;
    const trimmed = notes.trim();
    setSaving(true);
    try {
      const { error } = await supabase.from("workouts").insert({
        user_id: user.id,
        title: `${TYPE_LABELS[type]} session`,
        type,
        // The load is priced from the sport, so this has to be the same value
        // the recovery read prices against — the type the athlete chose.
        sport: type,
        ...loadColumnsFor({ sport: type, durationMinutes: minutes, distanceKm: km }),
        started_at: new Date(Date.now() - minutes * 60_000).toISOString(),
        completed_at: new Date().toISOString(),
        duration_minutes: minutes,
        distance_km: km,
        calories_burned: kcal,
        completed: true,
        notes: trimmed || null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Session logged.");
      setDuration("");
      setDistance("");
      setCalories("");
      setNotes("");
      setTouchedType(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!user) return;
    setConfirmId(null);
    const { error } = await supabase.from("workouts").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Session deleted.");
    await load();
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <p className="text-[12px] font-semibold uppercase tracking-widest text-primary">Training</p>
        <h1 className="mt-1 text-2xl font-display font-bold">Workouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log a session you have already finished. Nothing here tracks a live workout — Vaylo Sports
          has no location access on this device, so distance is the figure you type in.
        </p>
      </div>

      {/* ── Log a finished session ── */}
      <section className="px-5">
        <div className={`${cardClass} p-4`}>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Plus size={14} className="text-primary" aria-hidden /> Log a session
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            It counts exactly the same as a session that arrives from a watch.
          </p>

          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="session-type" className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                Sport
              </label>
              <select
                id="session-type"
                value={type}
                onChange={(e) => {
                  setTouchedType(true);
                  setType(e.target.value as SessionType);
                }}
                className={`${inputClass} mt-1.5`}
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="session-duration" className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                  Minutes
                </label>
                <input
                  id="session-duration"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="45"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="session-distance" className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                  Distance (km)
                </label>
                <input
                  id="session-distance"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="Optional"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="session-calories" className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                Calories
              </label>
              <input
                id="session-calories"
                type="number"
                inputMode="numeric"
                placeholder="Optional"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </div>

            <div>
              <label htmlFor="session-notes" className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                Notes
              </label>
              <textarea
                id="session-notes"
                rows={3}
                placeholder="How it went, how it felt, what to change next time."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${inputClass} mt-1.5 resize-none`}
              />
            </div>

            <button
              type="button"
              onClick={() => void logSession()}
              disabled={saving}
              className="press flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              <Check size={16} aria-hidden /> {saving ? "Saving…" : "Save session"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Analyse my workouts ── */}
      <div className="px-5">
        <button
          type="button"
          onClick={() => {
            if (reviewing) return;
            setReviewing(true);
            setReviewError(null);
            setReviewData({ kind: "empty", reason: "" });
            void runWorkoutReview({
              user: { id: user!.id },
              profile: { sport: profile?.sport ?? null },
              planWeek: plan?.plan_data as unknown as Array<{ week: number; sessions: Array<{ day: number; title?: string | null; type?: string | null; duration_minutes?: number | null; description?: string | null; skipped?: boolean | null }> }> | null,
              weekCurrent: plan?.week_current ?? null,
              durationWeeks: plan?.duration_weeks ?? null,
              onCharge: (charged) => {
                if (charged > 0) setReviewData((current) => ({ ...current, charged }));
              },
            })
              .then((result) => {
                setReviewData(result);
              })
              .catch((error: unknown) => {
                setReviewError(error instanceof Error ? error.message : "Analyse failed.");
              })
              .finally(() => setReviewing(false));
          }}
          disabled={reviewing}
          className="press flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          <Sparkles size={16} aria-hidden /> {reviewing ? "Analysing…" : `Analyse my workouts (${creditCost("training_insight")} credits)`}
        </button>
        {reviewError && (
          <p className="mt-2 text-xs text-destructive">{reviewError}</p>
        )}
        {/* The refusal is information, not a silent no-op. It used to be the one
            state this panel deliberately skipped, so tapping Analyse with
            nothing logged looked like a dead button. */}
        {reviewData.kind === "empty" && reviewData.reason && (
          <p className="mt-2 text-xs text-muted-foreground">{reviewData.reason}</p>
        )}
        {reviewData.kind === "unreadable" && (
          <p className="mt-2 text-xs text-muted-foreground">
            The answer came back in a format the app could not read. Try again — no credits were
            spent on a result you cannot see.
          </p>
        )}
        {reviewData.kind === "ready" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 space-y-3 rounded-xl border border-border bg-card/60 p-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              AI review{reviewData.charged ? ` \u00b7 ${reviewData.charged} credits` : ""}
            </p>
            {reviewBlocks(reviewData.data).map((block, index) => (
              <div key={`${block.label ?? "block"}-${index}`} className="space-y-1.5">
                {block.label && (
                  <p className="text-[12px] font-bold text-foreground">{block.label}</p>
                )}
                {block.lines.map((line, lineIndex) => (
                  <p
                    key={lineIndex}
                    className="text-[13px] leading-relaxed text-muted-foreground"
                  >
                    {line}
                  </p>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Recent sessions ── */}
      <section className="px-5 pt-6">
        <h2 className="mb-2.5 px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
          Recent sessions
        </h2>

        {loading && rows.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">Nothing logged yet. Add the session you just finished and it will appear here.</p>
        )}

        {!loading && rows.length === 0 && (
          <div className={`${cardClass} p-4 text-sm text-muted-foreground`}>
            Nothing logged yet. Add the session you just finished and it will appear here.
          </div>
        )}

        <div className="space-y-2">
          {rows.map((row) => {
            const km = row.distance_km == null ? null : Number(row.distance_km);
            return (
              <div key={row.id} className={`${cardClass} flex items-start gap-3 p-3.5`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                  <Dumbbell size={17} className="text-primary" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold leading-tight">{row.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {fmtDate(row.completed_at ?? row.created_at)}
                    {row.duration_minutes ? ` · ${row.duration_minutes} min` : ""}
                    {km ? ` · ${km.toFixed(2)} km` : ""}
                  </p>
                </div>
                {confirmId === row.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void remove(row.id)}
                      className="press flex min-h-[44px] items-center rounded-xl border border-destructive/40 px-3 text-xs font-semibold text-destructive"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="press flex min-h-[44px] items-center rounded-xl border border-white/[0.08] px-3 text-xs font-semibold text-muted-foreground"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${row.title}`}
                    onClick={() => setConfirmId(row.id)}
                    className="press flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-muted-foreground"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
};

export default Workouts;
