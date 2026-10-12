import { describe, expect, it } from "vitest";

import { adaptDailyPlanForReadiness } from "./dailyReadinessAdaptation";

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
