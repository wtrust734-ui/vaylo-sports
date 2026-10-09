// The sync-status derivation.
//
// The states are a priority order, not four independent facts, so the tests are
// mostly about which of two true statements wins — and about the two claims the
// app must never make: "Syncing" with no connection, and "Synced" while
// something is still waiting.

import { describe, expect, it } from "vitest";
import {
  EMPTY_SYNC_FACTS,
  deriveSyncState,
  syncNeedsAttention,
  syncStatusCopy,
  type SyncFacts,
} from "./syncStatus";

const facts = (over: Partial<SyncFacts> = {}): SyncFacts => ({ ...EMPTY_SYNC_FACTS, ...over });

describe("deriveSyncState", () => {
  it("is idle before anything has synced, rather than claiming success", () => {
    expect(deriveSyncState(facts())).toBe("idle");
    expect(syncStatusCopy("idle", facts()).label).toBe("Saved on device");
  });

  it("is synced only once a clean drain has happened and nothing is pending", () => {
    expect(deriveSyncState(facts({ lastSyncedAt: 1 }))).toBe("synced");
    expect(deriveSyncState(facts({ lastSyncedAt: 1, pending: 1 }))).not.toBe("synced");
  });

  it("never claims to be syncing without a connection", () => {
    expect(deriveSyncState(facts({ online: false, flushing: true, pending: 2 }))).toBe("offline");
    expect(deriveSyncState(facts({ online: false }))).toBe("offline");
  });

  it("reports syncing while a drain is running", () => {
    expect(deriveSyncState(facts({ flushing: true, pending: 3 }))).toBe("syncing");
  });

  it("treats a failed send as an error, not as progress", () => {
    expect(deriveSyncState(facts({ pending: 2, lastErrorAt: 1 }))).toBe("error");
  });

  it("puts a conflict above everything, including being offline", () => {
    // Nothing else on screen is true until the athlete has chosen.
    expect(deriveSyncState(facts({ conflicts: 1, online: false, flushing: true }))).toBe("error");
    expect(deriveSyncState(facts({ conflicts: 1, pending: 0, lastSyncedAt: 1 }))).toBe("error");
  });

  it("prefers sync-error over pending when online", () => {
    expect(deriveSyncState(facts({ online: true, pending: 1 }))).toBe("syncing");
    expect(deriveSyncState(facts({ online: true, pending: 1, lastErrorAt: 5 }))).toBe("error");
  });
});

describe("syncStatusCopy", () => {
  it("says where the data is when offline, not what failed", () => {
    const copy = syncStatusCopy("offline", facts({ online: false, pending: 3 }));
    expect(copy.label).toBe("Offline");
    expect(copy.detail).toContain("3 changes saved on this device");
    expect(copy.tone).toBe("warning");
  });

  it("reassures when offline with nothing pending", () => {
    const copy = syncStatusCopy("offline", facts({ online: false }));
    expect(copy.detail).toContain("saved on this device");
    expect(copy.action).toBeNull();
  });

  it("uses the singular for one pending change", () => {
    const one = syncStatusCopy("offline", facts({ online: false, pending: 1 })).detail;
    expect(one).toContain("1 change saved");
    // The pronoun follows the noun: "1 change … they will sync" reads as broken
    // English to the one athlete most likely to be reading it.
    expect(one).toContain("it will sync when you reconnect");
    expect(syncStatusCopy("offline", facts({ online: false, pending: 2 })).detail).toContain(
      "they will sync when you reconnect",
    );
  });

  it("offers a retry only when there is something to retry", () => {
    expect(syncStatusCopy("error", facts({ pending: 2, lastErrorAt: 1 })).action).toBe("retry");
    expect(syncStatusCopy("error", facts({ conflicts: 1 })).action).toBe("retry");
    expect(syncStatusCopy("synced", facts({ lastSyncedAt: 1 })).action).toBeNull();
  });

  it("names the conflict as the athlete's decision", () => {
    const copy = syncStatusCopy("error", facts({ conflicts: 2 }));
    expect(copy.label).toBe("Sync needs you");
    expect(copy.detail).toContain("2 edits");
    expect(copy.detail).toContain("another device");
    expect(copy.tone).toBe("danger");
  });

  it("keeps the errored-count wording for a plain failure", () => {
    const copy = syncStatusCopy("error", facts({ pending: 1, lastErrorAt: 1 }));
    expect(copy.label).toBe("Sync error");
    expect(copy.detail).toContain("1 change couldn't be sent");
  });
});

describe("syncNeedsAttention", () => {
  it("only interrupts for offline and error", () => {
    expect(syncNeedsAttention("offline")).toBe(true);
    expect(syncNeedsAttention("error")).toBe(true);
    expect(syncNeedsAttention("syncing")).toBe(false);
    expect(syncNeedsAttention("synced")).toBe(false);
    expect(syncNeedsAttention("idle")).toBe(false);
  });
});
