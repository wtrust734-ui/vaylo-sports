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
  flushQueue,
  insertOrQueue,
  isNetworkError,
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

  it("refuses capacity overflow while retaining every acknowledged write", async () => {
    insert.mockResolvedValue({ error: offlineError() });

    for (let i = 0; i < 105; i++) {
      const result = await insertOrQueue("workouts", { id: `w${i}`, title: `set ${i}`, n: i });
      expect(result.ok).toBe(i < 100);
    }

    const queue = pendingWrites();
    expect(queue).toHaveLength(100);
    expect(queue[0].id).toBe("w0");
    expect(queue[queue.length - 1].id).toBe("w99");
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

  it("retains a deleted-row edit while allowing later writes to sync", async () => {
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
    expect(pendingWrites().map(w => w.id)).toEqual(["deleted-since"]);
    expect(pendingWrites()[0].lastError).toBeTruthy();
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

  it("retains a rejected write while allowing later writes to sync", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "bad", n: 1 });
    await insertOrQueue("workouts", { id: "good", n: 2 });
    insert.mockReset();
    insert
      .mockResolvedValueOnce({ error: rejectError("invalid input value") })
      .mockResolvedValueOnce({ error: null });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites().map(w => w.id)).toEqual(["bad"]);
    expect(pendingWrites()[0].lastError).toBe("invalid input value");
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

describe("queue regression sequences", () => {
  it("preserves an append made while a replay is waiting", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "first" });
    let release!: (value: { error: null }) => void;
    insert.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const flushing = flushQueue();
    await insertOrQueue("workouts", { id: "second" });
    release({ error: null });
    await flushing;
    expect(pendingWrites().map(w => w.id)).toEqual(["second"]);
  });

  it("retains an edit made during an insert and replays it as an update", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "first", completed: false });
    let release!: (value: { error: null }) => void;
    insert.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const flushing = flushQueue();
    expect(await updateOrQueue("workouts", "first", { completed: true })).toMatchObject({ ok: true, queued: true });
    expect(updateWhere).not.toHaveBeenCalled();
    release({ error: null });
    await flushing;
    expect(pendingWrites()[0]).toMatchObject({ op: "update", values: { completed: true }, base: { completed: false } });
  });

  it("reports storage failure without accepting an undurable write", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    try {
      expect(await insertOrQueue("workouts", { id: "lost" })).toMatchObject({ ok: false, queued: false });
      expect(pendingWrites()).toEqual([]);
    } finally { storage.mockRestore(); }
  });

  it("retains an expired-session rejection for retry", async () => {
    insert.mockResolvedValue({ error: offlineError() });
    await insertOrQueue("workouts", { id: "pending" });
    insert.mockResolvedValueOnce({ error: { code: "PGRST301", status: 401, message: "JWT expired" } });
    expect(await flushQueue()).toBe(0);
    expect(pendingWrites()[0]).toMatchObject({ id: "pending", lastError: "JWT expired" });
    insert.mockResolvedValueOnce({ error: null });
    expect(await flushQueue()).toBe(1);
    expect(pendingWrites()).toEqual([]);
  });
});
