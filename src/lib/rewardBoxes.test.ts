import { beforeEach, describe, expect, it } from "vitest";
import {
  BOX_MILESTONES,
  boxContents,
  boxPool,
  isBoxOpened,
  markBoxOpened,
  nextMilestones,
  openedBoxes,
  pendingBoxes,
} from "./rewardBoxes";
import { getItem } from "./avatarCatalog";

const LEDGER_KEY = "vaylo_reward_boxes_v1";
const SALT_KEY = "vaylo_reward_boxes_salt_v1";

const clearBoxes = () => {
  try {
    localStorage.removeItem(LEDGER_KEY);
    localStorage.removeItem(SALT_KEY);
  } catch {
    /* jsdom */
  }
};

const none = new Set<string>();

describe("reward boxes", () => {
  beforeEach(clearBoxes);

  it("keeps every pool to real, paid, wearable cosmetics", () => {
    for (const rarity of ["rare", "epic", "legendary", "mythic"] as const) {
      const pool = boxPool(rarity);
      expect(pool.length, `empty pool for ${rarity}`).toBeGreaterThan(3);
      for (const item of pool) {
        expect(item.cost, `${item.id} is free`).toBeGreaterThan(0);
        // The grant path is the avatar catalog, so the item must exist there.
        expect(getItem(item.id)).toBeTruthy();
        expect(["outfit", "pants", "shoes", "headgear", "gloves", "accessory", "badge", "background", "pose"])
          .toContain(item.category);
      }
    }
  });

  it("resolves the same box to the same item every time", () => {
    const milestone = BOX_MILESTONES.find((m) => m.threshold === 7)!;
    const first = boxContents(milestone, none).item;
    for (let i = 0; i < 5; i++) {
      expect(boxContents(milestone, none).item?.id).toBe(first?.id);
    }
  });

  it("gives different milestones different content", () => {
    // A surprise box that always contains the same item is a vending machine.
    const ids = new Set(
      [3, 7, 14, 30].map((t) => boxContents(BOX_MILESTONES.find((m) => m.threshold === t)!, none).item?.id),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it("prefers items the athlete does not own", () => {
    const milestone = BOX_MILESTONES.find((m) => m.threshold === 14)!;
    const first = boxContents(milestone, none).item;
    expect(first).toBeTruthy();
    // With that item owned, the box must resolve to something else rather
    // than a duplicate the server would refuse to grant twice.
    const second = boxContents(milestone, new Set([first!.id]));
    expect(second.item?.id).not.toBe(first!.id);
    expect(second.duplicate).toBe(false);
  });

  it("admits a duplicate when the whole tier is collected", () => {
    const milestone = BOX_MILESTONES.find((m) => m.threshold === 3)!;
    const everything = new Set(boxPool(milestone.rarity).map((i) => i.id));
    const { item, duplicate } = boxContents(milestone, everything);
    expect(item).toBeTruthy();
    expect(duplicate).toBe(true);
  });

  it("records opened boxes once, and stops offering them as pending", () => {
    const milestone = BOX_MILESTONES.find((m) => m.threshold === 3)!;
    expect(pendingBoxes({ streak: 3 }, none).map((p) => p.milestone.threshold)).toContain(3);

    const item = boxContents(milestone, none).item!;
    markBoxOpened({ source: "streak", threshold: 3, itemId: item.id, openedOn: "2026-10-15" });

    expect(isBoxOpened("streak", 3)).toBe(true);
    expect(isBoxOpened("referral", 3)).toBe(false);
    expect(pendingBoxes({ streak: 365 }, none).map((p) => p.milestone.threshold)).not.toContain(3);
    // Idempotent: opening the same milestone again replaces, never duplicates.
    markBoxOpened({ source: "streak", threshold: 3, itemId: item.id, openedOn: "2026-10-16" });
    expect(openedBoxes().filter((b) => b.source === "streak" && b.threshold === 3)).toHaveLength(1);
  });

  it("only offers boxes for milestones actually reached", () => {
    expect(pendingBoxes({ streak: 2 }, none)).toHaveLength(0);
    expect(pendingBoxes({ streak: 3 }, none).map((p) => p.milestone.threshold)).toEqual([3]);
    // 30 days reaches 3, 7, 14 and 30 — four boxes, nearest first.
    expect(pendingBoxes({ streak: 30 }, none).map((p) => p.milestone.threshold)).toEqual([3, 7, 14, 30]);
    // Referral boxes come from the qualifying count, never from the streak.
    expect(pendingBoxes({ streak: 0, qualifyingReferrals: 1 }, none).map((p) => p.milestone.threshold)).toEqual([1]);
  });

  it("names the nearest milestone still ahead, per source", () => {
    const [streakNext] = nextMilestones({ streak: 5 });
    expect(streakNext.source).toBe("streak");
    expect(streakNext.threshold).toBe(7);
    // With the referral count unknown, no referral "next" is invented.
    expect(nextMilestones({ streak: 5 })).toHaveLength(1);
    // A known referral count gets its own nearest milestone.
    const both = nextMilestones({ streak: 5, qualifyingReferrals: 1 });
    expect(both.find((m) => m.source === "referral")?.threshold).toBe(3);
  });

  it("never puts coins or credits in a box — cosmetics only", () => {
    // The economy guard: a box item is an avatar cosmetic, and the pool
    // function only ever returns catalog items. Anything else here would be a
    // revenue leak dressed as a reward.
    for (const milestone of BOX_MILESTONES) {
      const { item } = boxContents(milestone, none);
      expect(item).toBeTruthy();
      expect(getItem(item!.id)?.category).toBeTruthy();
    }
  });
});
