// Anonymous, non-login recovery check-in streak.
//
// The streak is driven by recovery check-ins recorded against a session key
// persisted in localStorage — no sign-in required. A returning device reuses the
// same session key, so the streak survives app restarts and does not depend on
// an account being created.
//
// Days are local calendar days (localDateKey), the same contract the rest of the
// app uses for streaks and daily logs.

import { daysBetween, localDateKey } from "./dates";

/** Local-storage keys (exported for tests so they can reset the ledger). */
export const SESSION_KEY = "vaylo_session_key";
export const LOG_KEY = "vaylo_recovery_streak_logs";

export interface RecoveryStreak {
  current: number;
  longest: number;
  checkInToday: boolean;
}

/** Stable anonymous session id for this device. Created once, reused forever. */
export function sessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    // Pseudo-random but stable across restarts: not a security boundary, just a
    // device identifier for a local streak ledger.
    id = "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      // private mode — streak degrades to zero, nothing breaks
    }
  }
  return id;
}

/** All check-in timestamps for this session, most recent first. */
function logs(): { date: string; at: number }[] {
  // IMPORTANT: each entry MUST carry its session id so that clearing the session
  // key does not leave stale log entries behind (test isolation and real device
  // replacement both depend on this).
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { date: string; at: number; sid?: string }[];
    return Array.isArray(parsed) ? parsed.filter((l) => !l.sid || l.sid === sessionId()) : [];
  } catch {
    return [];
  }
}

function saveLogs(logs_: { date: string; at: number; sid?: string }[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs_.slice(0, 365).map((l) => ({ ...l, sid: l.sid ?? sessionId() })))); // one year cap
  } catch {
    /* private mode */
  }
}

/** Consecutive local calendar days ending today with a recovery check-in. */
export function getCurrentStreak(): RecoveryStreak {
  const today = localDateKey();
  const dates = new Set(logs().filter((l) => l.date).map((l) => l.date));

  // Build the streak: walk back from today (or yesterday if no check-in today).
  const cursor = new Date();
  const cursorToday = localDateKey(cursor);
  if (!dates.has(cursorToday)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let current = 0;
  for (;;) {
    const key = localDateKey(cursor);
    if (!dates.has(key)) break;
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Longest streak ever for this session: scan the sorted date list and count
  // consecutive runs (day-delta of 1 between adjacent keys).
  const sorted = [...dates].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of sorted) {
    const delta = prev ? daysBetween(prev, key) : null;
    run = delta === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = key;
  }

  return {
    current,
    longest: Math.max(longest, current),
    checkInToday: dates.has(today),
  };
}

/** Record that a recovery check-in just happened for this session. */
export function markCheckInDone(): RecoveryStreak {
  sessionId(); // ensure the anonymous session key exists before writing
  const today = localDateKey();
  const existing = logs();
  const filtered = existing.filter((l) => l.date !== today);
  filtered.unshift({ date: today, at: Date.now() });
  saveLogs(filtered);
  return getCurrentStreak();
}
