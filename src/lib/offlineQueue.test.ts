// Behaviour tests for the offline write queue.
//
// The queue is the one place where the app silently holds an athlete's data and
// replays it later, so the interesting properties are all about *what must not
// happen*: a server rejection must never be queued (it would retry forever), a
// queued write must never be duplicated, a still-offline replay must stop
// rather than burn through the queue, and a write whose row already landed must
// be dropped rather than blocking everything behind it.
//
// supabase-js is mocked at the module boundary so the queue's own logic —
// which is pure — is exercised for real rather than re-asserted in source
// comments.

import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
/** `update(values).eq("id", id)` — the only shape the queue issues. */
const updateWhere = vi.fn();
const update = vi.fn((values: unknown) => ({
  eq: (column: string, value: string) => updateWhere(values, column, value),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (...args: unknown[]) => insert(...args),
      update: (values: unknown) => update(values),
    }),
  },
}));

import {
  clearQueue,
  dismissFailures,
  flushQueue,
  insertOrQueue,
  isNetworkError,
  pendingFailures,
  pendingWrites,
  subscribeToQueue,
  updateOrQueue,
  updateQueued,
} from "./offlineQueue";

/** A realistic supabase-js connectivity failure. */
const offlineError = () => Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" });
/** A realistic server-shaped refusal: HTTP status plus a Postgres code. */
const rejectError = (message: string, code = "23514") =>
  Object.assign(new Error(message), { status: 400, code });

beforeEach(() => {
  insert.mockReset();
  update.mockClear();
  updateWhere.mockReset();
  // Updating an existing row succeeds unless a test says otherwise.
  updateWhere.mockResolvedValue({ error: null });
  clearQueue();
  localStorage.clear();
});

describe("isNetworkError", () => {
  it("recognises connectivity failures", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
    expect(isNetworkError(new Error("Connection closed"))).toBe(true);
  });

  it("never treats a server answer as a connectivity failure", () => {
    // The whole point: a 402 for insufficient credits is a real refusal. Queue
    // it and the athlete is never told, and it retries until the queue is full.
    expect(isNetworkError(rejectError("Not enough credits"))).toBe(false);
    expect(isNetworkError({ status: 500, message: "internal error" })).toBe(false);
    expect(isNetworkError({ status: 401, message: "JWT expired" })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError({ message: "row-level security violation" })).toBe(false);
  });
});

describe("insertOrQueue", () => {
  it("sends the write straight through when the network is fine", async () => {
    insert.mockResolvedValue({ error: null });

    const result = await insertOrQueue("workouts", { title: "Bench" });

    expect(result).toMatchObject({ ok: true, queued: false });
    expect(insert).toHaveBeenCalledTimes(1);
    // The row carries a client-generated id, which is also the replay key.
    expect(insert.mock.calls[0][0]).toMatchObject({ title: "Bench" });
    expect(insert.mock.calls[0][0].id).toEqual(expect.any(String));
    expect(pendingWrites()).toHaveLength(0);
  });

  it("keeps a caller-supplied id so an update can find the queued row", async () => {
    insert.mockResolvedValue({ error: null });

    const result = await insertOrQueue("workouts", { id: "fixed-id", title: "Bench" });

    expect(result.id).toBe("fixed-id");
    expect(insert.mock.calls[0][0].id).toBe("fixed-id");
  });

  it("queues on a connectivity failure and tells the caller it is held", async () => {
    insert.mockResolvedValue({ error: offlineError() });

    const result = await insertOrQueue("workouts", { title: "Dead spot set" });

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(pendingWrites()).toHaveLength(1);
    expect(pendingWrites()[0]).toMatchObject({ table: "workouts" });
    expect(pendingWrites()[0].values).toMatchObject({ title: "Dead spot set" });
  });

  it("refuses — loudly — when the server rejects the row", async () => {
    const error = rejectError("violates row-level security policy");
    insert.mockResolvedValue({ error });

    const result = await insertOrQueue("workouts", { title: "Nope" });

    expect(result.ok).toBe(false);
    expect(result.queued).toBe(false);
    expect(result.error).toBe(error);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("does not stack a second copy of the same write", async () => {
    insert.mockResolvedValue({ error: offlineError() });

    const first = await insertOrQueue("workouts", { id: "same", title: "A" });
    await insertOrQueue("workouts", { id: "same", title: "B" });

    expect(first.queued).toBe(true);
    expect(pendingWrites()).toHaveLength(1);
  });
});

describe("queue durability", () => {
  it("survives a corrupted store by discarding it rather than throwing", async () => {
    localStorage.setItem(
      "vaylo.offlineQueue.v1",
      JSON.stringify([{ nope: true }, null, "garbage", { id: "a", table: "workouts", values: {} }])
    );
    // A fresh module-level read is what a relaunch does.
    const { pendingWrites: fresh } = await import("./offlineQueue");
    expect(fresh().map((w) => w.id)).toEqual(["a"]);
    clearQueue();
  });

  it("evicts the oldest write past the bound instead of refusing the newest", async () => {
    insert.mockResolvedValue({ error: offlineError() });

    for (let i = 0; i < 105; i++) {
      await insertOrQueue("workouts", { id: `w${i}`, title: `set ${i}`, n: i });
    }

    const queue = pendingWrites();
    expect(queue).toHaveLength(100);
    expect(queue[0].id).toBe("w5");
    expect(queue[queue.length - 1].id).toBe("w104");
  });

  it("subscribers see the queue immediately and on every change", async () => {
    const seen: number[] = [];
    const off = subscribeToQueue((q) => seen.push(q.length));
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { title: "A" });
    await insertOrQueue("workouts", { title: "B" });
    off();
    await insertOrQueue("workouts", { title: "C" });

    expect(seen).toEqual([0, 1, 2]);
  });
});

describe("updateQueued", () => {
  it("folds a completion into the queued insert", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    const started = await insertOrQueue("workouts", { id: "s1", title: "Squats", completed: false });

    // The real failure this prevents: `update where id = s1` matches no row,
    // because the row only exists in the queue.
    expect(updateQueued(started.id, { completed: true, reps: 30 })).toBe(true);

    const [entry] = pendingWrites();
    expect(entry.values).toMatchObject({ title: "Squats", completed: true, reps: 30 });
    expect(pendingWrites()).toHaveLength(1);
  });

  it("reports false for a row that is not queued, so the caller falls back", async () => {
    expect(updateQueued("never-queued", { completed: true })).toBe(false);
  });
});

describe("updateOrQueue", () => {
  it("updates in place when the network is fine", async () => {
    const result = await updateOrQueue("life_events", "e1", { note: "moved" });

    expect(result).toMatchObject({ ok: true, queued: false });
    expect(update).toHaveBeenCalledTimes(1);
    // Addressed by primary key and nothing else: a queued write that could
    // target an arbitrary predicate would be a statement nobody verified.
    expect(updateWhere.mock.calls[0]).toEqual([{ note: "moved" }, "id", "e1"]);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("queues the edit when the network is down, recorded as an update", async () => {
    updateWhere.mockResolvedValue({ error: offlineError() });

    const result = await updateOrQueue("life_events", "e1", { end_date: "2026-11-01" });

    expect(result).toMatchObject({ ok: true, queued: true });
    const [entry] = pendingWrites();
    expect(entry).toMatchObject({ id: "e1", table: "life_events", op: "update" });
    expect(entry.values).toEqual({ end_date: "2026-11-01" });
  });

  it("folds into a still-queued insert instead of stacking a second entry", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("life_events", { id: "e2", event_type: "holiday", end_date: "2026-10-10" });
    updateWhere.mockResolvedValue({ error: offlineError() });

    const result = await updateOrQueue("life_events", "e2", { end_date: "2026-10-20" });

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(pendingWrites()).toHaveLength(1);
    // Still an INSERT, and deliberately so: the row has never reached the
    // server, so the single write that eventually lands must be the finished
    // version. A separate update would arrive after it, or not at all.
    expect(pendingWrites()[0].op).toBeUndefined();
    expect(pendingWrites()[0].values).toMatchObject({
      event_type: "holiday",
      end_date: "2026-10-20",
    });
  });

  it("refuses loudly when the server rejects the edit", async () => {
    const error = rejectError("new row violates check constraint", "23514");
    updateWhere.mockResolvedValue({ error });

    const result = await updateOrQueue("life_events", "e1", { end_date: "2000-01-01" });

    expect(result.ok).toBe(false);
    expect(result.queued).toBe(false);
    expect(result.error).toBe(error);
    expect(pendingWrites()).toHaveLength(0);
  });
});

describe("flushQueue", () => {
  it("replays a queued update through update, never through insert", async () => {
    updateWhere.mockResolvedValue({ error: offlineError() });
    await updateOrQueue("life_events", "e9", { note: "edited offline" });
    updateWhere.mockReset();
    updateWhere.mockResolvedValue({ error: null });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    // Replaying this as an INSERT would collide on the primary key and be
    // dropped as "already landed" — the edit would be lost, silently.
    expect(insert).not.toHaveBeenCalled();
    expect(updateWhere.mock.calls[0]).toEqual([{ note: "edited offline" }, "id", "e9"]);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("drops an update whose row is gone instead of blocking the queue behind it", async () => {
    updateWhere.mockResolvedValue({ error: offlineError() });
    await updateOrQueue("life_events", "deleted-since", { note: "x" });
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "after", n: 1 });

    // PGRST116 is PostgREST's "no row matched". The row was deleted between
    // queueing and replay, so it can never succeed.
    updateWhere.mockResolvedValue({
      error: rejectError("JSON object requested, no rows returned", "PGRST116"),
    });
    insert.mockResolvedValue({ error: null });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("replays oldest-first and empties on success", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "a", n: 1 });
    await insertOrQueue("workouts", { id: "b", n: 2 });
    insert.mockReset();
    insert.mockResolvedValue({ error: null });

    const sent = await flushQueue();

    expect(sent).toBe(2);
    expect(insert.mock.calls.map((c) => c[0].id)).toEqual(["a", "b"]);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("stops at the first network failure and keeps that write and everything after it", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "a", n: 1 });
    await insertOrQueue("workouts", { id: "b", n: 2 });
    await insertOrQueue("workouts", { id: "c", n: 3 });
    insert.mockReset();
    insert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValue({ error: offlineError() });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites().map((w) => w.id)).toEqual(["b", "c"]);
  });

  it("drops a write the server can never accept instead of blocking the queue", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "bad", n: 1 });
    await insertOrQueue("workouts", { id: "good", n: 2 });
    insert.mockReset();
    insert
      .mockResolvedValueOnce({ error: rejectError("invalid input value") })
      .mockResolvedValueOnce({ error: null });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("counts a duplicate key as landed, so a crash mid-replay cannot double-log", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "a", n: 1 });
    insert.mockReset();
    insert.mockResolvedValue({ error: rejectError("duplicate key value", "23505") });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("is single-flight: a second caller does not replay the same rows twice", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "a", n: 1 });
    insert.mockReset();
    let release: (() => void) | undefined;
    insert.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ error: null })))
    );

    const first = flushQueue();
    const second = await flushQueue();
    expect(second).toBe(0);
    release!();
    await first;
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when the queue is empty", async () => {
    expect(await flushQueue()).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("dead letters — a change given up on is still reported", () => {
  it("records a rejected write with the server's own reason", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "refused", n: 1 });
    insert.mockReset();
    insert.mockResolvedValue({ error: rejectError("invalid input value for enum") });

    expect(await flushQueue()).toBe(0);

    // Out of the queue (it could never succeed and would block the rest), but
    // not out of the app's knowledge.
    expect(pendingWrites()).toHaveLength(0);
    expect(pendingFailures()).toHaveLength(1);
    expect(pendingFailures()[0]).toMatchObject({
      id: "refused",
      table: "workouts",
      reason: "rejected",
      message: "invalid input value for enum",
      code: "23514",
    });
  });

  it("records an update whose row was deleted before it could be sent", async () => {
    updateWhere.mockResolvedValue({ error: offlineError() });
    await updateOrQueue("life_events", "gone", { note: "x" });
    updateWhere.mockReset();
    updateWhere.mockResolvedValue({
      error: rejectError("JSON object requested, no rows returned", "PGRST116"),
    });

    await flushQueue();

    expect(pendingFailures()[0]).toMatchObject({
      id: "gone",
      table: "life_events",
      reason: "row_missing",
      code: "PGRST116",
    });
  });

  it("records the oldest change when the queue overflows instead of dropping it in silence", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    for (let i = 0; i <= 100; i++) await insertOrQueue("workouts", { id: `w${i}`, n: i });

    // 101 writes against a cap of 100: the oldest is the one that pays for it.
    expect(pendingWrites()).toHaveLength(100);
    expect(pendingWrites()[0].id).toBe("w1");
    expect(pendingFailures()).toHaveLength(1);
    expect(pendingFailures()[0]).toMatchObject({ id: "w0", table: "workouts", reason: "overflow" });
  });

  it("keeps them until they are acknowledged, across later successful drains", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "a", n: 1 });
    insert.mockReset();
    insert.mockResolvedValue({ error: rejectError("row-level security") });
    await flushQueue();

    // A drain that succeeds does not erase the record of one that was refused.
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "b", n: 2 });
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
    expect(await flushQueue()).toBe(1);
    expect(pendingFailures()).toHaveLength(1);

    dismissFailures();
    expect(pendingFailures()).toHaveLength(0);
  });
});