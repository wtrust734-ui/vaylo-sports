import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Crosshair, NotebookPen, Pause, Pin, Play, TimerReset, Wind } from "lucide-react";
import EventBreathing from "./EventBreathing";
import EventBetweenReset from "./EventBetweenReset";
import EventChecklist from "./EventChecklist";
import EventDaySchedule from "./EventDaySchedule";
import EventNotes from "./EventNotes";
import {
  CUE_ROTATE_MS,
  countdownLabel,
  nextSlot,
  readFocusCue,
  readSchedule,
  rotateIndex,
  writeFocusCue,
  writeSchedule,
  type EventSlot,
} from "@/lib/eventMode";
import { hapticTap } from "@/lib/haptics";

interface Props {
  cueWords: string[];
  onExit: () => void;
}

type View = "home" | "breathe" | "between" | "notes";

const reminders = [
  "Control the controllables.",
  "Process over outcome.",
  "Trust your training.",
];

/**
 * EVENT MODE — the whole competition day, not one countdown
 * ----------------------------------------------------------------------------
 * What was here: a countdown, the cue words as a row of cards, a line of text
 * describing breathing, and three reminders. That covers "the gun goes in five
 * minutes" and nothing else about a competition.
 *
 * What a day actually contains, and what this now holds:
 *   • several events, each with its own time, and a live countdown to the next
 *     one (EventDaySchedule) — marking an event done is what moves it on;
 *   • the six things that have to be true before a start line, ticked off and
 *     remembered on the device between events (EventChecklist);
 *   • one cue word, large, pinned or rotating slowly (this file), because a
 *     poster of three words is not a thought to hold at the line;
 *   • a real guided breath with a circle and a phase countdown (EventBreathing)
 *     at the same calm pacing as the Quick Reset preset;
 *   • the gap between events, which is where a day is won or lost
 *     (EventBetweenReset);
 *   • three lines written afterwards while it is still fresh (EventNotes).
 *
 * Everything local. No AI call, no credit, no new table: a competition day's
 * state belongs on the athlete's phone, and it must survive the app being
 * closed in a bag at the track. The one thing kept from the old screen is the
 * plain countdown, which is still the fastest way to say "five minutes".
 */
const RaceMode = ({ cueWords, onExit }: Props) => {
  const [view, setView] = useState<View>("home");
  const [slots, setSlots] = useState<EventSlot[]>(() => readSchedule());
  const [pinnedCue, setPinnedCue] = useState<string>(() => readFocusCue());
  const [cueIndex, setCueIndex] = useState(0);

  const [countdownTotal, setCountdownTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [inputMin, setInputMin] = useState("5");
  const timerRef = useRef<number | null>(null);

  const startTimer = () => {
    const secs = parseInt(inputMin) * 60;
    if (isNaN(secs) || secs <= 0) return;
    setCountdownTotal(secs);
    setRemaining(secs);
    setRunning(true);
  };

  useEffect(() => {
    if (!running) return;
    timerRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { setRunning(false); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  // Rotation stops the moment a word is pinned: a pinned cue is a decision, and
  // a decision that changes itself every twelve seconds is not one.
  useEffect(() => {
    if (pinnedCue || cueWords.length < 2 || view !== "home") return;
    const timer = window.setInterval(
      () => setCueIndex((index) => rotateIndex(index, cueWords.length)),
      CUE_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [pinnedCue, cueWords.length, view]);

  const updateSlots = (updated: EventSlot[]) => {
    setSlots(updated);
    writeSchedule(updated);
  };

  const pin = (cue: string) => {
    hapticTap();
    const next = pinnedCue === cue ? "" : cue;
    setPinnedCue(next);
    writeFocusCue(next);
  };

  const next = nextSlot(slots);
  const activeCue = pinnedCue || cueWords[cueIndex] || "";

  if (view === "breathe") return <EventBreathing onExit={() => setView("home")} />;
  if (view === "between") {
    return (
      <EventBetweenReset
        cueWords={cueWords}
        pinnedCue={activeCue}
        next={next}
        onBreathe={() => setView("breathe")}
        onExit={() => setView("home")}
      />
    );
  }
  if (view === "notes") return <EventNotes defaultEvent={next?.name ?? ""} onExit={() => setView("home")} />;

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background pb-24 pt-[var(--vaylo-screen-top)]">
      <div className="flex items-center gap-3 px-5">
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onExit}
          className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <ArrowLeft size={18} aria-hidden /> Back to Mental Gym
        </motion.button>
        {next && (
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            {next.name} {countdownLabel(next.time) ?? ""}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-5 px-5">
        {/* One cue word, large — the thought to hold at the line. */}
        <section className="w-full rounded-2xl border border-primary/30 bg-primary/[0.07] p-4">
          <div className="flex items-center gap-2">
            <Crosshair size={16} className="text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Your cue</h2>
            {activeCue && (
              <button
                type="button"
                onClick={() => pin(activeCue)}
                aria-pressed={!!pinnedCue}
                className="ml-auto flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[11px] font-semibold text-muted-foreground"
              >
                <Pin size={12} aria-hidden /> {pinnedCue ? "Unpin" : "Pin this"}
              </button>
            )}
          </div>

          {activeCue ? (
            <p className="mt-3 text-center text-4xl font-display font-black text-primary" role="status">
              {activeCue}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No cue words yet — set up to three in Mental Gym &rarr; Train &rarr; Cue Words.
            </p>
          )}

          {cueWords.length > 1 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {cueWords.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => pin(word)}
                  aria-pressed={pinnedCue === word}
                  className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${
                    pinnedCue === word
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {word}
                </button>
              ))}
            </div>
          )}
          {!pinnedCue && cueWords.length > 1 && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Rotating every {CUE_ROTATE_MS / 1000}s &mdash; pin one to hold it.
            </p>
          )}
        </section>

        {/* The plain countdown, kept because it is still the fastest answer. */}
        <section className="w-full rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <TimerReset size={16} className="text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Countdown</h2>
          </div>
          {!running && remaining === 0 ? (
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="event-minutes">Minutes</label>
              <input
                id="event-minutes"
                value={inputMin}
                onChange={(e) => setInputMin(e.target.value)}
                type="number"
                min={1}
                max={120}
                className="w-20 rounded-xl border border-border bg-background px-3 py-2 text-center text-lg font-display font-bold"
              />
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={startTimer}
                className="ml-auto flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground"
              >
                <Play size={16} aria-hidden /> Start
              </motion.button>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <p className="text-4xl font-display font-black tabular-nums text-primary" role="timer">
                {fmt(remaining)}
              </p>
              <button
                type="button"
                onClick={() => setRunning(!running)}
                className="ml-auto flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-muted-foreground"
              >
                {running ? <><Pause size={14} aria-hidden /> Pause</> : <><Play size={14} aria-hidden /> Resume</>}
              </button>
            </div>
          )}
          {countdownTotal > 0 && remaining === 0 && !running && (
            <p className="mt-2 text-xs text-muted-foreground">Countdown finished.</p>
          )}
        </section>

        {/* One tap to the three things that happen around an event. */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "breathe" as View, label: "Breathe", icon: Wind },
            { id: "between" as View, label: "Between events", icon: TimerReset },
            { id: "notes" as View, label: "After the event", icon: NotebookPen },
          ].map((action) => (
            <motion.button
              key={action.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => { hapticTap(); setView(action.id); }}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-2 text-[11px] font-semibold text-foreground"
            >
              <action.icon size={18} className="text-primary" aria-hidden />
              {action.label}
            </motion.button>
          ))}
        </div>

        <EventDaySchedule slots={slots} onChange={updateSlots} />
        <EventChecklist />

        {/* Focus reminders — unchanged. */}
        <div className="space-y-2 pt-1">
          {reminders.map((reminder, index) => (
            <motion.p
              key={index}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 + index * 0.15 }}
              className="text-center text-xs italic text-muted-foreground/60"
            >
              {reminder}
            </motion.p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RaceMode;
