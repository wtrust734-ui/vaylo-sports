// ============================================================================
// REWARD BOXES — surprise cosmetics for streaks, referrals and challenges
// ----------------------------------------------------------------------------
// WHAT THIS IS
//
// Milestone awards that cost essentially nothing to run and never touch the
// money economy. Reaching a streak milestone (or having a referral qualify)
// unlocks a SURPRISE BOX; opening it grants one real avatar cosmetic — a
// wearable item from the avatar catalog, granted through the same
// `purchase_avatar_item_coins` (cost 0) RPC the free unlock path already uses,
// so ownership is a normal row and the item shows up in Avatar Studio like any
// purchase.
//
// WHY IT COSTS NOTHING (and earns, not gives away)
//
//   * No server compute, no AI call, no new table, no migration. The box is
//     planned on the device, and the grant is one insert the app already has.
//   * Awards are COSMETIC ONLY. No coins, no credits, no unlock of a paid
//     feature — a box can never undercut a sale, because the thing it gives is
//     something the athlete could only ever have bought with coins for identity
//     purposes. The pools are drawn from the paid catalog at its own rarity
//     tiers, so a box feels like a real gift while the ladder stays intact:
//     the box is a taste, never a replacement.
//   * The pool prefers items the athlete does NOT own, so most boxes are a
//     genuine addition. Only when the whole tier is owned does a box resolve
//     to "already have everything" — and even that is honest rather than a
//     duplicate grant the server would refuse.
//
// WHY IT IS DETERMINISTIC
//
// The contents are a pure function of (source, milestone, a per-device salt,
// owned set). No RNG call at open time means the same box always resolves the
// same way — reopening the app mid-flow cannot re-roll it, a reload before the
// grant lands shows the same item, and tests do not need to mock Math.random.
// The salt is per device (not per server), so two athletes comparing boxes see
// different items — which is the point of a surprise box.
//
// THE LEDGER
//
// Opened boxes live in localStorage only. That matches the streak itself
// (src/lib/recoveryStreak.ts is a local, non-login ledger): an award for a
// local streak is a local record. Nothing here is authoritative for money or
// entitlement, so a cleared ledger only ever loses cosmetics.
// ============================================================================

import { CATALOG, SHOP_CATEGORIES, type AvatarItem, type Rarity } from "./avatarCatalog";

export type BoxSource = "streak" | "referral" | "challenge";

export interface BoxMilestone {
  source: BoxSource;
  /** Streak days, qualifying referrals, challenge points — the source's unit. */
  threshold: number;
  /** Display label, e.g. "7-day streak". */
  label: string;
  /** Rarity tier the box draws from. Higher milestones draw rarer pools. */
  rarity: Rarity;
}

/**
 * The milestone table. Streak thresholds track the recovery streak
 * (src/lib/recoveryStreak.ts); referral thresholds track the server-side
 * qualifying-referral count (referral_qualification_count RPC).
 */
export const BOX_MILESTONES: BoxMilestone[] = [
  { source: "streak", threshold: 3, label: "3-day streak", rarity: "rare" },
  { source: "streak", threshold: 7, label: "Week-long streak", rarity: "rare" },
  { source: "streak", threshold: 14, label: "Two-week streak", rarity: "epic" },
  { source: "streak", threshold: 30, label: "Month-long streak", rarity: "epic" },
  { source: "streak", threshold: 60, label: "60-day streak", rarity: "legendary" },
  { source: "streak", threshold: 100, label: "100-day streak", rarity: "legendary" },
  { source: "streak", threshold: 200, label: "200-day streak", rarity: "mythic" },
  { source: "streak", threshold: 365, label: "Full year streak", rarity: "mythic" },
  { source: "referral", threshold: 1, label: "First friend qualifies", rarity: "rare" },
  { source: "referral", threshold: 3, label: "Three friends qualify", rarity: "epic" },
  { source: "referral", threshold: 5, label: "Five friends qualify", rarity: "epic" },
  { source: "referral", threshold: 10, label: "Ten friends qualify", rarity: "legendary" },
];

const LEDGER_KEY = "vaylo_reward_boxes_v1";
const SALT_KEY = "vaylo_reward_boxes_salt_v1";

export interface OpenedBox {
  source: BoxSource;
  threshold: number;
  itemId: string | null;
  openedOn: string;
}

// -- Device salt (what makes two athletes' boxes differ) ---------------------

function deviceSalt(): number {
  try {
    const raw = localStorage.getItem(SALT_KEY);
    if (raw && Number.isFinite(Number(raw))) return Number(raw);
    const salt = Math.floor(Math.random() * 0x7fffffff) || 1;
    localStorage.setItem(SALT_KEY, String(salt));
    return salt;
  } catch {
    // Private mode: a stable fallback salt. Boxes still resolve identically
    // within the session, which is all determinism promises here.
    return 1;
  }
}

/** FNV-1a, 32-bit. Small, dependency-free, and stable across runs/devices. */
function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const input = parts.join("|");
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// -- Ledger ------------------------------------------------------------------

function readLedger(): OpenedBox[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    const parsed = raw ? (JSON.parse(raw) as OpenedBox[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLedger(entries: OpenedBox[]): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(entries.slice(-200)));
  } catch {
    /* private mode — awards degrade to unclaimed, nothing breaks */
  }
}

export const openedBoxes = (): OpenedBox[] => readLedger();

export function markBoxOpened(entry: OpenedBox): void {
  const ledger = readLedger().filter(
    (b) => !(b.source === entry.source && b.threshold === entry.threshold),
  );
  ledger.push(entry);
  writeLedger(ledger);
}

const boxKey = (source: BoxSource, threshold: number): string => `${source}:${threshold}`;

export const isBoxOpened = (source: BoxSource, threshold: number): boolean =>
  readLedger().some((b) => b.source === source && b.threshold === threshold);

// -- Pools and contents ------------------------------------------------------

/**
 * Every paid, equippable catalog item at a rarity. Cost > 0 filters out the
 * free defaults (a box of things you already had for nothing is not a gift),
 * and SHOP_CATEGORIES keeps the pool to what Avatar Studio can actually wear.
 */
export function boxPool(rarity: Rarity): AvatarItem[] {
  return CATALOG.filter(
    (i) => i.rarity === rarity && i.cost > 0 && (SHOP_CATEGORIES as string[]).includes(i.category),
  ).sort((a, b) => (a.id < b.id ? -1 : 1)); // stable order for determinism
}

/**
 * What a box at this milestone contains. Deterministic: same source,
 * milestone, device salt and owned set always resolve to the same item.
 *
 * Prefers an unowned item; only falls back to an owned one when the whole tier
 * is collected (the UI then says so instead of granting a duplicate the server
 * would refuse).
 */
export function boxContents(
  milestone: BoxMilestone,
  owned: ReadonlySet<string>,
): { item: AvatarItem | null; duplicate: boolean } {
  const pool = boxPool(milestone.rarity);
  const unowned = pool.filter((i) => !owned.has(i.id));
  const pickFrom = unowned.length > 0 ? unowned : pool;
  if (pickFrom.length === 0) return { item: null, duplicate: false };
  const idx = hash32(milestone.source, milestone.threshold, deviceSalt()) % pickFrom.length;
  const item = pickFrom[idx];
  return { item, duplicate: owned.has(item.id) };
}

export interface BoxProgress {
  /** Current recovery streak (src/lib/recoveryStreak.ts). */
  streak: number;
  /** Qualifying referrals (server aggregate — referral_qualification_count). */
  qualifyingReferrals?: number;
}

export interface PendingBox {
  milestone: BoxMilestone;
  /** Contents, or null when the milestone itself is reached (pre-computed). */
  item: AvatarItem | null;
  duplicate: boolean;
}

/**
 * Boxes the athlete has EARNED but not opened, given their progress. The only
 * honest source of "earned" is progress >= threshold AND not yet in the ledger.
 */
export function pendingBoxes(progress: BoxProgress, owned: ReadonlySet<string>): PendingBox[] {
  const out: PendingBox[] = [];
  for (const milestone of BOX_MILESTONES) {
    const current =
      milestone.source === "streak" ? progress.streak : milestone.source === "referral" ? progress.qualifyingReferrals ?? 0 : 0;
    if (current < milestone.threshold) continue;
    if (isBoxOpened(milestone.source, milestone.threshold)) continue;
    const { item, duplicate } = boxContents(milestone, owned);
    out.push({ milestone, item, duplicate });
  }
  return out;
}

/**
 * The nearest milestone still ahead, per source — for "3 more days to your
 * next box" copy. A source whose progress the caller did not supply (an
 * unknown referral count) contributes nothing: an unmeasured "next" would be
 * an invented number.
 */
export function nextMilestones(progress: BoxProgress): BoxMilestone[] {
  const out: BoxMilestone[] = [];
  const sources: { source: BoxSource; current: number | undefined }[] = [
    { source: "streak", current: progress.streak },
    { source: "referral", current: progress.qualifyingReferrals },
  ];
  for (const { source, current } of sources) {
    if (typeof current !== "number") continue;
    const next = BOX_MILESTONES.filter((m) => m.source === source && m.threshold > current).sort(
      (a, b) => a.threshold - b.threshold,
    )[0];
    if (next) out.push(next);
  }
  return out;
}
