// ============================================================================
// EVENT MODE — the parts that must not silently break
// ----------------------------------------------------------------------------
// Event Mode is used standing up, outdoors, minutes before a start, once. The
// two ways it can fail are both invisible in a screenshot:
//
//   * state that does not survive the app being closed at the track (ticks, the
//     schedule, the notes), and
//   * a countdown that moves on to the next event on its own, so the athlete
//     who is still waiting for a delayed 200m is being told to run the 800m.
//
// Both are pinned here, alongside the composition of the screen itself: the
// three quick actions have to open something.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import RaceMode from "@/components/mental/RaceMode";
import EventChecklist from "@/components/mental/EventChecklist";
import EventDaySchedule from "@/components/mental/EventDaySchedule";
import EventNotes from "@/components/mental/EventNotes";
import {
  BREATH_CYCLE_SECONDS,
  CHECKLIST_ITEMS,
  CHECKLIST_TOTAL,
  EVENT_MODE_KEYS,
  addNote,
  addSlot,
  breathPhaseAt,
  checklistCount,
  checklistKey,
  countdownLabel,
  formatCountdown,
  minutesUntil,
  nextSlot,
  readChecklist,
  readNotes,
  readSchedule,
  rotateIndex,
  sortSchedule,
  writeChecklist,
  writeNotes,
  writeSchedule,
  type EventSlot,
} from "@/lib/eventMode";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const slot = (name: string, time: string, done = false): EventSlot => ({ id: `${name}-${time}`, name, time, done });

describe("the event-day helpers", () => {
  it("keeps the start list in time order", () => {
    const ordered = sortSchedule([slot("800m", "15:40"), slot("200m", "14:30"), slot("Long jump", "08:00")]);
    expect(ordered.map((s) => s.name)).toEqual(["Long jump", "200m", "800m"]);
  });

  it("advances 'next' only when an event is marked done, not when its time passes", () => {
    const day = [slot("200m", "14:30"), slot("800m", "15:40")];
    // 15:00 — the 200m has gone off, but the athlete has not marked it done, so
    // the day has not moved on. A delayed start is normal.
    expect(nextSlot(day)?.name).toBe("200m");
    expect(nextSlot([slot("200m", "14:30", true), slot("800m", "15:40")])?.name).toBe("800m");
    expect(nextSlot([slot("200m", "14:30", true)])).toBeNull();
  });

  it("refuses an event with no name or an impossible time", () => {
    const day = sortSchedule([]);
    expect(addSlot(day, "", "14:30")).toEqual(day);
    expect(addSlot(day, "200m", "25:99")).toEqual(day);
    expect(addSlot(day, "200m", "14:30")).toHaveLength(1);
  });

  it("resets the checklist with the calendar day", () => {
    writeChecklist({ kit: true }, "2026-10-11");
    expect(checklistCount(readChecklist("2026-10-11"))).toBe(1);
    expect(checklistCount(readChecklist("2026-10-12"))).toBe(0);
    // A stale key that no longer maps to an item cannot inflate the count.
    writeChecklist({ gone: true } as Record<string, boolean>, "2026-10-13");
    expect(checklistCount(readChecklist("2026-10-13"))).toBe(0);
    expect(checklistKey("2026-10-11")).toBe(`${EVENT_MODE_KEYS.checklist}:2026-10-11`);
  });

  it("counts down to a wall-clock time, and says so once it has gone off", () => {
    const now = new Date("2026-10-11T14:18:00");
    expect(minutesUntil("14:30", now)).toBe(12);
    expect(countdownLabel("14:30", now)).toBe("in 12m");
    expect(countdownLabel("14:18", now)).toBe("now");
    expect(countdownLabel("14:00", now)).toBe("started");
    expect(formatCountdown(64_000)).toBe("1m 04s");
    expect(formatCountdown(3_840_000)).toBe("1h 04m");
  });

  it("puts the athlete in the right breath phase after N seconds", () => {
    expect(breathPhaseAt(0)).toEqual({ index: 0, remaining: 4 });
    expect(breathPhaseAt(4)).toEqual({ index: 1, remaining: 2 });
    expect(breathPhaseAt(6)).toEqual({ index: 2, remaining: 6 });
    expect(breathPhaseAt(12)).toEqual({ index: 3, remaining: 2 });
    // A full cycle wraps to the first phase, never off the end.
    expect(breathPhaseAt(BREATH_CYCLE_SECONDS)).toEqual({ index: 0, remaining: 4 });
  });

  it("rotates cue words and wraps", () => {
    expect(rotateIndex(0, 3)).toBe(1);
    expect(rotateIndex(2, 3)).toBe(0);
    expect(rotateIndex(0, 0)).toBe(0);
  });

  it("keeps notes on the device, newest last, and ignores an empty one", () => {
    const notes = addNote(readNotes(), { event: "200m", worked: "Start", fix: "", felt: "" });
    writeNotes(notes);
    expect(readNotes()).toHaveLength(1);
    expect(readNotes()[0].worked).toBe("Start");
    expect(addNote(readNotes(), { event: "200m", worked: "  ", fix: "", felt: "" })).toHaveLength(1);
  });
});

describe("the pre-event checklist", () => {
  it("counts up as items are ticked, and remembers them", () => {
    render(<EventChecklist />);

    expect(screen.getByText(`0 of ${CHECKLIST_TOTAL} ready`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Kit and number/ }));

    expect(screen.getByText(`1 of ${CHECKLIST_TOTAL} ready`)).toBeInTheDocument();
    expect(readChecklist()[CHECKLIST_ITEMS[0].id]).toBe(true);
  });
});

describe("the day's events", () => {
  it("adds an event, counts it in, and moves on when it is done", () => {
    const onChange = vi.fn();
    const day = addSlot([], "800m", "15:40");
    render(<EventDaySchedule slots={day} onChange={onChange} />);

    expect(screen.getByText("Next up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Event done/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].done).toBe(true);
  });

  it("says what is wrong instead of adding a half-empty event", () => {
    const onChange = vi.fn();
    render(<EventDaySchedule slots={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "200m" } });
    fireEvent.click(screen.getByRole("button", { name: /Add event/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/name and a time like 14:30/i)).toBeInTheDocument();
  });
});

describe("the post-event note", () => {
  it("saves three lines to the device and shows them back", () => {
    render(<EventNotes defaultEvent="200m heat" onExit={() => {}} />);

    fireEvent.change(screen.getByLabelText(/What worked/i), { target: { value: "Start was sharp" } });
    fireEvent.click(screen.getByRole("button", { name: /Save note/ }));

    expect(readNotes()[0].worked).toBe("Start was sharp");
    expect(readNotes()[0].event).toBe("200m heat");
    expect(screen.getByText(/Start was sharp/)).toBeInTheDocument();
  });
});

describe("the event mode screen", () => {
  it("carries the day: schedule, checklist and one cue word", () => {
    render(<RaceMode cueWords={["Drive", "Tall"]} onExit={() => {}} />);

    expect(screen.getByText("Today\u2019s events")).toBeInTheDocument();
    expect(screen.getByText("Before you start")).toBeInTheDocument();
    expect(screen.getByText("Your cue")).toBeInTheDocument();
    // The word shows large and again as a chip to pin, so both are present.
    expect(screen.getAllByText(/Drive|Tall/).length).toBeGreaterThan(0);
  });

  it("opens a real guided breath rather than describing one", () => {
    render(<RaceMode cueWords={["Drive"]} onExit={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Breathe/ }));

    expect(screen.getByText("Breathe with me")).toBeInTheDocument();
    expect(screen.getByText(/Cycles: 0 of 4/)).toBeInTheDocument();
  });

  it("opens the between-events reset and the post-event note", () => {
    render(<RaceMode cueWords={["Drive"]} onExit={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Between events/ }));
    expect(screen.getByText(/How long until you need to move/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));

    fireEvent.click(screen.getByRole("button", { name: /After the event/ }));
    expect(screen.getByRole("button", { name: /Save note/ })).toBeInTheDocument();
  });

  it("pins a cue word so the rotation stops", () => {
    writeSchedule([]);
    render(<RaceMode cueWords={["Drive", "Tall"]} onExit={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /^Drive$/ }));

    expect(screen.getByRole("button", { name: /Unpin/ })).toBeInTheDocument();
    expect(localStorage.getItem(EVENT_MODE_KEYS.focus)).toBe(JSON.stringify("Drive"));
    expect(readSchedule()).toEqual([]);
  });
});
