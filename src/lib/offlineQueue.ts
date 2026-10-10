// ============================================================================
// OFFLINE WRITE QUEUE
// ----------------------------------------------------------------------------
// A training app is used in gyms, on courts and on trails — precisely where
// there is no signal. Before this, a set logged with no connection produced a
// red toast and was gone: the athlete had done the work and the app threw it
// away.
//
// Writes are still attempted normally. Only a *network* failure queues the
// write; a rejected write (a bad value, a failed constraint, a 402) is a real
// error the athlete must see, because retrying it forever would silently
// discard data that can never succeed.
//
// Dead letters. A write that can never succeed — refused by the server, or with
// no row left to update, or evicted because the queue hit its cap — leaves the
// queue (it would otherwise block every write behind it) but does NOT leave
// without a word: it is recorded in `pendingFailures()`, which is what lets
// OfflineBanner say "one change could not be saved" instead of quietly shipping
// a session the athlete logged and never got. Recording happens at the moment
// the write is given up on, in the same storage the queue uses, so it survives
// the WebView being killed exactly as the queue does.
//
// The queue lives in localStorage, deliberately:
//   - it survives the WebView being killed, which is the normal case when an
//     Android app is backgrounded during a set and then swiped away;
//   - a queued write is a handful of columns, not a cache of pages.
//
// Each queued write carries a client-generated `id`. Supabase inserts take an
// explicit primary key, so replaying a queued write twice collides on the key
// rather than creating a duplicate workout — which means a crash mid-replay
// cannot double-log a session.
// ============================================================================

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

/**
 * A write this device gave up on, kept so the athlete can be told.
 *
 * The queue can only hold what it might still send. Everything else has to be
 * surfaced somewhere, and a console line is not surfaced: the athlete has to
 * know that the session they logged at the bottom of a hill did not land, and
 * why, while they still remember logging it.
 */
export type QueuedFailureReason =
  /** The server answered and refused it (a bad value, a constraint, RLS). */
  | "rejected"
  /** An update whose row was deleted before it could be sent. */
  | "row_missing"
  /** The queue hit its cap and this was the oldest entry. */
  | "overflow";

export interface QueuedFailure {
  /** The id of the write that was given up on. */
  id: string;
  table: string;
  /** When the athlete made the change, so the notice can be ordered honestly. */
  queuedAt: number;
  failedAt: number;
  reason: QueuedFailureReason;
  /**
   * The server's own words where there are any, empty where the reason speaks
   * for itself. Passed through rather than paraphrased: a Postgres constraint
   * message is the thing support will ask for.
   */
  message: string;
  /** PostgREST error code, when the server sent one (23514, 42501…). */
  code?: string;
}

/** Bounded like the queue: enough to explain, not an unbounded log. */
const FAILURE_KEY = "vaylo.offlineQueue.failures.v1";
const MAX_FAILURES = 20;
let failureCache: QueuedFailure[] | null = null;

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

function notify(queue: QueuedWrite[]) {
  listeners.forEach((fn) => {
    try {
      fn([...queue]);
    } catch {
      /* a listener must not break the queue */
    }
  });
}

function write(queue: QueuedWrite[]) {
  cache = queue;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Private mode / quota exhausted. The in-memory copy still serves this
    // session; the write is simply not durable.
  }
  notify(queue);
}

/** The dead-letter list, oldest first. Validated on read, like the queue. */
function readFailures(): QueuedFailure[] {
  if (failureCache) return failureCache;
  try {
    const raw = localStorage.getItem(FAILURE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    failureCache = Array.isArray(parsed)
      ? parsed.filter(
          (f): f is QueuedFailure =>
            !!f && typeof f.id === "string" && typeof f.table === "string" && typeof f.reason === "string",
        )
      : [];
  } catch {
    failureCache = [];
  }
  return failureCache;
}

function writeFailures(list: QueuedFailure[]) {
  failureCache = list;
  try {
    localStorage.setItem(FAILURE_KEY, JSON.stringify(list));
  } catch {
    // Not durable; still reported for this session, which is better than the
    // silence this list exists to end.
  }
  // The same listeners: a refusal changes what the athlete needs to be told,
  // and the banner already subscribes here for the queue's own count.
  notify(read());
}

/** Records a write that was given up on. Never throws, never blocks a replay. */
function recordFailure(entry: {
  id: string;
  table: string;
  queuedAt: number;
  reason: QueuedFailureReason;
  message: string;
  code?: string;
}) {
  const list = readFailures();
  list.push({ ...entry, failedAt: Date.now() });
  while (list.length > MAX_FAILURES) list.shift();
  writeFailures(list);
}

/** The current queue, oldest first. */
export const pendingWrites = (): QueuedWrite[] => [...read()].sort((a, b) => a.queuedAt - b.queuedAt);

/** Subscribe to queue changes; returns an unsubscribe function. */
export function subscribeToQueue(fn: Listener): () => void {
  listeners.add(fn);
  fn(pendingWrites());
  return () => listeners.delete(fn);
}

/**
 * Test helper — clears the queue, the dead-letter list and both caches.
 *
 * It clears BOTH stores on purpose: a helper that resets half the state a test
 * depends on is a trap, and the dead letters are state this module now owns.
 */
export function clearQueue() {
  cache = null;
  failureCache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(FAILURE_KEY);
  } catch {
    /* nothing to clear */
  }
  notify([]);
}

/**
 * Writes the app could not save, newest first — the ones the athlete should be
 * told about. Empty is the normal state.
 */
export const pendingFailures = (): QueuedFailure[] => [...readFailures()].reverse();

/**
 * Acknowledges them, which is the only way they leave the list.
 *
 * Deliberately not automatic: a notice that clears itself on the next render is
 * a notice nobody had to read, and this one is the only record that a logged
 * session did not reach the account.
 */
export function dismissFailures(): void {
  writeFailures([]);
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
  // A queued id already present means this exact write is waiting; do not
  // stack duplicates.
  if (!queue.some((w) => w.id === id)) {
    queue.push({ id, table, values: payload, queuedAt: Date.now() });
    // Drop the oldest rather than refuse a new write: a training session
    // happening now matters more than one from a month ago. Dropping it is a
    // decision that costs the athlete a session, so it is recorded as one.
    while (queue.length > MAX_QUEUED) {
      const evicted = queue.shift();
      if (evicted) {
        recordFailure({
          id: evicted.id,
          table: evicted.table,
          queuedAt: evicted.queuedAt,
          reason: "overflow",
          message: "",
        });
      }
    }
    write(queue);
  }

  return { ok: true, queued: true, id };
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
  const { error } = await updateRow(table, id, values);
  if (!error) return { ok: true, queued: false };

  if (!isNetworkError(error)) {
    return { ok: false, queued: false, error };
  }

  // The baseline rides along with the values so a later replay can tell this
  // edit apart from a concurrent one instead of overwriting it.
  if (updateQueued(id, values, options?.base)) return { ok: true, queued: true };

  const queue = read();
  queue.push({
    id,
    table,
    values,
    base: options?.base,
    queuedAt: Date.now(),
    op: "update",
  });
  while (queue.length > MAX_QUEUED) {
    const evicted = queue.shift();
    if (evicted) {
      recordFailure({
        id: evicted.id,
        table: evicted.table,
        queuedAt: evicted.queuedAt,
        reason: "overflow",
        message: "",
      });
    }
  }
  write(queue);
  return { ok: true, queued: true };
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
): boolean {
  const queue = read();
  const item = queue.find((w) => w.id === id);
  if (!item) return false;
  item.values = { ...item.values, ...values };
  // Merged, not replaced: a second offline edit to the same row widens the set
  // of fields that need a baseline, and the earliest reading of each field is
  // the one the athlete actually saw.
  if (base) item.base = { ...(item.base ?? {}), ...base };
  write([...queue]);
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
    if (isNetworkError(readError)) return { error: readError, conflict: null };
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

/**
 * Replays every queued write, oldest first.
 *
 * A write that fails for a *network* reason stops the run and stays queued.
 * A write the server rejects is dropped: it can never succeed, and leaving it
 * in place would block every write behind it forever. Dropping it is recorded
 * in the dead-letter list first, so "the server refused this" reaches the
 * athlete instead of disappearing with the entry.
 *
 * @returns how many writes were successfully sent.
 */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  try {
    const queue = pendingWrites();
    if (!queue.length) return 0;

    let sent = 0;
    let keep: QueuedWrite[] = [];

    for (const item of queue) {
      // A conflict already found is not retried: the athlete has to choose, and
      // re-running the same comparison would only find it again. It stays in
      // the queue so the choice still exists after a relaunch.
      if (item.conflict) {
        keep.push(item);
        continue;
      }

      const outcome: UpdateReplay =
        item.op === "update"
          ? await replayUpdate(item)
          : { ...(await replay(item)), conflict: null };

      if (outcome.conflict) {
        keep.push({ ...item, conflict: outcome.conflict });
        continue;
      }
      // Resolved elsewhere; there is nothing left to send.
      if (outcome.noop) continue;

      const error = outcome.error;
      if (!error) {
        sent++;
        continue;
      }
      if (isNetworkError(error)) {
        // Still offline. Everything after this is very likely to fail too, but
        // ordering matters more than saving a round trip — stop here.
        //
        // APPEND, do not replace. `keep` already holds the conflicts collected
        // earlier in this pass, and entries that were deliberately left queued;
        // assigning a fresh array here discarded every one of them, so a conflict
        // found a moment before the signal dropped vanished — the queued edit
        // deleted with no trace and nothing left for the athlete to resolve,
        // which is the exact opposite of the promise in ConflictInfo. The queue
        // is oldest-first, so appending the current entry and its successors
        // keeps everything that still has work to do, in order.
        keep = [...keep, item, ...queue.slice(queue.indexOf(item) + 1)];
        break;
      }
      // 23505 = duplicate key: a previous replay got through before the app
      // died. The write landed, so drop it.
      if ((error as { code?: string }).code === "23505") {
        sent++;
        continue;
      }
      // An UPDATE that matched no row means the row was deleted (or never
      // landed) since it was queued. It can never succeed, so it goes rather
      // than blocking every write behind it — the same treatment as a refusal.
      // PostgREST reports a missing match for a single-row update as PGRST116.
      if ((error as { code?: string }).code === "PGRST116") {
        recordFailure({
          id: item.id,
          table: item.table,
          queuedAt: item.queuedAt,
          reason: "row_missing",
          message: error.message,
          code: "PGRST116",
        });
        continue;
      }
      // Genuinely rejected — unrecoverable, so it goes rather than blocks.
      // Recorded first: an entry that vanishes without a word is the silent
      // data loss this queue exists to prevent, and the server's reason is the
      // part the athlete (or support) can act on.
      recordFailure({
        id: item.id,
        table: item.table,
        queuedAt: item.queuedAt,
        reason: "rejected",
        message: error.message,
        code: (error as { code?: string }).code,
      });
    }

    write(keep);
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

  const drop = () => write(read().filter((w) => w.id !== id));

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
    void flushQueue();
  };
  window.addEventListener("online", flush);
  // A short delay, so a launch-time fetch failure has settled before we retry.
  const timer = window.setTimeout(flush, 1500);
  return () => {
    window.removeEventListener("online", flush);
    window.clearTimeout(timer);
  };
}
