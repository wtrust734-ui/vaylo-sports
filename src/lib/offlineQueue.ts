/** Durable offline writes. Failed replay stays queued until saved or resolved. */
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "vaylo.offlineQueue.v1";
/** Oldest-first, and bounded: a month of training, not a year. */
const MAX_QUEUED = 100;

export interface QueuedWrite {
  /** Client-generated primary key — also the replay idempotency key. */
  id: string;
  table: string;
  values: Record<string, unknown>;
  /** Epoch ms, for the UI's "3 unsynced" ordering and for expiry. */
  queuedAt: number;
  /**
   * What to replay. Absent means `insert`, so entries written by the previous
   * version of this module keep their original meaning.
   *
   * `update` exists because not every offline change is a new row. Editing a
   * break the athlete already saved used to be impossible offline: an update
   * cannot ride the insert path, because replaying an INSERT for a row that
   * already exists is a duplicate key — which `flushQueue` correctly treats as
   * "already landed" and drops.
   */
  op?: "insert" | "update";
  /**
   * The row's editable fields as THIS client last saw them, captured when the
   * edit was made. This is what makes a safe merge possible: on replay we can
   * tell a field the athlete's offline edit really changed from one another
   * device changed in the meantime, and we only ever send the former.
   *
   * Callers must include EVERY field they are updating. A field present in
   * `values` but absent here has an unknown baseline, and unknown is treated as
   * a clash — see `planUpdate`. `snapshotOf` builds a complete one.
   */
  base?: Record<string, unknown>;
  /** Set once a replay found the server had moved; cleared by resolveConflict. */
  conflict?: ConflictInfo | null;
  /** Last server rejection; retained for retry and shown by the sync surface. */
  lastError?: string;
}

/**
 * A queued edit that replay refused to apply, because the row changed on the
 * server in a way that overlaps with the offline edit.
 *
 * Nothing is discarded when this is set. The athlete's values are still in
 * `values`, the server's are in `server`, and the UI asks which to keep. That
 * is the point: a silent last-writer-wins would lose somebody's work, and
 * refusing the write without saying so would look like data loss.
 */
export interface ConflictInfo {
  detectedAt: number;
  /** Fields both sides changed, to different values. Empty when unreadable. */
  fields: string[];
  /** The server's current values, for the resolution UI. */
  server: Record<string, unknown>;
  /**
   * Why replay stopped.
   *
   *   concurrent_edit    — the row moved while this edit waited.
   *   baseline_unreadable — the row could not be read, so nothing could be
   *                        proven about it. Refusing is the safe reading.
   */
  reason?: "concurrent_edit" | "baseline_unreadable";
}

type Listener = (queue: QueuedWrite[]) => void;
const listeners = new Set<Listener>();
let cache: QueuedWrite[] | null = null;

function read(): QueuedWrite[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Validate rather than trust: a half-written or hand-edited entry would
    // otherwise reach an insert and fail forever in the replay loop.
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (w): w is QueuedWrite =>
            !!w && typeof w.id === "string" && typeof w.table === "string" && !!w.values,
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(queue: QueuedWrite[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    throw new Error("Couldn't save on this device. Free some storage and try again before closing the app.");
  }
  cache = queue;
  listeners.forEach((fn) => {
    try {
      fn([...queue]);
    } catch {
      /* a listener must not break the queue */
    }
  });
}

/** The current queue, oldest first. */
export const pendingWrites = (): QueuedWrite[] => [...read()].sort((a, b) => a.queuedAt - b.queuedAt);

/** Subscribe to queue changes; returns an unsubscribe function. */
export function subscribeToQueue(fn: Listener): () => void {
  listeners.add(fn);
  fn(pendingWrites());
  return () => listeners.delete(fn);
}

/** Test helper — clears both the store and the in-memory cache. */
export function clearQueue() {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
  listeners.forEach((fn) => fn([]));
}

/**
 * True when an error is a connectivity failure rather than a rejection.
 *
 * supabase-js reports these as `TypeError: Failed to fetch`; the HTTP-shaped
 * failures (401, 402, 409…) carry a status and must NOT be queued.
 */
export const isNetworkError = (error: unknown): boolean => {
  if (!error) return false;
  const e = error as { status?: number; message?: string; name?: string };
  // Any explicit status means the server answered. It said no.
  if (typeof e.status === "number" && e.status > 0) return false;
  const message = (e.message ?? "").toLowerCase();
  return (
    e.name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("connection")
  );
};

/**
 * A v4 UUID, for the rows the app seeds locally before they land.
 *
 * Exported because anything that builds a record the queue will eventually
 * carry needs the same identity on both sides of the write — a second
 * implementation here would be a second thing to keep correct on older WebViews.
 */
export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    // crypto.randomUUID is unavailable on the WebView's older origins and on
    // http://localhost before a secure context. The fallback is still a valid
    // v4 UUID, which is all the primary key needs.
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** The shape this module actually reads off a supabase-js result. */
interface InsertResult {
  error: { message: string; code?: string } | null;
}

/**
 * One typed seam for "insert a row into whichever table the caller named".
 *
 * supabase-js resolves `.insert()` against the union of every table's `Insert`
 * type in the generated schema, so a dynamic table name plus a generic payload
 * cannot typecheck — and hard-coding a union here would mean editing this file
 * every time a table is added. The queue is table-agnostic on purpose; the cast
 * is confined to these two lines rather than leaking `as never` across the
 * module. The result is still read for `error`, which is the only thing the
 * queue acts on.
 */
const insertRow = (table: string, values: Record<string, unknown>): Promise<InsertResult> =>
  (
    supabase.from(table as never) as unknown as {
      insert: (v: never) => Promise<InsertResult>;
    }
  ).insert(values as never);

/**
 * The same seam for an update of one row by primary key.
 *
 * Scoped to `id = …` and nothing else: the queue replays writes it generated,
 * and a queued write that could target an arbitrary predicate would be a way
 * to replay a statement nobody verified. Every table this queue touches is
 * keyed by a client-generated uuid, so the id is always the whole address.
 */
const updateRow = (table: string, id: string, values: Record<string, unknown>): Promise<InsertResult> =>
  (
    supabase.from(table as never) as unknown as {
      update: (v: never) => { eq: (col: string, val: string) => Promise<InsertResult> };
    }
  )
    .update(values as never)
    .eq("id", id);

/** Replay whichever operation the entry describes. */
const replay = (item: QueuedWrite): Promise<InsertResult> =>
  item.op === "update"
    ? updateRow(item.table, item.id, item.values)
    : insertRow(item.table, item.values);

/**
 * Inserts a row, queueing it if the network is down.
 *
 * Returns `{ ok: true, queued: false }` when it reached the database,
 * `{ ok: true, queued: true }` when it is safely held for replay, and
 * `{ ok: false }` when the write genuinely failed and the caller must tell the
 * athlete.
 */
export async function insertOrQueue(
  table: string,
  values: Record<string, unknown>,
): Promise<{ ok: boolean; queued: boolean; id: string; error?: unknown }> {
  const id = (values.id as string) ?? newId();
  const payload = { ...values, id };

  const { error } = await insertRow(table, payload);

  if (!error) return { ok: true, queued: false, id };

  if (!isNetworkError(error)) {
    // The server answered and refused. Surfacing it is the point.
    return { ok: false, queued: false, id, error };
  }

  const queue = read();
  if (queue.some((w) => w.id === id && w.table === table)) return { ok: true, queued: true, id };
  if (queue.length >= MAX_QUEUED) return { ok: false, queued: false, id, error: new Error("Offline storage is full. Sync your pending changes before saving more.") };
  try {
    write([...queue, { id, table, values: payload, queuedAt: Date.now() }]);
    return { ok: true, queued: true, id };
  } catch (error) {
    return { ok: false, queued: false, id, error };
  }
}

/**
 * Updates one row, queueing the update if the network is down.
 *
 * The counterpart to `insertOrQueue` for rows that already exist. Returns
 * `{ ok: true, queued: true }` when the change is safely held for replay.
 *
 * A queued INSERT for the same id is folded instead of stacking a second
 * entry: the row does not exist server-side yet, so the single write that
 * eventually lands must be the finished version, not an insert followed by an
 * update that would arrive out of order after a relaunch.
 */
export async function updateOrQueue(
  table: string,
  id: string,
  values: Record<string, unknown>,
  options?: { base?: Record<string, unknown> },
): Promise<{ ok: boolean; queued: boolean; error?: unknown }> {
  try {
    // A pending insert may not exist on the server yet. Fold edits before
    // attempting an UPDATE that could report success while matching no row.
    if (updateQueued(id, values, options?.base, table)) return { ok: true, queued: true };
    const { error } = await updateRow(table, id, values);
    if (!error) return { ok: true, queued: false };
    if (!isNetworkError(error)) return { ok: false, queued: false, error };
    if (updateQueued(id, values, options?.base, table)) return { ok: true, queued: true };
    const queue = read();
    if (queue.length >= MAX_QUEUED) return { ok: false, queued: false, error: new Error("Offline storage is full. Sync your pending changes before saving more.") };
    write([...queue, { id, table, values, base: options?.base, queuedAt: Date.now(), op: "update" }]);
    return { ok: true, queued: true };
  } catch (error) {
    return { ok: false, queued: false, error };
  }
}

/**
 * Merges new column values into a write that is still queued.
 *
 * Needed because a workout is an insert followed later by an update: if the
 * session was started in a dead spot the row exists only in the queue, so
 * `update ... where id = …` would match nothing and the completed session
 * would be lost. Folding the completion into the queued insert means the
 * single write that eventually lands is the finished workout.
 *
 * @returns true if a queued entry was found and updated.
 */
export function updateQueued(
  id: string,
  values: Record<string, unknown>,
  base?: Record<string, unknown>,
  table?: string,
): boolean {
  const queue = read();
  const item = queue.find((w) => w.id === id && (!table || w.table === table));
  if (!item) return false;
  const updated = {
    ...item,
    values: { ...item.values, ...values },
    // Existing fields retain the first server value the athlete saw.
    base: base ? { ...base, ...(item.base ?? {}) } : item.base,
    lastError: undefined,
  };
  write(queue.map((w) => w === item ? updated : w));
  return true;
}

/**
 * Structural equality, good enough for the column values this queue carries:
 * strings, numbers, booleans, null, and the flat jsonb shapes the app writes.
 * `undefined` and a missing key are the same thing here, which is exactly what
 * lets `planUpdate` spot a baseline with a gap.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

interface UpdateReplay {
  error: InsertResult["error"];
  conflict: ConflictInfo | null;
  /** Every field this edit changed already held its new value. Nothing to do. */
  noop?: boolean;
}

/**
 * Reads one row by primary key. The conflict check needs the server's current
 * state; this is the only extra round trip the queue ever makes, and only for
 * updates that carry a baseline.
 */
const selectRow = (
  table: string,
  id: string,
): Promise<{ data: Record<string, unknown> | null; error: InsertResult["error"] }> =>
  (
    supabase.from(table as never) as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: InsertResult["error"];
          }>;
        };
      };
    }
  )
    .select("*")
    .eq("id", id)
    .maybeSingle();

/**
 * Which fields this edit may safely send.
 *
 * Three outcomes per field, all judged against the baseline the client held
 * when the athlete made the edit:
 *
 *   • the local edit did not change it              → not sent at all, so the
 *     other device's change to it survives untouched;
 *   • the server already holds the new value        → not sent; somebody got
 *     there first and rewriting it would only bump the row's timestamp;
 *   • the local edit changed it, the server has not → sent;
 *   • both changed it, to different values          → a CLASH. Not sent, named.
 *
 * Sending only the fields the athlete actually changed is what makes a
 * field-level merge possible with neither side losing work. There is no
 * last-writer-wins here on purpose.
 */
function planUpdate(
  item: QueuedWrite,
  server: Record<string, unknown>,
): { send: Record<string, unknown>; clash: string[] } {
  const base = item.base ?? {};
  const send: Record<string, unknown> = {};
  const clash: string[] = [];

  for (const [field, localValue] of Object.entries(item.values)) {
    // A field with no recorded baseline cannot be proven safe: we do not know
    // whether the server's value is the one the athlete was looking at, so the
    // honest answer is to ask rather than to guess.
    if (!Object.prototype.hasOwnProperty.call(base, field)) {
      clash.push(field);
      continue;
    }
    const baseValue = base[field];
    if (same(localValue, baseValue)) continue; // the edit did not touch this field
    if (same(server[field], localValue)) continue; // already applied elsewhere
    if (!same(server[field], baseValue)) {
      clash.push(field);
      continue;
    }
    send[field] = localValue;
  }

  return { send, clash };
}

/**
 * Replays one update, refusing to overwrite a concurrent change.
 *
 * Entries with no baseline (written by an earlier version of this module, or by
 * a caller that had no row to read) keep their original unconditional meaning —
 * there is nothing to compare against, so nothing to protect.
 */
async function replayUpdate(item: QueuedWrite): Promise<UpdateReplay> {
  if (!item.base) {
    const { error } = await updateRow(item.table, item.id, item.values);
    return { error, conflict: null };
  }

  const { data: server, error: readError } = await selectRow(item.table, item.id);
  if (readError) {
    if (isNetworkError(readError) || readError.code === "PGRST301" || readError.code === "PGRST302") {
      return { error: readError, conflict: null };
    }
    // The row could not be read for a reason that is not connectivity. Sending
    // anyway is the silent overwrite this check exists to prevent, so the edit
    // stays queued and asks the athlete instead of guessing.
    return {
      error: null,
      conflict: { detectedAt: Date.now(), fields: [], server: {}, reason: "baseline_unreadable" },
    };
  }
  if (!server) {
    // The row is gone. Nothing to overwrite and nothing to do — the same
    // treatment as PGRST116 below, reached without a failed write.
    return { error: { message: "no row matched", code: "PGRST116" }, conflict: null };
  }

  const { send, clash } = planUpdate(item, server);
  if (clash.length) {
    return {
      error: null,
      conflict: { detectedAt: Date.now(), fields: clash, server, reason: "concurrent_edit" },
    };
  }
  if (Object.keys(send).length === 0) {
    // Every field this edit changed already holds its new value: another device
    // (or an earlier replay) got there first.
    return { error: null, conflict: null, noop: true };
  }
  const { error } = await updateRow(item.table, item.id, send);
  return { error, conflict: null };
}

/** Replaying right now — more than one caller at once is possible. */
let flushing = false;

/** Replay a snapshot, reconciling each result against the latest queue. */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  try {
    let sent = 0;
    for (const item of pendingWrites()) {
      if (!read().includes(item) || item.conflict) continue;
      const outcome: UpdateReplay = item.op === "update"
        ? await replayUpdate(item)
        : { ...(await replay(item)), conflict: null };
      if (isNetworkError(outcome.error)) break;
      const duplicateInsert = item.op !== "update" && outcome.error?.code === "23505";
      const delivered = !outcome.error && !outcome.conflict || duplicateInsert;
      if (delivered && !outcome.noop) sent++;
      const next = read().flatMap((current) => {
        if (current.id !== item.id || current.table !== item.table) return [current];
        if (current !== item) {
          if (!delivered) return [current];
          // An edit made during the request must still be delivered. An INSERT
          // that just landed becomes an UPDATE against that exact sent value.
          return [{ ...current, op: "update" as const, base: { ...item.base, ...item.values }, conflict: null, lastError: undefined }];
        }
        if (delivered) return [];
        return [{ ...current, conflict: outcome.conflict, lastError: outcome.error?.message }];
      });
      write(next);
    }
    return sent;
  } finally {
    flushing = false;
  }
}

/** Queued edits waiting on the athlete because the server moved underneath them. */
export const pendingConflicts = (): QueuedWrite[] => pendingWrites().filter((w) => !!w.conflict);

/**
 * Captures the baseline for an edit from a row the caller has already read.
 *
 * Callers name the fields they are about to update, so the baseline has no
 * gaps — a gap is treated as a clash, and a needless clash asks the athlete a
 * question whose answer was never in doubt.
 */
export function snapshotOf(
  row: Record<string, unknown> | null | undefined,
  fields: string[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const field of fields) base[field] = row ? row[field] : undefined;
  return base;
}

/**
 * Resolves a conflict by sending the athlete's choice, then draining the queue.
 *
 *   "mine"   — the athlete's values win, unconditionally.
 *   "theirs" — the server's row stands; the queued edit is discarded.
 *   values   — a hand-made merge of specific fields.
 *
 * A network failure leaves the decision queued, deliberately WITHOUT a baseline
 * so replaying it can never ask the same question twice, and reports `ok: false`
 * rather than a success that did not happen.
 */
export async function resolveConflict(
  id: string,
  choice: "mine" | "theirs" | Record<string, unknown>,
): Promise<{ ok: boolean; error?: unknown }> {
  const item = read().find((w) => w.id === id);
  if (!item) return { ok: true };

  const drop = () => write(read().filter((w) => w !== item));

  if (choice === "theirs") {
    drop();
    return { ok: true };
  }

  const values = choice === "mine" ? item.values : choice;
  const { error } = await updateRow(item.table, id, values);
  if (!error || (error as { code?: string }).code === "PGRST116") {
    drop();
    return { ok: true };
  }
  if (isNetworkError(error)) {
    write(
      read().map((w) =>
        w.id === id ? { ...w, values, base: undefined, conflict: null } : w,
      ),
    );
  }
  return { ok: false, error };
}

/**
 * Starts replaying on reconnect. Call once at app start.
 *
 * Also attempts an immediate flush: the app is frequently launched straight
 * into a dead spot and regains signal a second later, and waiting for a fresh
 * `online` event would strand those writes for the whole session.
 */
export function installOfflineQueue(): () => void {
  const flush = () => {
    void flushQueue().catch((error) => console.error("Offline sync failed", error));
  };
  window.addEventListener("online", flush);
  // A short delay, so a launch-time fetch failure has settled before we retry.
  const timer = window.setTimeout(flush, 1500);
  return () => {
    window.removeEventListener("online", flush);
    window.clearTimeout(timer);
  };
}
