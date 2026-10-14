import { describe, expect, it } from "vitest";
import {
  challengeCopy,
  claimDevicePingSlot,
  countWeekOneSessions,
  devicePingBudgetLeft,
  eveningCopy,
  firstSessionOfPlan,
  LOW_BALANCE_REPEAT_DAYS,
  LOW_BALANCE_THRESHOLD,
  lowBalanceCopy,
  MAX_DEVICE_PINGS_PER_DAY,
  morningCopy,
  morningTimeForDate,
  motivatorForDate,
  nextMorningDates,
  planCreatedCopy,
  POOR_READINESS_THRESHOLD,
  poorRecoveryCopy,
  reengagementCopy,
  resolveScheduledTime,
  sessionForDate,
  streakCopy,
  streakFinalCopy,
  type PlanLike,
} from "./notificationTriggers";
import { morningIdForDate } from "./localNotifications";

// Seven Monday-first entries, matching both plan writers (day 1-7, Mon-Sun).
const weekSessions = (titles: (string | null)[]) =>
  titles.map((t, i) =>
    t === null
      ? { day: i + 1, title: "Rest Day", type: "rest", duration_minutes: 0, isRest: true }
      : { day: i + 1, title: t, type: "strength", duration_minutes: 45 },
  );

const plan: PlanLike = {
  id: "plan-1",
  title: "Speed Running Plan",
  sport: "Running",
  week_current: 1,
  duration_weeks: 4,
  plan_data: [{ week: 1, sessions: weekSessions(["Intervals", "Easy run", "Tempo", null, "Long run", "Recovery", null]) }],
};

// A Monday (2026-10-12) so weekday mapping is unambiguous.
const MONDAY = new Date(2026, 9, 12, 8, 0, 0);
const TUESDAY = new Date(2026, 9, 13, 8, 0, 0);
const THURSDAY_REST = new Date(2026, 9, 15, 8, 0, 0);

describe("morning timing", () => {
  it("posts at 07:10 sharp in the athlete's own clock", () => {
    const at = morningTimeForDate(new Date(2026, 9, 14, 22, 15));
    expect(at.getHours()).toBe(7);
    expect(at.getMinutes()).toBe(10);
    expect(at.getSeconds()).toBe(0);
    expect(at.getDate()).toBe(14);
  });

  it("skips today once 07:10 has passed", () => {
    const after = new Date(2026, 9, 14, 8, 0, 0);
    const days = nextMorningDates(after, 7);
    expect(days).toHaveLength(6);
    expect(days[0].getDate()).toBe(15);
  });

  it("includes today when opened before 07:10", () => {
    const before = new Date(2026, 9, 14, 6, 0, 0);
    const days = nextMorningDates(before, 7);
    expect(days).toHaveLength(7);
    expect(days[0].getDate()).toBe(14);
  });

  it("leaves 07:10 alone with no quiet hours", () => {
    const at = resolveScheduledTime(new Date(2026, 9, 14), 7, 10, {});
    expect(at?.getHours()).toBe(7);
    expect(at?.getMinutes()).toBe(10);
  });

  it("shifts the morning past quiet end when 07:10 is inside it", () => {
    const at = resolveScheduledTime(new Date(2026, 9, 14), 7, 10, {
      quiet_start: "22:00:00",
      quiet_end: "08:00:00",
    });
    // 08:00 end + 15 min grace.
    expect(at?.getHours()).toBe(8);
    expect(at?.getMinutes()).toBe(15);
  });

  it("skips the morning when quiet runs past 11:00", () => {
    const at = resolveScheduledTime(new Date(2026, 9, 14), 7, 10, {
      quiet_start: "22:00:00",
      quiet_end: "11:00:00",
    });
    expect(at).toBeNull();
  });

  it("skips (never shifts) non-morning times inside quiet hours", () => {
    const at = resolveScheduledTime(new Date(2026, 9, 14), 18, 0, {
      quiet_start: "17:00:00",
      quiet_end: "19:00:00",
    });
    expect(at).toBeNull();
  });
});

describe("session picking", () => {
  it("matches Monday's session by day number", () => {
    expect(sessionForDate(plan, MONDAY)?.title).toBe("Intervals");
  });

  it("matches mid-week days too", () => {
    expect(sessionForDate(plan, TUESDAY)?.title).toBe("Easy run");
  });

  it("returns null on rest days (stays silent, no false nudge)", () => {
    expect(sessionForDate(plan, THURSDAY_REST)).toBeNull();
  });

  it("returns null with no plan", () => {
    expect(sessionForDate(null, MONDAY)).toBeNull();
  });

  it("finds the first session and week-1 count for the plan-created line", () => {
    expect(firstSessionOfPlan(plan)?.title).toBe("Intervals");
    expect(countWeekOneSessions(plan)).toBe(5);
  });
});

describe("copy", () => {
  it("announces the plan with its first session", () => {
    const copy = planCreatedCopy(plan);
    expect(copy.title).toBe("Your Running plan is ready 🎯");
    expect(copy.body).toContain("Week 1 has 5 sessions");
    expect(copy.body).toContain("starting with Intervals");
  });

  it("briefs today's session in the morning", () => {
    const copy = morningCopy(sessionForDate(plan, MONDAY), MONDAY);
    expect(copy.title).toBe("Today: Intervals 💪");
    expect(copy.body).toContain("45 min");
    expect(copy.body.length).toBeGreaterThan(20);
  });

  it("rests on rest days instead of nudging", () => {
    const copy = morningCopy(sessionForDate(plan, THURSDAY_REST), THURSDAY_REST);
    expect(copy.title).toContain("Recovery");
  });

  it("nudges in the evening with the short-session escape hatch", () => {
    const copy = eveningCopy("Speed Running Plan", 2, 2, 20);
    expect(copy.title).toContain("still waiting");
    expect(copy.body).toContain("Week 2 of Speed Running Plan");
    expect(copy.body).toContain("Even 20 minutes counts");
  });

  it("warns about the streak with real numbers", () => {
    const copy = streakCopy(9, 2);
    expect(copy.title).toBe("9-day streak at risk 🔥");
    expect(copy.body).toContain("before midnight");
  });

  it("counts challenge deadlines down (3 days, tomorrow, today)", () => {
    expect(challengeCopy("Summer Shred", 3, 40).title).toContain("ends in 3 days");
    expect(challengeCopy("Summer Shred", 1, 0).title).toContain("ends tomorrow");
    expect(challengeCopy("Summer Shred", 0, 90).title).toContain("ends today");
    expect(challengeCopy("Summer Shred", 3, 0).body).toContain("haven't logged");
  });

  it("welcomes back the lapsed athlete without shame", () => {
    const copy = reengagementCopy(5);
    expect(copy.title).toContain("We miss you");
    expect(copy.body).toContain("kept your place");
    expect(copy.body).not.toMatch(/lazy|quit|gave up/i);
  });

  it("rotates the motivator by date, deterministically", () => {
    expect(motivatorForDate(MONDAY)).toBe(motivatorForDate(new Date(2026, 9, 12, 20, 0)));
  });
});

describe("new reasons", () => {
  it("warns about low credits without shame or jargon", () => {
    const copy = lowBalanceCopy(9);
    expect(copy.title).toContain("credits");
    expect(copy.body).toContain("9");
    expect(copy.body).toContain("Market");
    expect(copy.body).not.toMatch(/lazy|quit|gave up|stupid/i);
  });

  it("handles an empty balance as its own case", () => {
    expect(lowBalanceCopy(0).body).toContain("out of credits");
    expect(lowBalanceCopy(1).body).toContain("1 credit left");
  });

  it("keeps the low-balance line rare by contract", () => {
    expect(LOW_BALANCE_THRESHOLD).toBe(15);
    expect(LOW_BALANCE_REPEAT_DAYS).toBe(3);
  });

  it("treats readiness at the bad-day line as poor, gently", () => {
    expect(POOR_READINESS_THRESHOLD).toBe(35);
    const copy = poorRecoveryCopy(28);
    expect(copy.body).toContain("28");
    expect(copy.body).not.toMatch(/lazy|quit|gave up|no excuses|push through/i);
  });

  it("pushes the final streak rep by name", () => {
    const copy = streakFinalCopy(9);
    expect(copy.title).toContain("day 10");
    expect(copy.body).toContain("midnight");
  });
});

describe("anti-bombardment budget", () => {
  it("allows two shade pings a day, then stays silent", () => {
    localStorage.clear();
    expect(devicePingBudgetLeft()).toBe(true);
    expect(claimDevicePingSlot()).toBe(true);
    expect(claimDevicePingSlot()).toBe(true);
    expect(MAX_DEVICE_PINGS_PER_DAY).toBe(2);
    expect(claimDevicePingSlot()).toBe(false);
    expect(devicePingBudgetLeft()).toBe(false);
  });
});

describe("stable device ids", () => {
  it("gives each calendar day its own morning id", () => {
    const a = morningIdForDate(new Date(2026, 9, 14));
    const b = morningIdForDate(new Date(2026, 9, 15));
    expect(a).not.toBe(b);
    expect(morningIdForDate(new Date(2026, 9, 14, 23, 59))).toBe(a);
  });
});
