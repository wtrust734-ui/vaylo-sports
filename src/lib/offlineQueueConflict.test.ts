// Conflict-safe replay for the offline write queue.
//
// The property under test is the one the specification calls "prevent accidental
// overwrites": when a row was edited on another device while this device was
// offline, replaying the offline edit must not silently discard the other
// device's work. The rule implemented is that only the FIELDS THE ATHLETE
// ACTUALLY CHANGED are ever sent — so a change to a field nobody touched here
// survives — and where both sides changed the SAME field to different values,
// nothing is sent and the athlete is asked.
//
// supabase-js is mocked at the module boundary, so the merge logic is exercised
// for real.

import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const updateWhere = vi.fn();
const update = vi.fn((values: unknown) => ({
  eq: (column: string, value: string) => updateWhere(values, column, value),
}));
/** `select("*").eq("id", id).maybeSingle()` — the baseline read. */
const maybeSingle = vi.fn();
const select = vi.fn(() => ({
  eq: () => ({ maybeSingle: () => maybeSingle() }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (...args: unknown[]) => insert(...args),
      update: (values: unknown) => update(values),
      select: () => select(),
    }),
  },
}));

import {
  clearQueue,
  flushQueue,
  pendingConflicts,
  pendingWrites,
  resolveConflict,
  snapshotOf,
  updateOrQueue,
} from "./offlineQueue";

const offlineError = () => Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" });

/** A row as the client held it when the offline edit was made. */
const BASE = { note: "first", title: "Long run", event_type: "travel" };

beforeEach(() => {
  insert.mockReset();
  update.mockClear();
  updateWhere.mockReset();
  select.mockClear();
  maybeSingle.mockReset();
  updateWhere.mockResolvedValue({ error: null });
  clearQueue();
  localStorage.clear();
});

describe("updateOrQueue with a baseline", () => {
  it("records the baseline so a later replay can tell edits apart", async () => {
    updateWhere.mockResolvedValue({ error: offlineError() });

    const result = await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(pendingWrites()[0].base).toEqual(BASE);
    expect(pendingWrites()[0].op).toBe("update");
  });

  it("still queues without a baseline, keeping its old unconditional meaning", async () => {
    updateWhere.mockResolvedValue({ error: offlineError() });

    await updateOrQueue("life_events", "e1", { note: "no baseline" });

    expect(pendingWrites()[0].base).toBeUndefined();
  });
});

describe("flushQueue — merging over a concurrent change", () => {
  it("sends only the field the athlete changed", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });

    // The server row is exactly as this client last saw it.
    maybeSingle.mockResolvedValue({ data: { id: "e1", ...BASE }, error: null });
    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(updateWhere).toHaveBeenLastCalledWith({ note: "edited offline" }, "id", "e1");
    expect(pendingWrites()).toHaveLength(0);
  });

  it("never overwrites a field another device changed", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });

    // Another device edited `title` while this one was offline.
    maybeSingle.mockResolvedValue({
      data: { id: "e1", note: "first", title: "CHANGED ELSEWHERE", event_type: "travel" },
      error: null,
    });
    const sent = await flushQueue();

    expect(sent).toBe(1);
    const payload = updateWhere.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).toEqual({ note: "edited offline" });
    // The other device's title is absent from the write, so it survives.
    expect(payload).not.toHaveProperty("title");
  });

  it("asks rather than guessing when both sides changed the same field", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });

    maybeSingle.mockResolvedValue({
      data: { id: "e1", note: "edited on another device", title: "Long run", event_type: "travel" },
      error: null,
    });
    const sent = await flushQueue();

    // Nothing was written and nothing was dropped.
    expect(sent).toBe(0);
    expect(updateWhere).toHaveBeenCalledTimes(1); // the original attempt only
    const queued = pendingWrites();
    expect(queued).toHaveLength(1);
    expect(queued[0].values).toEqual({ note: "edited offline" });
    expect(pendingConflicts()).toHaveLength(1);
    expect(pendingConflicts()[0].conflict?.fields).toEqual(["note"]);
    expect(pendingConflicts()[0].conflict?.reason).toBe("concurrent_edit");
    expect(pendingConflicts()[0].conflict?.server.note).toBe("edited on another device");
  });

  it("treats a field with no recorded baseline as a clash", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    // `note` is in values but absent from base: we cannot prove what the
    // athlete was looking at, so the honest answer is to ask.
    await updateOrQueue("life_events", "e1", { note: "x", extra: "y" }, { base: { note: "first" } });

    maybeSingle.mockResolvedValue({ data: { id: "e1", note: "first", extra: "z" }, error: null });
    await flushQueue();

    expect(pendingConflicts()[0].conflict?.fields).toEqual(["extra"]);
  });

  it("does not retry a conflict on the next flush", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "mine" }, { base: BASE });
    maybeSingle.mockResolvedValue({ data: { id: "e1", ...BASE, note: "theirs" }, error: null });
    await flushQueue();
    const readsAfterFirst = maybeSingle.mock.calls.length;

    await flushQueue();

    expect(maybeSingle.mock.calls.length).toBe(readsAfterFirst);
    expect(pendingConflicts()).toHaveLength(1);
  });

  it("keeps a conflict from blocking the writes behind it", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "conflicted", { note: "mine" }, { base: BASE });
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "clean", { note: "unchanged baseline" }, { base: BASE });

    maybeSingle.mockImplementation((table?: string) => undefined);
    // First read: concurrent edit. Second read: untouched row.
    maybeSingle
      .mockResolvedValueOnce({ data: { id: "conflicted", ...BASE, note: "theirs" }, error: null })
      .mockResolvedValueOnce({ data: { id: "clean", ...BASE }, error: null });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites().map((w) => w.id)).toEqual(["conflicted"]);
  });

  it("drops an edit the server has already applied", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });

    // The new value is already there — another device, or an earlier replay.
    maybeSingle.mockResolvedValue({ data: { id: "e1", ...BASE, note: "edited offline" }, error: null });
    const sent = await flushQueue();

    expect(sent).toBe(0);
    expect(pendingWrites()).toHaveLength(0);
  });

  it("retains the edit with an error when the row is gone", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await flushQueue();

    expect(pendingWrites()).toHaveLength(1);
    expect(pendingWrites()[0].lastError).toBe("no row matched");
  });

  it("refuses to write when the baseline could not be read", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "edited offline" }, { base: BASE });
    maybeSingle.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("permission denied"), { code: "42501" }),
    });

    const sent = await flushQueue();

    expect(sent).toBe(0);
    expect(updateWhere).toHaveBeenCalledTimes(1); // never sent blind
    expect(pendingConflicts()[0].conflict?.reason).toBe("baseline_unreadable");
  });

  it("stops the run and keeps everything when the baseline read is offline", async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "one" }, { base: BASE });
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e2", { note: "two" }, { base: BASE });
    maybeSingle.mockResolvedValue({ data: null, error: offlineError() });

    const sent = await flushQueue();

    expect(sent).toBe(0);
    expect(pendingWrites()).toHaveLength(2);
    expect(pendingConflicts()).toHaveLength(0);
  });
});

describe("resolveConflict", () => {
  const seed = async () => {
    updateWhere.mockResolvedValueOnce({ error: offlineError() });
    await updateOrQueue("life_events", "e1", { note: "mine" }, { base: BASE });
    maybeSingle.mockResolvedValue({ data: { id: "e1", ...BASE, note: "theirs" }, error: null });
    await flushQueue();
  };

  it("\"theirs\" discards the queued edit without a write", async () => {
    await seed();
    updateWhere.mockClear();

    const result = await resolveConflict("e1", "theirs");

    expect(result.ok).toBe(true);
    expect(updateWhere).not.toHaveBeenCalled();
    expect(pendingWrites()).toHaveLength(0);
    expect(pendingConflicts()).toHaveLength(0);
  });

  it("\"mine\" overwrites with the athlete's values and clears the queue", async () => {
    await seed();

    const result = await resolveConflict("e1", "mine");

    expect(result.ok).toBe(true);
    expect(updateWhere).toHaveBeenLastCalledWith({ note: "mine" }, "id", "e1");
    expect(pendingWrites()).toHaveLength(0);
  });

  it("sends hand-picked values when the athlete merges", async () => {
    await seed();

    const result = await resolveConflict("e1", { note: "merged" });

    expect(result.ok).toBe(true);
    expect(updateWhere).toHaveBeenLastCalledWith({ note: "merged" }, "id", "e1");
    expect(pendingWrites()).toHaveLength(0);
  });

  it("keeps the decision queued and reports failure when still offline", async () => {
    await seed();
    updateWhere.mockResolvedValueOnce({ error: offlineError() });

    const result = await resolveConflict("e1", "mine");

    expect(result.ok).toBe(false);
    const queued = pendingWrites();
    expect(queued).toHaveLength(1);
    expect(queued[0].values).toEqual({ note: "mine" });
    // The baseline is cleared, so replaying cannot ask the same question twice.
    expect(queued[0].base).toBeUndefined();
    expect(pendingConflicts()).toHaveLength(0);
  });

  it("is a no-op for an id that is no longer queued", async () => {
    const result = await resolveConflict("missing", "mine");
    expect(result.ok).toBe(true);
  });
});

describe("snapshotOf", () => {
  it("keeps a name for every field, so there are no gaps to clash on", () => {
    const base = snapshotOf({ note: "a", title: "b" }, ["note", "title", "missing"]);
    expect(base).toEqual({ note: "a", title: "b", missing: undefined });
    expect(Object.prototype.hasOwnProperty.call(base, "missing")).toBe(true);
  });

  it("records an explicit undefined when there is no row to read", () => {
    expect(snapshotOf(null, ["note"])).toEqual({ note: undefined });
  });
});


it("preserves a conflict when the following write hits a network failure", async () => {
  updateWhere.mockResolvedValue({ error: offlineError() });
  await updateOrQueue("life_events", "one", { note: "mine" }, { base: { note: "original" } });
  await updateOrQueue("life_events", "two", { note: "mine" }, { base: { note: "original" } });
  maybeSingle.mockResolvedValueOnce({ data: { note: "other" }, error: null }).mockResolvedValueOnce({ data: null, error: offlineError() });
  await flushQueue();
  expect(pendingWrites().map(w => w.id)).toEqual(["one", "two"]);
  expect(pendingConflicts().map(w => w.id)).toEqual(["one"]);
});

it("preserves the earliest baseline across repeated offline edits", async () => {
  updateWhere.mockResolvedValueOnce({ error: offlineError() });
  await updateOrQueue("life_events", "one", { note: "first" }, { base: { note: "original" } });
  await updateOrQueue("life_events", "one", { note: "second" }, { base: { note: "first" } });
  maybeSingle.mockResolvedValue({ data: { note: "original" }, error: null });
  expect(await flushQueue()).toBe(1);
  expect(updateWhere).toHaveBeenLastCalledWith({ note: "second" }, "id", "one");
  expect(pendingConflicts()).toEqual([]);
});


it("retries a baseline read after the session is refreshed", async () => {
  updateWhere.mockResolvedValueOnce({ error: offlineError() });
  await updateOrQueue("life_events", "expired", { note: "mine" }, { base: { note: "original" } });
  maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
  await flushQueue();
  expect(pendingConflicts()).toEqual([]);
  expect(pendingWrites()).toHaveLength(1);
  maybeSingle.mockResolvedValueOnce({ data: { note: "original" }, error: null });
  expect(await flushQueue()).toBe(1);
  expect(pendingWrites()).toEqual([]);
});
