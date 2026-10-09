// Offline snapshot cache.
//
// Two properties matter beyond "it stores and reads": the cache is scoped per
// user (a shared phone must not hand one athlete another's training), and it
// reports the AGE of every snapshot, because an offline screen that shows stale
// data without saying so is a lie rather than a fallback.

import { beforeEach, describe, expect, it } from "vitest";
import { CACHE_TTLS, cacheAgeLabel, cacheClear, cacheRead, cacheWrite } from "./offlineCache";

beforeEach(() => localStorage.clear());

describe("cacheWrite / cacheRead", () => {
  it("round-trips a snapshot with its age", () => {
    expect(cacheWrite("u1", "today", { title: "Intervals" })).toBe(true);

    const read = cacheRead<{ title: string }>("u1", "today");

    expect(read?.data).toEqual({ title: "Intervals" });
    expect(read?.ageMs).toBeGreaterThanOrEqual(0);
    expect(read?.stale).toBe(false);
  });

  it("misses when nothing was written", () => {
    expect(cacheRead("u1", "goals")).toBeNull();
  });

  it("never hands one athlete another's snapshot", () => {
    cacheWrite("u1", "history", ["private"]);

    expect(cacheRead("u2", "history")).toBeNull();
    expect(cacheRead("u1", "history")?.data).toEqual(["private"]);
  });

  it("refuses to write without a user id", () => {
    expect(cacheWrite("", "today", { a: 1 })).toBe(false);
    expect(cacheRead("", "today")).toBeNull();
  });

  it("survives corrupt storage rather than throwing", () => {
    localStorage.setItem("vaylo.cache.v1.u1.today", "{not json");

    expect(cacheRead("u1", "today")).toBeNull();
  });

  it("rejects an envelope with no timestamp", () => {
    localStorage.setItem("vaylo.cache.v1.u1.today", JSON.stringify({ data: { a: 1 } }));

    expect(cacheRead("u1", "today")).toBeNull();
  });

  it("marks a snapshot stale past its own TTL, and not before", () => {
    const age = (key: "today" | "profile", ms: number) =>
      localStorage.setItem(
        `vaylo.cache.v1.u1.${key}`,
        JSON.stringify({ savedAt: Date.now() - ms, data: { a: 1 } }),
      );

    age("today", CACHE_TTLS.today - 60_000);
    expect(cacheRead("u1", "today")?.stale).toBe(false);

    age("today", CACHE_TTLS.today + 60_000);
    expect(cacheRead("u1", "today")?.stale).toBe(true);

    // The SAME age is not stale for a key with a longer life.
    age("profile", CACHE_TTLS.today + 60_000);
    expect(cacheRead("u1", "profile")?.stale).toBe(false);
  });

  it("overwrites in place rather than accumulating", () => {
    cacheWrite("u1", "today", { v: 1 });
    cacheWrite("u1", "today", { v: 2 });

    expect(cacheRead("u1", "today")?.data).toEqual({ v: 2 });
  });
});

describe("cacheClear", () => {
  it("clears one key", () => {
    cacheWrite("u1", "today", { a: 1 });
    cacheWrite("u1", "goals", { b: 2 });

    cacheClear("u1", "today");

    expect(cacheRead("u1", "today")).toBeNull();
    expect(cacheRead("u1", "goals")?.data).toEqual({ b: 2 });
  });

  it("clears only the named user when clearing everything", () => {
    cacheWrite("u1", "today", { a: 1 });
    cacheWrite("u1", "goals", { b: 2 });
    cacheWrite("u2", "today", { c: 3 });

    cacheClear("u1");

    expect(cacheRead("u1", "today")).toBeNull();
    expect(cacheRead("u1", "goals")).toBeNull();
    expect(cacheRead("u2", "today")?.data).toEqual({ c: 3 });
  });

  it("leaves the offline write queue alone", () => {
    // The queue lives in the same localStorage and holds unsent athlete data.
    // A cache clear must never be the thing that deletes it.
    localStorage.setItem("vaylo.offlineQueue.v1", JSON.stringify([{ id: "a", table: "t", values: {} }]));
    cacheWrite("u1", "today", { a: 1 });

    cacheClear("u1");

    expect(localStorage.getItem("vaylo.offlineQueue.v1")).not.toBeNull();
  });
});

describe("cacheAgeLabel", () => {
  it("stays coarse, because the screen is offline by definition", () => {
    expect(cacheAgeLabel(30_000)).toBe("a moment ago");
    expect(cacheAgeLabel(5 * 60_000)).toBe("5 minutes ago");
    expect(cacheAgeLabel(60 * 60_000)).toBe("1 hour ago");
    expect(cacheAgeLabel(3 * 60 * 60_000)).toBe("3 hours ago");
    expect(cacheAgeLabel(2 * 24 * 60 * 60_000)).toBe("2 days ago");
    expect(cacheAgeLabel(21 * 24 * 60 * 60_000)).toBe("3 weeks ago");
  });
});
