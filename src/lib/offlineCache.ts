// ============================================================================
// OFFLINE SNAPSHOT CACHE
// ----------------------------------------------------------------------------
// The write queue (lib/offlineQueue.ts) stops a session being LOST offline. This
// is the other half: making the app readable with no connection at all. Without
// it, an athlete who opens Vaylo Sports in a gym basement sees empty screens —
// which reads as "my data is gone", not "I am offline".
//
// What is cached is deliberately short and named, not a mirror of the database.
// The specification asks for today's session, upcoming sessions, recent history,
// the goals and roadmap summaries, life events and the athlete's essentials — so
// those are the keys, and nothing else has a cache.
//
// Scoped per user id. A shared phone must never hand athlete B the snapshot of
// athlete A's training, and the only way to guarantee that is to put the id in
// the key rather than trusting every caller to clear on sign-out.
//
// localStorage, on purpose, for the same two reasons the queue gives: it
// survives the Android WebView being killed (the normal case when the app is
// backgrounded and then swiped away), and a snapshot is a screenful of JSON, not
// a database. Nothing here is a source of truth — every read is a fallback the
// caller uses only when the network read failed.
// ============================================================================

const PREFIX = "vaylo.cache.v1";

/** The named snapshots the offline screens read. Adding one is adding a key. */
export type CacheKey =
  | "today"
  | "upcoming"
  | "history"
  | "goals"
  | "roadmap"
  | "lifeEvents"
  | "profile"
  | "startingAnalysis"
  /** Phase 6: the actionable analytics reading, and the why behind it. */
  | "insights"
  /** Phase 8: one saved training plan, with its full week/session JSON. */
  | "plans";

/** Purge key prefix used to clear stale plan snapshots on sign-out / account switch. */
export const PLANS_CACHE_PREFIX = `${PREFIX}.plans.`;

/**
 * How long each snapshot stays useful.
 *
 * These are not security boundaries — a stale session list is not a leak — they
 * are honesty boundaries. Showing last week's "today" as though it were today
 * would be a lie, so the copy for a stale snapshot has to say when it was taken,
 * and past the TTL the screen says nothing rather than something wrong.
 */
export const CACHE_TTLS: Record<CacheKey, number> = {
  // Today's session is only meaningful for the day it was read.
  today: 24 * 60 * 60 * 1000,
  upcoming: 7 * 24 * 60 * 60 * 1000,
  history: 30 * 24 * 60 * 60 * 1000,
  goals: 30 * 24 * 60 * 60 * 1000,
  roadmap: 30 * 24 * 60 * 60 * 1000,
  lifeEvents: 60 * 24 * 60 * 60 * 1000,
  // Profile and the analysis change only when the athlete changes them.
  profile: 90 * 24 * 60 * 60 * 1000,
  startingAnalysis: 180 * 24 * 60 * 60 * 1000,
  // A live reading, so it ages like one. A week-old "recent workload" is still
  // worth showing offline, but it has to say how old it is — which is what
  // `stale` drives on the screen.
  insights: 7 * 24 * 60 * 60 * 1000,
  // A plan is a durable object the athlete owns. The plan row can be edited or
  // deleted on another device, so past the TTL the screen has to say the cached
  // copy may be stale rather than show it as though it were current.
  plans: 7 * 24 * 60 * 60 * 1000,
};

export interface CachedSnapshot<T> {
  data: T;
  /** Epoch ms the snapshot was written. */
  savedAt: number;
  ageMs: number;
  /** True past the TTL for this key — the UI should say when it was taken. */
  stale: boolean;
}

const storageKey = (userId: string, key: CacheKey) => `${PREFIX}.${userId}.${key}`;

/** Every key this module owns, for the eviction sweep below. */
function ourKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}.`)) keys.push(k);
    }
  } catch {
    /* storage unavailable — nothing to sweep */
  }
  return keys;
}

/**
 * Stores one snapshot.
 *
 * On a quota failure the oldest of our own entries is evicted and the write
 * retried once. Evicting only our own keys matters: the queue lives in the same
 * localStorage, and a cache write must never be what deletes a queued session.
 */
export function cacheWrite(userId: string, key: CacheKey, data: unknown): boolean {
  if (!userId) return false;
  const payload = JSON.stringify({ savedAt: Date.now(), data });
  const write = () => {
    localStorage.setItem(storageKey(userId, key), payload);
  };
  try {
    write();
    return true;
  } catch {
    // Quota or private mode. Try once more after making room.
    try {
      const mine = ourKeys()
        .map((k) => {
          try {
            return { k, savedAt: JSON.parse(localStorage.getItem(k) ?? "{}").savedAt ?? 0 };
          } catch {
            return { k, savedAt: 0 };
          }
        })
        .sort((a, b) => a.savedAt - b.savedAt);
      for (const { k } of mine) {
        if (k === storageKey(userId, key)) continue;
        localStorage.removeItem(k);
        try {
          write();
          return true;
        } catch {
          /* still no room — keep evicting */
        }
      }
    } catch {
      /* storage is unusable; the caller falls back to the network path */
    }
    return false;
  }
}

/**
 * Reads one snapshot, or null.
 *
 * Returns the age alongside the data so every screen can be honest about it —
 * "as of 2 hours ago" is the difference between an offline fallback and a lie.
 */
export function cacheRead<T>(userId: string, key: CacheKey): CachedSnapshot<T> | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(userId, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; data?: unknown };
    if (typeof parsed?.savedAt !== "number" || parsed.data === undefined) return null;
    const ageMs = Math.max(0, Date.now() - parsed.savedAt);
    return {
      data: parsed.data as T,
      savedAt: parsed.savedAt,
      ageMs,
      stale: ageMs > CACHE_TTLS[key],
    };
  } catch {
    return null;
  }
}

/**
 * Stores the current set of saved training plans for the athlete.
 *
 * This is the snapshot the offline plan list and plan detail read from when the
 * network is down. It is intentionally a *fallback*, not a source of truth: the
 * caller still tries the network first, and only the plans the athlete has
 * already seen online end up cached here.
 */
export function cachePlans(userId: string, plans: unknown[]): boolean {
  if (!userId) return false;
  return cacheWrite(userId, "plans", plans);
}

/**
 * Reads the cached plan list for the athlete, or null when nothing has been
 * cached yet / the cached value is unreadable.
 */
export function cacheReadPlans(userId: string): CachedSnapshot<unknown[]> | null {
  if (!userId) return null;
  return cacheRead<unknown[]>(userId, "plans");
}

/**
 * Removes one snapshot, or every snapshot for a user when no key is given.
 */
export function cacheClear(userId: string, key?: CacheKey): void {
  try {
    if (key) {
      localStorage.removeItem(storageKey(userId, key));
      return;
    }
    for (const k of ourKeys()) {
      if (k.startsWith(`${PREFIX}.${userId}.`)) localStorage.removeItem(k);
    }
  } catch {
    /* nothing to clear */
  }
}

/** Removes the named user's cached plan snapshot (the key lives at <uid>.plans). */
export function clearPlansCache(userId: string): void {
  cacheClear(userId, "plans");
}

/**
 * Human age of a snapshot, for the "as of …" line under an offline screen.
 *
 * Deliberately coarse. "3 minutes ago" and "just now" invite the reader to
 * believe the number is live; on a screen that is by definition offline, the
 * only useful precision is "how far behind am I".
 */
export function cacheAgeLabel(ageMs: number): string {
  if (ageMs < 60_000) return "a moment ago";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}
