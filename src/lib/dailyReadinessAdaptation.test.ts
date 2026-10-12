import { describe, expect, it } from "vitest";

import {
  adaptDailyPlanForReadiness,
  restoreDailyPlanForReadiness,
  type DailyPlanWeek,
} from "./dailyReadinessAdaptation";

describe("adaptDailyPlanForReadiness", () => {
  it("swaps a hard CAUTION day with an easy next day", () => {
    const result = adaptDailyPlanForReadiness({
      weeks: [
        {
          week: 1,
          sessions: [
            { day: 1, title: "Hard intervals", type: "intervals", duration_minutes: 60 },
            { day: 2, title: "Easy recovery", type: "recovery", duration_minutes: 30 },
          ],
        },
      ],
      week: 1,
      day: 1,
      zone: "CAUTION",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    });

    expect(result.changed).toBe(true);
    expect(result.mode).toBe("swap");
    expect(result.weeks[0].sessions[0].title).toBe("Easy recovery");
    expect(result.weeks[0].sessions[0]._movedFromDay).toBe(2);
    expect(result.weeks[0].sessions[1].title).toBe("Hard intervals");
    expect(result.weeks[0].sessions[1]._movedFromDay).toBe(1);
    expect(result.events.map((event) => event.status)).toEqual(["modified", "rescheduled"]);
  });

  it("replaces a RED day with recovery when there is no easy session to swap", () => {
    const result = adaptDailyPlanForReadiness({
      weeks: [
        {
          week: 1,
          sessions: [
            { day: 1, title: "Hard intervals", type: "intervals", duration_minutes: 60 },
            { day: 2, title: "Another hard workout", type: "strength", duration_minutes: 60 },
          ],
        },
      ],
      week: 1,
      day: 1,
      zone: "RED",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    });

    expect(result.changed).toBe(true);
    expect(result.mode).toBe("replace");
    expect(result.weeks[0].sessions[0].type).toBe("recovery");
    expect(result.weeks[0].sessions[1].title).toBe("Another hard workout");
    expect(result.events).toHaveLength(1);
  });

  it("records the session it replaced, so the adaptation is reversible", () => {
    // A RED day with no easy session to trade with: the workout is replaced with
    // recovery in place, and the copy of what stood there is the only way back —
    // the replaced session cannot be recovered by arithmetic.
    const result = adaptDailyPlanForReadiness({
      weeks: [
        {
          week: 1,
          sessions: [
            { day: 1, title: "Hard intervals", type: "intervals", duration_minutes: 60 },
            { day: 2, title: "Another hard workout", type: "strength", duration_minutes: 60 },
          ],
        },
      ],
      week: 1,
      day: 1,
      zone: "RED",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    });

    expect(result.mode).toBe("replace");
    expect(result.weeks[0].sessions[0]._originalSession).toMatchObject({
      day: 1,
      title: "Hard intervals",
      type: "intervals",
      duration_minutes: 60,
    });
  });

  it("does not stack the same adaptation when saved again", () => {
    const weeks = [
      {
        week: 1,
        sessions: [
          { day: 1, title: "Hard intervals", type: "intervals", duration_minutes: 60 },
          { day: 2, title: "Easy recovery", type: "recovery", duration_minutes: 30 },
        ],
      },
    ];
    const first = adaptDailyPlanForReadiness({
      weeks,
      week: 1,
      day: 1,
      zone: "CAUTION",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    });
    const second = adaptDailyPlanForReadiness({
      weeks: first.weeks,
      week: 1,
      day: 1,
      zone: "CAUTION",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });
});

describe("restoreDailyPlanForReadiness", () => {
  const hardAndEasy: DailyPlanWeek[] = [
    {
      week: 1,
      sessions: [
        { day: 1, title: "Hard intervals", type: "intervals", duration_minutes: 60 },
        { day: 2, title: "Easy recovery", type: "recovery", duration_minutes: 30 },
      ],
    },
  ];

  const swapped = () =>
    adaptDailyPlanForReadiness({
      weeks: hardAndEasy,
      week: 1,
      day: 1,
      zone: "CAUTION",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    }).weeks;

  it("puts a swapped day back on its own day when the next check-in is good", () => {
    const restored = restoreDailyPlanForReadiness({ weeks: swapped(), logDate: "2024-02-02" });

    expect(restored.changed).toBe(true);
    expect(restored.restored).toBe(2);
    // Both halves come back: the hard session returns to today, and the easy
    // session returns to tomorrow, exactly as the plan had them.
    expect(restored.weeks[0].sessions[0]).toMatchObject({
      day: 1,
      title: "Hard intervals",
      type: "intervals",
      duration_minutes: 60,
    });
    expect(restored.weeks[0].sessions[1]).toMatchObject({ day: 2, title: "Easy recovery" });
    // And the stamps go with it, so the same day is not "already adapted" for
    // the rest of the plan's life.
    expect(restored.weeks[0].sessions[0]._adaptedFor).toBeUndefined();
    expect(restored.weeks[0].sessions[0]._originalSession).toBeUndefined();
  });

  it("restores a reduced session to the duration and sets it had", () => {
    const reduced = adaptDailyPlanForReadiness({
      weeks: [
        {
          week: 1,
          sessions: [
            {
              day: 1,
              title: "Hard intervals",
              type: "intervals",
              duration_minutes: 60,
              exercises: [{ name: "400m repeats", sets: "8x400m" }],
            },
          ],
        },
      ],
      week: 1,
      day: 1,
      zone: "CAUTION",
      logDate: "2024-02-01",
      todayDate: "2024-02-01",
      tomorrowDate: "2024-02-02",
    }).weeks;

    const restored = restoreDailyPlanForReadiness({ weeks: reduced, logDate: "2024-02-02" });
    expect(restored.weeks[0].sessions[0].duration_minutes).toBe(60);
    expect(restored.weeks[0].sessions[0].title).toBe("Hard intervals");
    expect(restored.weeks[0].sessions[0].exercises).toEqual([{ name: "400m repeats", sets: "8x400m" }]);
  });

  it("never undoes today's own check-in, and leaves a plan with no stamps alone", () => {
    // The same log date means the adaptation the athlete is looking at is the
    // one being saved right now: running the restore first is what makes the
    // pair idempotent, and it must not then delete today's decision.
    const sameDay = restoreDailyPlanForReadiness({ weeks: swapped(), logDate: "2024-02-01" });
    expect(sameDay.changed).toBe(false);

    const untouched = restoreDailyPlanForReadiness({ weeks: hardAndEasy, logDate: "2024-02-02" });
    expect(untouched.changed).toBe(false);
    expect(untouched.weeks).toEqual(hardAndEasy);
    expect(restoreDailyPlanForReadiness({ weeks: null, logDate: "2024-02-02" }).changed).toBe(false);
  });
});
