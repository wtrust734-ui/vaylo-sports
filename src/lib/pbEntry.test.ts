import { describe, expect, it } from "vitest";
import { formatPbSeconds, formatPbValue, parsePbText } from "./pbEntry";

describe("parsePbText", () => {
  it("reads a distance and a clock", () => {
    expect(parsePbText("5K in 22:14")).toMatchObject({
      metric: "5K",
      value: 1334,
      unit: "time",
      display: "22:14",
      lowerIsBetter: true,
    });
  });

  it("reads an hours-long clock", () => {
    expect(parsePbText("marathon 3:15:30")).toMatchObject({
      metric: "Marathon",
      value: 11730,
      display: "3:15:30",
    });
  });

  it("reads a labelled lift", () => {
    expect(parsePbText("Bench press 120 kg")).toMatchObject({
      metric: "Bench press",
      value: 120,
      unit: "kg",
      display: "120 kg",
      lowerIsBetter: false,
    });
  });

  it("reads reps with no unit word", () => {
    expect(parsePbText("20 pull ups")).toMatchObject({
      metric: "Pull ups",
      value: 20,
      unit: "reps",
    });
  });

  it("infers kilos for a lift with a bare number", () => {
    expect(parsePbText("Deadlift 180")).toMatchObject({
      metric: "Deadlift",
      value: 180,
      unit: "kg",
    });
  });

  it("reads a sprint time in seconds", () => {
    expect(parsePbText("40m sprint 5.1s")).toMatchObject({
      metric: "40m sprint",
      value: 5.1,
      unit: "time",
      display: "5.1s",
    });
  });

  it("reads minutes as a time", () => {
    expect(parsePbText("5K 22 min")).toMatchObject({
      metric: "5K",
      value: 1320,
      unit: "time",
      display: "22:00",
    });
  });

  it("does not treat a held time as a race", () => {
    expect(parsePbText("plank 3:00")).toMatchObject({
      metric: "Plank",
      value: 180,
      unit: "time",
      lowerIsBetter: false,
    });
  });

  it("rejects text with no measurable number", () => {
    expect(parsePbText("felt good today")).toBeNull();
    expect(parsePbText("")).toBeNull();
  });
});

describe("formatPbValue", () => {
  it("formats stored times without a unit suffix", () => {
    expect(formatPbValue({ metric: "5K", value: 1334, unit: "time" })).toBe("22:14");
    expect(formatPbValue({ metric: "Pull ups", value: 20, unit: "reps" })).toBe("20 reps");
  });

  it("formats long times with hours", () => {
    expect(formatPbSeconds(11730)).toBe("3:15:30");
  });
});
