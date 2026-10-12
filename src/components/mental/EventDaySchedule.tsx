import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Check, Plus, Trash2 } from "lucide-react";
import {
  addSlot,
  countdownLabel,
  formatCountdown,
  markSlotDone,
  minutesUntil,
  nextSlot,
  removeSlot,
  sortSchedule,
  type EventSlot,
} from "@/lib/eventMode";
import { hapticTap } from "@/lib/haptics";

type Props = { slots: EventSlot[]; onChange: (slots: EventSlot[]) => void };

/**
 * A competition day is usually more than one event.
 *
 * One countdown assumed a single start time, which is the shape of a parkrun
 * and not the shape of a track meet, a swimming gala or a school sports day.
 * This holds the whole start list: add each event with its time, see the live
 * countdown to the next one, and mark events done as you go. Marking done is
 * the only thing that advances "next", because delayed starts are normal and a
 * countdown that silently moves on is worse than none.
 */
const EventDaySchedule = ({ slots, onChange }: Props) => {
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  // One tick a second only while something is still ahead — a finished day
  // does not need a timer running in the background.
  const next = nextSlot(slots);
  useEffect(() => {
    if (!next) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [next?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const updated = addSlot(slots, name, time);
    if (updated === slots) {
      setError("Give the event a name and a time like 14:30.");
      return;
    }
    hapticTap();
    onChange(updated);
    setName("");
    setTime("");
    setError("");
  };

  const ordered = sortSchedule(slots);
  const minutes = next ? minutesUntil(next.time, now) : null;
  const milliseconds = minutes === null ? 0 : Math.max(0, new Date(new Date(now).setHours(
    Number(next!.time.slice(0, 2)), Number(next!.time.slice(3)), 0, 0)).getTime() - now.getTime());

  return (
    <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Today&rsquo;s events</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {ordered.filter((slot) => !slot.done).length} to go
        </span>
      </div>

      {next ? (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/[0.07] p-3">
          <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Next up</p>
          <p className="mt-0.5 text-sm font-semibold">
            {next.name} <span className="text-muted-foreground">at {next.time}</span>
          </p>
          <p className="mt-0.5 text-lg font-display font-bold tabular-nums text-primary" role="status">
            {countdownLabel(next.time, now) === "started" ? "Your event has gone off" : formatCountdown(milliseconds)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { hapticTap(); onChange(markSlotDone(slots, next.id)); }}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              <Check size={15} aria-hidden /> Event done
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {ordered.length === 0
            ? "Add today's events and Event Mode will count you in to each one."
            : "Everything on the list is done. Add the next event when you know it."}
        </p>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Event (200m heat, race 2)"
            aria-label="Event name"
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          <input
            value={time}
            onChange={(event) => setTime(event.target.value)}
            type="time"
            aria-label="Event time"
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="button"
          onClick={add}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary/10 text-sm font-semibold text-primary"
        >
          <Plus size={15} aria-hidden /> Add event
        </button>
      </div>

      {ordered.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {ordered.map((slot) => (
            <li
              key={slot.id}
              className={`flex items-center gap-2 rounded-xl border p-2.5 ${
                slot.done ? "border-border bg-background opacity-60" : "border-border bg-background"
              }`}
            >
              <button
                type="button"
                aria-pressed={slot.done}
                aria-label={`Mark ${slot.name} done`}
                onClick={() => { hapticTap(); onChange(markSlotDone(slots, slot.id)); }}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  slot.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                }`}
              >
                <Check size={14} aria-hidden />
              </button>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-semibold ${slot.done ? "line-through" : ""}`}>
                  {slot.name}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {slot.time} · {slot.done ? "done" : countdownLabel(slot.time, now) ?? ""}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${slot.name}`}
                onClick={() => onChange(removeSlot(slots, slot.id))}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default EventDaySchedule;
