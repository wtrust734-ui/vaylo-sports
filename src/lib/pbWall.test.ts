import { beforeEach, describe, expect, it } from "vitest";
import { PB_STORE_KEY, recordTimedPb, wallForEvaluation } from "./pbWall";

const readWall = () => JSON.parse(localStorage.getItem(PB_STORE_KEY) ?? "[]");

describe("pbWall: the log-save flow's PB write is an improvement only", () => {
  beforeEach(() => localStorage.clear());

  it("a first time is recorded as a PB", () => {
    expect(recordTimedPb("Running · 5K", 1500)).toEqual({ isPb: true, previousSeconds: null });
    expect(readWall()[0]).toMatchObject({ metric: "Running · 5K", value: 1500, unit: "" });
  });

  it("a slower time is not recorded", () => {
    recordTimedPb("Running · 5K", 1500);
    expect(recordTimedPb("Running · 5K", 1600)).toEqual({ isPb: false, previousSeconds: 1500 });
    expect(readWall()).toHaveLength(1);
    expect(readWall()[0].value).toBe(1500);
  });

  it("a faster time updates value and history", () => {
    recordTimedPb("Running · 5K", 1500);
    expect(recordTimedPb("Running · 5K", 1400)).toEqual({ isPb: true, previousSeconds: 1500 });
    const entry = readWall()[0];
    expect(entry.value).toBe(1400);
    expect(entry.history).toHaveLength(2);
  });

  it("treats a hand-typed 5K and the event ladder's Running · 5K as one record", () => {
    recordTimedPb("5K", 1500);
    expect(recordTimedPb("Running · 5K", 1600)).toEqual({ isPb: false, previousSeconds: 1500 });
    expect(recordTimedPb("Running · 5K", 1400).isPb).toBe(true);
    expect(readWall()).toHaveLength(1);
    expect(readWall()[0]).toMatchObject({ metric: "5K", value: 1400 });
  });

  it("matching is case-insensitive on the metric label", () => {
    recordTimedPb("running · 5k", 1500);
    expect(recordTimedPb("Running · 5K", 1400).isPb).toBe(true);
    expect(readWall()).toHaveLength(1);
  });

  it("the wall reduces to the evaluation shape, skipping junk", () => {
    recordTimedPb("Running · 5K", 1500);
    expect(wallForEvaluation()).toEqual([{ metric: "Running · 5K", value: 1500 }]);
  });
});
