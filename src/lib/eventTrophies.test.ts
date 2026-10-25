import { describe, expect, it } from "vitest";
import {
  bestTierForTime,
  EVENT_TROPHY_EVENTS,
  evaluateLogAgainstEvents,
  formatRaceTime,
  matchEvent,
  tiersForTime,
  trophyRewardId,
} from "./eventTrophies";

const run5 = () => EVENT_TROPHY_EVENTS.find((e) => e.id === "run_5k")!;

describe("matchEvent: same-sport + distance only", () => {
  it("matches a standard event", () => {
    expect(matchEvent("Running", 5)?.id).toBe("run_5k");
  });

  it("matches inside the 2% distance tolerance", () => {
    expect(matchEvent("Running", 4.95)?.id).toBe("run_5k");
    expect(matchEvent("Running", 5.1)?.id).toBe("run_5k");
  });

  it("never matches a different sport", () => {
    // A 5K football match distance is no one's 5K running trophy.
    expect(matchEvent("Football", 5)).toBeNull();
    expect(matchEvent("Football", 5.1)).toBeNull();
    expect(matchEvent("Running", 5)).toBeDefined();
  });

  it("rejects unknown, unmeasured and missing distances", () => {
    expect(matchEvent("Trampoline", 5)).toBeNull();
    expect(matchEvent("Running", NaN)).toBeNull();
    expect(matchEvent("Running", 0)).toBeNull();
  });

  it("is case-insensitive and ignores blank padding", () => {
    expect(matchEvent(" running ", 5)?.id).toBe("run_5k");
    expect(matchEvent("General", 5)).toBeNull();
  });
});

describe("tiersForTime: the trophy ladder is exact", () => {
  it("a time below every threshold earns nothing", () => {
    expect(tiersForTime(run5(), 1801)).toEqual([]);
    expect(bestTierForTime(run5(), 1801)).toBeNull();
  });

  it("Bronze exactly at the line, not one second slower", () => {
    expect(tiersForTime(run5(), 1800)).toEqual(["bronze"]);
  });

  it("Silver meets-or-beats Silver and also earns Bronze, best-first", () => {
    expect(tiersForTime(run5(), 1440)).toEqual(["silver", "bronze"]);
    expect(bestTierForTime(run5(), 1440)).toBe("silver");
  });

  it("Gold earns all three, best-first", () => {
    expect(tiersForTime(run5(), 1099)).toEqual(["gold", "silver", "bronze"]);
    expect(bestTierForTime(run5(), 1099)).toBe("gold");
  });

  it("negative, zero and non-finite times earn nothing", () => {
    expect(tiersForTime(run5(), 0)).toEqual([]);
    expect(tiersForTime(run5(), -1)).toEqual([]);
    expect(tiersForTime(run5(), NaN)).toEqual([]);
  });
});

describe("formatRaceTime", () => {
  it("is mm:ss under an hour and h:mm:ss above", () => {
    expect(formatRaceTime(599)).toBe("9:59");
    expect(formatRaceTime(600)).toBe("10:00");
    expect(formatRaceTime(7200)).toBe("2:00:00");
    expect(formatRaceTime(0)).toBe("—");
  });
});

describe("evaluateLogAgainstEvents: PB + trophies for one log", () => {
  const firstEver = { sport: "Running", log_type: "race", distance_km: 5, time_seconds: 1810 };

  it("a first 5K slower than Bronze earns the PB but no trophy", () => {
    const ev1 = evaluateLogAgainstEvents(firstEver, []);
    expect(ev1.event?.id).toBe("run_5k");
    expect(ev1.isPb).toBe(true);
    expect(ev1.previous_seconds).toBeNull();
    expect(ev1.rewardIds).toEqual([]);
    expect(ev1.tier).toBeNull();
  });

  it("a first 5K at 25:00 earns Bronze only", () => {
    const ev = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1500 }, []);
    expect(ev.rewardIds).toEqual([trophyRewardId("run_5k", "bronze")]);
    expect(ev.tier).toBe("bronze");
  });

  it("a first 5K at 23:59 earns Bronze and Silver", () => {
    const ev = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1439 }, []);
    expect(ev.rewardIds).toEqual([
      trophyRewardId("run_5k", "silver"),
      trophyRewardId("run_5k", "bronze"),
    ]);
  });

  it("a first 5K at 18:19 earns all three tiers, best-first", () => {
    const ev = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1099 }, []);
    expect(ev.rewardIds).toEqual([
      trophyRewardId("run_5k", "gold"),
      trophyRewardId("run_5k", "silver"),
      trophyRewardId("run_5k", "bronze"),
    ]);
  });

  it("beating a stored PB re-evaluates against the faster of the two", () => {
    const stored = [{ metric: "Running · 5K", value: 1440 }];
    const faster = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1099 }, stored);
    expect(faster.isPb).toBe(true);
    expect(faster.previous_seconds).toBe(1440);
    expect(faster.tier).toBe("gold");
  });

  it("a slower run than the stored PB is not a PB but the athlete's best tier still shows", () => {
    const stored = [{ metric: "Running · 5K", value: 1099 }];
    const slower = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1500 }, stored);
    expect(slower.isPb).toBe(false);
    expect(slower.previous_seconds).toBe(1099);
    expect(slower.tier).toBe("gold");
  });

  it("matches a hand-typed event label without the sport prefix", () => {
    const stored = [{ metric: "5K", value: 1440 }];
    const ev = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1500 }, stored);
    expect(ev.isPb).toBe(false);
    expect(ev.previous_seconds).toBe(1440);
  });

  it("does not borrow another sport's bare event label", () => {
    const stored = [{ metric: "Cycling · 5K", value: 600 }];
    const ev = evaluateLogAgainstEvents({ ...firstEver, time_seconds: 1500 }, stored);
    expect(ev.isPb).toBe(true);
    expect(ev.previous_seconds).toBeNull();
  });

  it("untimed or non-event logs evaluate to nothing", () => {
    const blank = [] as { metric: string; value: number }[];
    expect(evaluateLogAgainstEvents({ sport: "Running", log_type: "race", distance_km: 5, time_seconds: null }, blank).event).toBeNull();
    expect(evaluateLogAgainstEvents({ sport: "Football", log_type: "race", distance_km: 5, time_seconds: 5400 }, blank).event).toBeNull();
  });
});
