import { describe, expect, it, beforeEach } from "vitest";
import {
  sessionId,
  getCurrentStreak,
  markCheckInDone,
  LOG_KEY,
  SESSION_KEY,
} from "./recoveryStreak";
import { localDateKey, localDateKeyDaysAgo } from "./dates";

// Clear the localStorage keys used by the streak module before each test, so no
// test inherits another test's ledger or session id.
const clearStreakStorage = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* jsdom */
  }
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* jsdom */
  }
};

/** Write a ledger entry directly, stamped with the current session id. */
const writeEntry = (date: string, at: number) => {
  const current = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as unknown[];
  current.unshift({ date, at, sid: sessionId() });
  localStorage.setItem(LOG_KEY, JSON.stringify(current));
};

describe("anonymous recovery streak", () => {
  beforeEach(clearStreakStorage);

  it("creates a stable session key on first call", () => {
    const a = sessionId();
    expect(a).toMatch(/^s_[a-z0-9]+$/);
    expect(sessionId()).toBe(a);
  });

  it("returns zero streak when no check-ins recorded", () => {
    expect(getCurrentStreak()).toEqual({ current: 0, longest: 0, checkInToday: false });
  });

  it("counts one day after a single check-in", () => {
    markCheckInDone();
    expect(getCurrentStreak()).toEqual({ current: 1, longest: 1, checkInToday: true });
  });

  it("counts consecutive local days (today + yesterday)", () => {
    writeEntry(localDateKeyDaysAgo(1), Date.now() - 86_400_000);
    markCheckInDone();
    expect(getCurrentStreak()).toEqual({ current: 2, longest: 2, checkInToday: true });
  });

  it("breaks the current streak at a missing day but keeps history", () => {
    // Today, and two days ago — yesterday missing.
    writeEntry(localDateKeyDaysAgo(2), Date.now() - 2 * 86_400_000);
    markCheckInDone();
    const s = getCurrentStreak();
    expect(s.current).toBe(1); // the gap stops the run at today
    expect(s.longest).toBeGreaterThanOrEqual(1);
  });

  it("does not count today's check-in before it happens", () => {
    writeEntry(localDateKeyDaysAgo(1), Date.now() - 86_400_000);
    writeEntry(localDateKeyDaysAgo(2), Date.now() - 2 * 86_400_000);
    const s = getCurrentStreak();
    expect(s.checkInToday).toBe(false);
    // The run is still alive: it is counted from yesterday backwards.
    expect(s.current).toBe(2);
  });

  it("resets the streak when the anonymous session is replaced", () => {
    markCheckInDone();
    expect(getCurrentStreak().current).toBe(1);
    // A fresh device / cleared non-login session: new session id, and the old
    // session's check-ins no longer count.
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOG_KEY);
    expect(getCurrentStreak()).toEqual({ current: 0, longest: 0, checkInToday: false });
  });

  it("ignores ledger entries that belong to another session", () => {
    markCheckInDone();
    const stale = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    localStorage.setItem(LOG_KEY, JSON.stringify(stale.map((e: { date: string; at: number }) => ({ ...e, sid: "s_other" }))));
    expect(getCurrentStreak().current).toBe(0);
  });

  it("markCheckInDone records today and returns updated streak", () => {
    const before = getCurrentStreak();
    expect(before.checkInToday).toBe(false);
    expect(before.current).toBe(0);
    const after = markCheckInDone();
    expect(after.checkInToday).toBe(true);
    expect(after.current).toBe(1);
    // Idempotent within the same day — a second check-in does not double count.
    expect(markCheckInDone().current).toBe(1);
  });

  it("keeps the ledger to one entry per day", () => {
    markCheckInDone();
    markCheckInDone();
    const ledger = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as { date: string }[];
    expect(ledger.filter((e) => e.date === localDateKey()).length).toBe(1);
  });
});
