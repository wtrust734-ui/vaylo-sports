// ============================================================================
// EVENT MODE — the local state a competition day actually needs
// ----------------------------------------------------------------------------
// Event Mode used to be one countdown and three cue words, which assumes a
// competition is a single start time. A competition day is: several events,
// gaps between them, kit that has to be physically present, a warmup that has
// to be finished rather than begun, and one thing to think about at the line.
// None of that needs a server, a table or a row: it is the athlete's day, it
// belongs on their device, and if the app is closed and reopened at the track
// it must all still be there.
//
// So this module is the pure half — items, ordering, countdowns, breathing
// phases — with localStorage read/write at the edges and no React at all. The
// components in components/mental/ are thin renders over it, and every rule
// worth arguing about (what "next event" means, what a fresh day resets) is
// testable here without a DOM.
//
// Deliberate boundaries:
//   • No new tables. Nothing here is shared with other athletes or the AI.
//   • The checklist resets with the calendar day (src/lib/dates.ts), because a
//     checklist that survives to tomorrow is a checklist nobody trusts.
//   • Times are the athlete's own wall-clock HH:MM, the same input a start list
//     uses, and are never converted to UTC.
// ============================================================================

import { isoDate, lsGet, lsSet } from "@/lib/localStore";

export const EVENT_MODE_KEYS = {
  /** Per-day; the storage helper appends the date. */
  checklist: "vaylo_event_checklist_v1",
  schedule: "vaylo_event_schedule_v1",
  focus: "vaylo_event_focus_cue_v1",
  notes: "vaylo_event_notes_v1",
} as const;

// ---------------------------------------------------------------------------
// 1. Pre-event checklist
// ---------------------------------------------------------------------------
// Six things, each one a thing athletes actually have to remember. The order is
// the order of a competition morning, and the last item is a decision rather
// than a possession: the cue word is chosen before the call room, not at the
// line, which is the one item on this list that is mental.

export type ChecklistItem = { id: string; label: string; hint: string };

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "kit", label: "Kit and number", hint: "Bib, spare socks, tape — whatever you have forgotten before" },
  { id: "shoes", label: "Shoes for this surface", hint: "Laced the way you race in them" },
  { id: "warmup", label: "Warmup done", hint: "Done, not started — the last hard effort felt easy" },
  { id: "hydration", label: "Water and fuel", hint: "One for now, one for between events" },
  { id: "toilet", label: "Toilet", hint: "Before the call room, not after it" },
  { id: "focus", label: "One cue word chosen", hint: "Decide it now so it is not a decision at the line" },
];

export const CHECKLIST_TOTAL = CHECKLIST_ITEMS.length;

/** Storage key for one day's ticks — a new day starts with an empty list. */
export const checklistKey = (day: string = isoDate()): string =>
  `${EVENT_MODE_KEYS.checklist}:${day}`;

/** Ticks for the day, filtered to real items so a stale key cannot inflate the count. */
export function readChecklist(day: string = isoDate()): Record<string, boolean> {
  const stored = lsGet<Record<string, boolean>>(checklistKey(day), {});
  const ticks: Record<string, boolean> = {};
  for (const item of CHECKLIST_ITEMS) {
    if (stored && stored[item.id]) ticks[item.id] = true;
  }
  return ticks;
}

export function writeChecklist(ticks: Record<string, boolean>, day: string = isoDate()): void {
  lsSet(checklistKey(day), ticks);
}

export function checklistCount(ticks: Record<string, boolean>): number {
  return CHECKLIST_ITEMS.filter((item) => !!ticks[item.id]).length;
}

export function isChecklistComplete(ticks: Record<string, boolean>): boolean {
  return checklistCount(ticks) === CHECKLIST_TOTAL;
}

/** The first unticked item — what to do next, not a list to read. */
export function nextChecklistItem(ticks: Record<string, boolean>): ChecklistItem | null {
  return CHECKLIST_ITEMS.find((item) => !ticks[item.id]) ?? null;
}

// ---------------------------------------------------------------------------
// 2. The day's events
// ---------------------------------------------------------------------------

export type EventSlot = {
  id: string;
  name: string;
  /** Wall-clock "HH:MM", as a start list prints it. */
  time: string;
  done: boolean;
};

export const MAX_EVENTS = 12;

export function makeEventId(now: number = Date.now()): string {
  return `ev-${now}-${Math.floor(Math.random() * 1e6)}`;
}

const isTime = (value: unknown): value is string =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function readSchedule(): EventSlot[] {
  const stored = lsGet<unknown>(EVENT_MODE_KEYS.schedule, []);
  if (!Array.isArray(stored)) return [];
  const slots: EventSlot[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { id?: unknown; name?: unknown; time?: unknown; done?: unknown };
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 60) : "";
    if (!name || !isTime(row.time)) continue;
    slots.push({
      id: typeof row.id === "string" && row.id ? row.id : makeEventId(slots.length),
      name,
      time: row.time,
      done: !!row.done,
    });
  }
  return slots.slice(0, MAX_EVENTS);
}

export function writeSchedule(slots: EventSlot[]): void {
  lsSet(EVENT_MODE_KEYS.schedule, slots.slice(0, MAX_EVENTS));
}

/** Start-list order: earliest first. Ties keep the order they were added in. */
export function sortSchedule(slots: EventSlot[]): EventSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => (a.slot.time === b.slot.time ? a.index - b.index : a.slot.time < b.slot.time ? -1 : 1))
    .map(({ slot }) => slot);
}

export function addSlot(slots: EventSlot[], name: string, time: string): EventSlot[] {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || !isTime(time) || slots.length >= MAX_EVENTS) return slots;
  return sortSchedule([...slots, { id: makeEventId(), name: trimmed, time, done: false }]);
}

export function removeSlot(slots: EventSlot[], id: string): EventSlot[] {
  return slots.filter((slot) => slot.id !== id);
}

export function markSlotDone(slots: EventSlot[], id: string): EventSlot[] {
  return slots.map((slot) => (slot.id === id ? { ...slot, done: true } : slot));
}

export function clearDoneSlots(slots: EventSlot[]): EventSlot[] {
  return slots.filter((slot) => !slot.done);
}

/**
 * The event the athlete is actually preparing for: the earliest one they have
 * not marked done. Marking an event done is what moves this on — a clock
 * passing it does not, because a delayed start is normal and a countdown that
 * silently advances to the next event is worse than no countdown.
 */
export function nextSlot(slots: EventSlot[]): EventSlot | null {
  return sortSchedule(slots).find((slot) => !slot.done) ?? null;
}

// ---------------------------------------------------------------------------
// 3. Countdowns
// ---------------------------------------------------------------------------

/** Minutes from `now` to today's HH:MM. Negative once the time has passed. */
export function minutesUntil(time: string, now: Date = new Date()): number | null {
  if (!isTime(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 60_000);
}

/** "1h 04m" / "12m" / "now" — short enough to read while moving. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * What to say about an event's time. `started` is a statement, not a failure:
 * an athlete whose event has gone off needs to know the countdown is behind
 * them, not to see "0m 00s" ticking up from nothing.
 */
export function countdownLabel(time: string, now: Date = new Date()): string | null {
  const minutes = minutesUntil(time, now);
  if (minutes === null) return null;
  if (minutes < 0) return "started";
  if (minutes === 0) return "now";
  return `in ${minutes}m`;
}

// ---------------------------------------------------------------------------
// 4. Cue words — one at a time, rotating
// ---------------------------------------------------------------------------
// All three cue words on screen at once is a poster. One word, large, is an
// instruction. The rotation is slow on purpose: a cue that changes faster than
// an athlete can act on it is decoration, so each word holds for a full
// interval and the pinned word never rotates away.

export const CUE_ROTATE_MS = 12_000;

export function rotateIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const next = index + 1;
  return next >= length ? 0 : next;
}

export function readFocusCue(): string {
  const stored = lsGet<unknown>(EVENT_MODE_KEYS.focus, "");
  return typeof stored === "string" ? stored.slice(0, 24) : "";
}

export function writeFocusCue(cue: string): void {
  lsSet(EVENT_MODE_KEYS.focus, cue.slice(0, 24));
}

// ---------------------------------------------------------------------------
// 5. Breathing for the gap and the line
// ---------------------------------------------------------------------------
// The same calm pacing as the Quick Reset preset in BreathingTool (4 in, 2 hold,
// 6 out, 2 hold): a reset that speeds the athlete up is not a reset.

export const BREATH_PHASES = [4, 2, 6, 2] as const;
export const BREATH_LABELS = ["Breathe in", "Hold", "Breathe out", "Hold"] as const;
export const BREATH_CYCLE_SECONDS = BREATH_PHASES.reduce((sum, phase) => sum + phase, 0);

/**
 * Which phase the athlete is in after `elapsed` seconds, and how much of it is
 * left. Pure so the overlay can be driven by a timer without the phase maths
 * living inside a React effect.
 */
export function breathPhaseAt(elapsed: number): { index: number; remaining: number } {
  const seconds = Math.max(0, Math.floor(elapsed));
  let offset = seconds % BREATH_CYCLE_SECONDS;
  for (let index = 0; index < BREATH_PHASES.length; index += 1) {
    const phase = BREATH_PHASES[index];
    if (offset < phase) return { index, remaining: phase - offset };
    offset -= phase;
  }
  return { index: 0, remaining: BREATH_PHASES[0] };
}

export type BreathRunState = "idle" | "running" | "done";

/** A breathing run ends on a whole number of cycles, never mid-exhale. */
export const BREATH_RUN_SECONDS = BREATH_CYCLE_SECONDS * 4;

// ---------------------------------------------------------------------------
// 6. Between-events reset and post-event notes
// ---------------------------------------------------------------------------

export const RESET_MINUTES = [3, 5, 10, 15] as const;

export type EventNote = {
  id: string;
  /** The event this note belongs to, or the athlete's own word for it. */
  event: string;
  worked: string;
  fix: string;
  felt: string;
  /** ISO timestamp, so a stack of notes reads in the order it happened. */
  at: string;
};

const clean = (value: unknown, max = 240): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function readNotes(): EventNote[] {
  const stored = lsGet<unknown>(EVENT_MODE_KEYS.notes, []);
  if (!Array.isArray(stored)) return [];
  const notes: EventNote[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<EventNote>;
    const worked = clean(row.worked);
    const fix = clean(row.fix);
    const felt = clean(row.felt, 80);
    if (!worked && !fix && !felt) continue;
    notes.push({
      id: typeof row.id === "string" && row.id ? row.id : makeEventId(notes.length),
      event: clean(row.event, 60) || "Event",
      worked,
      fix,
      felt,
      at: typeof row.at === "string" && row.at ? row.at : new Date().toISOString(),
    });
  }
  return notes.slice(-20);
}

export function addNote(notes: EventNote[], input: Omit<EventNote, "id" | "at">, now: Date = new Date()): EventNote[] {
  const note: EventNote = {
    id: makeEventId(now.getTime()),
    event: clean(input.event, 60) || "Event",
    worked: clean(input.worked),
    fix: clean(input.fix),
    felt: clean(input.felt, 80),
    at: now.toISOString(),
  };
  if (!note.worked && !note.fix && !note.felt) return notes;
  return [...notes, note].slice(-20);
}

export function removeNote(notes: EventNote[], id: string): EventNote[] {
  return notes.filter((note) => note.id !== id);
}

export function writeNotes(notes: EventNote[]): void {
  lsSet(EVENT_MODE_KEYS.notes, notes.slice(-20));
}
