// Tests for the Health Connect sync engine (src/lib/health/sync.ts).
//
// The engine changed for the 19 October health work and these are the
// behaviours that had to become true, each one previously false:
//
//   * one engine run per account — two `runHealthSync` calls race one run and
//     the second caller receives the FIRST run's outcome, instead of running a
//     second full pull-and-upload side by side;
//   * the outcome is PERSISTED — a sync that failed keeps saying failed across
//     a refresh and a second device (local state + health_sync_state), and a
//     failed pass never advances the cursor or claims a lastSyncTime it did
//     not honestly write;
//   * cross-device truth — an account the server records as connected is not
//     re-offered initial setup on a fresh device, and a server row that says
//     not-connected never cancels a locally live consent;
//   * the cursor maths — incremental syncs only move forward, and a failed
//     upload leaves the cursor exactly where it was.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "@/integrations/supabase/client";
import {
  disconnectHealthConnect,
  fetchServerSyncState,
  hasImportedData,
  readConsent,
  readLocalState,
  resolveHealthStatus,
  runHealthSync,
  type StoredHealthState,
} from "./sync";
import {
  bridgeCheckPermissions,
  bridgeRequestPermissions,
  bridgeRevokePermissions,
  bridgeSyncPull,
} from "./bridge";
import { HEALTH_PERMISSIONS_VERSION } from "./permissions";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("./bridge", () => ({
  bridgeCheckPermissions: vi.fn(),
  bridgeSyncPull: vi.fn(function a() { return Promise.resolve({ workouts: [], samples: [], latestCursorMs: null, hasMore: false }); }),
  bridgeRequestPermissions: vi.fn(),
  bridgeRevokePermissions: vi.fn(),
}));

const checkPerms = bridgeCheckPermissions as unknown as ReturnType<typeof vi.fn>;
const syncPull = bridgeSyncPull as unknown as ReturnType<typeof vi.fn>;
const requestPerms = bridgeRequestPermissions as unknown as ReturnType<typeof vi.fn>;
const revokePerms = bridgeRevokePermissions as unknown as ReturnType<typeof vi.fn>;

// The typed client's from() returns per-table generics; tests swap it for a
// fake, and these helpers keep that swap free of casts against the library.
const fromMock = supabase.from as unknown as {
  mockImplementation: (impl: (table: string) => unknown) => void;
  mock: { calls: unknown[][] };
};

function fakeFrom(
  maybeSingle: () => Promise<{ data: unknown }> = () => Promise.resolve({ data: null }),
  upsert: () => Promise<{ error: unknown }> = () => Promise.resolve({ error: null }),
) {
  const chain = {
    upsert,
    select: () => chain,
    eq: () => chain,
    maybeSingle,
  };
  return chain;
}

// A tiny chained-upsert stand-in: every .from("...").upsert() resolves ok and
// every .from("...").select() chain resolves with null until a test replaces it.

const USER = "u1";
const key = `vaylo:hc:state:${USER}`;
const consentKey = `vaylo:hc:consent:${USER}`;

const state = (over: Partial<StoredHealthState> = {}): StoredHealthState => ({
  lastSyncAt: null,
  cursorMs: null,
  syncStatus: "idle",
  ...over,
});

const workout = (id: string, startMs: number) => ({
  sourceRecordId: id,
  title: `Run ${id}`,
  activityType: "running",
  startTime: new Date(startMs).toISOString(),
  endTime: new Date(startMs + 60_000).toISOString(),
  durationSeconds: 60,
  distanceMeters: 300,
  activeCalories: 50,
  heartRateAvg: 150,
  heartRateMax: 170,
  heartRateMin: 120,
  steps: 90,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setDefaultClient();
  checkPerms.mockResolvedValue({ grantedCount: 6, missingCount: 0 });
  requestPerms.mockResolvedValue({ grantedCount: 6, cancelled: false });
  revokePerms.mockResolvedValue(true);
  syncPull.mockResolvedValue({ workouts: [], samples: [], latestCursorMs: null, hasMore: false });
});

// Any test that proves "unreadable server" behaviour must put the client back:
// these tests share one module, and a mock left throwing would sabotage every
// run after it. setDefaultClient is the state they all restore to.

// Source assertions for the sync-status migration (same pattern as
// friendAccess.test.ts): the column the engine persists into must keep its
// closed status set and the crash-detectable claim timestamp.
describe("health_sync_status migration", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../../supabase/migrations/20261019140000_health_sync_status.sql"),
    "utf8",
  ).replace(/\r\n?/g, "\n");

  it("adds a closed-set sync_status, a claim timestamp and a bounded error token", () => {
    expect(src).toMatch(/add column if not exists sync_status text not null default 'idle'/);
    expect(src).toMatch(/check \(sync_status in \('idle', 'in_progress', 'succeeded', 'failed'\)\)/);
    expect(src).toMatch(/add column if not exists sync_started_at timestamptz/);
    expect(src).toMatch(/add column if not exists sync_error text/);
  });

  it("carries no health data and asks for no new grants", () => {
    // The row is bookkeeping; its guards say so.
    expect(src).toMatch(/Never a health value\./);
    expect(src).toMatch(/no health values ever/);
    expect(src).toMatch(/No new/);
    expect(src).toMatch(/grants needed/i);
  });
});

describe("the engine lock", () => {
  it("runs ONE pull for two concurrent syncs and resolves both with the same outcome", async () => {
    // Two mounts of one sheet, or the sheet and the HealthSync page: they hold
    // their own `syncing` flags, so without sharing a lock there were two
    // full runs doing the same pull and two conflicting `in_progress` writes.
    syncPull.mockImplementation(() =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              workouts: [workout("w1", Date.now())],
              samples: [],
              latestCursorMs: Date.now() + 120_000,
              hasMore: false,
            }),
          5,
        ),
      ),
    );

    const [a, b] = await Promise.all([runHealthSync(USER), runHealthSync(USER)]);
    expect(syncPull).toHaveBeenCalledTimes(1);
    expect(b).toBe(a); // the second caller joined the run in flight
    expect(a.workouts).toBe(1);
  });

  it("runs a FRESH pull for the next manual sync after the in-flight one ends", async () => {
    syncPull.mockResolvedValue({
      workouts: [],
      samples: [],
      latestCursorMs: null,
      hasMore: false,
    });
    await runHealthSync(USER);
    await runHealthSync(USER);
    // Sequential requests are two user actions, not a race — each is a run.
    expect(syncPull).toHaveBeenCalledTimes(2);
  });
});

describe("the persisted outcome", () => {
  it("records success locally AND on health_sync_state, with the fat cursor", async () => {
    writeLocalState(USER, state({ cursorMs: null }));
    const end = Date.now() + 500_000;
    syncPull.mockResolvedValue({
      workouts: [workout("w1", end - 60_000)],
      samples: [],
      latestCursorMs: end,
      hasMore: false,
    });

    const outcome = await runHealthSync(USER);
    expect(outcome.ok).toBe(true);

    expect(readLocalState(USER)).toMatchObject({
      syncStatus: "succeeded",
      cursorMs: end,
    });
    expect(readLocalState(USER).lastSyncAt).not.toBeNull();

    const stateUpsert = fromMock.mock.calls.find((args) => args[0] === "health_sync_state");
    expect(stateUpsert).toBeTruthy();
  });

  it("keeps the failed verdict after a refresh, without advancing the cursor", async () => {
    writeLocalState(USER, state({ cursorMs: 1_000, lastSyncAt: "2026-10-01T00:00:00.000Z" }));
    syncPull.mockRejectedValue(new Error("boom")); // bridge dead

    const outcome = await runHealthSync(USER);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("sync_failed");

    const stored = readLocalState(USER);
    expect(stored.syncStatus).toBe("failed");
    expect(stored.cursorMs).toBe(1_000); // the failed pass never advanced it
    expect(stored.lastSyncAt).toBe("2026-10-01T00:00:00.000Z"); // no timestamp to claim
  });

  it("records the failure verdict for uploads that refuse, at the old cursor", async () => {
    writeLocalState(USER, state({ cursorMs: 2_000 }));
    syncPull.mockResolvedValue({
      workouts: [workout("w1", Date.now())],
      samples: [],
      latestCursorMs: 9_000,
      hasMore: false,
    });
    const errors = new Map<string, { error: { message: string } }>([
      ["health_workouts", { error: { message: "rls denied" } }],
    ]);
    fromMock.mockImplementation((table: string) =>
      fakeFrom(
        () => Promise.resolve({ data: null }),
        () => Promise.resolve({ error: errors.get(table) ?? null }),
      ),
    );

    const outcome = await runHealthSync(USER);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("upload_failed");
    expect(readLocalState(USER)).toMatchObject({ syncStatus: "failed", cursorMs: 2_000 });

    // Leave the store in a good shape for the following tests.
    setDefaultClient();
  });

  it("closes the claim when permissions are revoked mid-sync, and clears consent", async () => {
    writeLocalState(USER, state());
    writeConsentFixture(true);
    syncPull.mockRejectedValue(new Error("permission_revoked"));

    const outcome = await runHealthSync(USER);
    expect(outcome.error).toBe("permission_revoked");
    expect(JSON.parse(localStorage.getItem(consentKey)!)).toMatchObject({ connected: false });
    expect(readLocalState(USER).syncStatus).toBe("failed");
  });
});

describe("cross-device state", () => {
  it("serves the server row's outcome to a device with none of its own", async () => {
    fromMock.mockImplementation(() =>
      fakeFrom(() =>
        Promise.resolve({
          data: {
            last_sync_at: "2026-10-15T06:00:00.000Z",
            last_incremental_cursor: "2026-10-15T06:00:00.000Z",
            sync_status: "succeeded",
          },
        }),
      ),
    );

    const serverState = await fetchServerSyncState("fresh-device");
    expect(serverState).toMatchObject({
      lastSyncAt: "2026-10-15T06:00:00.000Z",
      syncStatus: "succeeded",
    });
    expect(serverState.cursorMs).toEqual(new Date("2026-10-15T06:00:00.000Z").getTime());
  });

  it("does not re-offer initial setup to an account the server records as connected", async () => {
    fromMock.mockImplementation(() => fakeFrom(() => Promise.resolve({ data: { connected: true } })));
    checkPerms.mockResolvedValue({ grantedCount: 6, missingCount: 0 });

    const resolution = await resolveHealthStatus(USER, true);
    // With no local consent the old flow read "not_connected" and replayed the
    // whole setup; the server row says connected, so the live check decides.
    expect(resolution.status).toBe("connected");
  });

  it("does not overturn a live local consent with a stale not-connected row", async () => {
    writeConsentFixture(true);
    fromMock.mockImplementation(() => fakeFrom(() => Promise.resolve({ data: { connected: false } })));
    checkPerms.mockResolvedValue({ grantedCount: 6, missingCount: 0 });

    const resolution = await resolveHealthStatus(USER, true);
    expect(resolution.status).toBe("connected");
  });

  it("reads locally revoked permissions as permission_required, not a re-setup", async () => {
    writeConsentFixture(true);
    checkPerms.mockResolvedValue({ grantedCount: 4, missingCount: 2 });
    const resolution = await resolveHealthStatus(USER, true);
    expect(resolution.status).toBe("permission_required");
  });

  it("does not put a device that just disconnected back into connected", async () => {
    // The reported bug: after Disconnect the sheet still offered Disconnect.
    // The local consent and the account row are two writes, and the native
    // grant is a third fact; if either of the first two lags or fails, the
    // resolver used to keep answering "connected". The explicit disconnect
    // marker is what settles it — and the account row is not even consulted.
    localStorage.setItem(
      consentKey,
      JSON.stringify({ connected: false, version: HEALTH_PERMISSIONS_VERSION, disconnected: true }),
    );
    fromMock.mockImplementation(() => fakeFrom(() => Promise.resolve({ data: { connected: true } })));
    checkPerms.mockResolvedValue({ grantedCount: 6, missingCount: 0 });

    const resolution = await resolveHealthStatus(USER, true);
    expect(resolution.status).toBe("not_connected");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("treats an unreadable account row as unresolved, not disconnected", async () => {
    fromMock.mockImplementation(() => {
      throw new Error("offline");
    });
    expect(await resolveHealthStatus(USER, false)).toMatchObject({
      status: "unavailable",
      consentOutdated: false,
    });
    setDefaultClient();
  });
});

describe("disconnect", () => {
  it("records the marker, clears the cursor and keeps the imported-data memory", async () => {
    localStorage.setItem(
      consentKey,
      JSON.stringify({ connected: true, version: HEALTH_PERMISSIONS_VERSION }),
    );
    writeLocalState(USER, state({ cursorMs: 5_000, lastSyncAt: "2026-10-01T00:00:00.000Z", syncStatus: "succeeded" }));
    localStorage.setItem(`vaylo:hc:imported:${USER}`, "1");

    await disconnectHealthConnect(USER);

    expect(readConsent(USER)).toMatchObject({ connected: false, disconnected: true });
    expect(localStorage.getItem(key)).toBeNull();
    // Imported rows stay in the log; the UI needs to remember that so the
    // delete control does not vanish with the connection.
    expect(hasImportedData(USER)).toBe(true);

    const stateWrite = fromMock.mock.calls.find((args) => args[0] === "health_sync_state");
    expect(stateWrite).toBeTruthy();
  });

  it("leaves consent alone when the grant could not be withdrawn", async () => {
    localStorage.setItem(
      consentKey,
      JSON.stringify({ connected: true, version: HEALTH_PERMISSIONS_VERSION }),
    );
    revokePerms.mockResolvedValue(false);

    await expect(disconnectHealthConnect(USER)).rejects.toThrow(/Could not withdraw/);
    expect(readConsent(USER).connected).toBe(true);
  });
});

describe("cursor maths", () => {
  it("never takes the cursor backwards from a straggling batch", async () => {
    writeLocalState(USER, state({ cursorMs: 5_000 }));
    syncPull
      .mockResolvedValueOnce({
        workouts: [workout("w1", 6_000)],
        samples: [],
        latestCursorMs: 7_000,
        hasMore: true,
      })
      // A record that carries an OLD timestamp lands late; the cursor must not
      // follow it backwards. (One batched workout, built as an array.)
      .mockResolvedValueOnce({
        workouts: [workout("w2", 1_500)],
        samples: [],
        latestCursorMs: 1_500,
        hasMore: false,
      });

    const outcome = await runHealthSync(USER);
    expect(outcome.ok).toBe(true);
    expect(readLocalState(USER).cursorMs).toBe(7_000);
  });

  it("pages through every pending batch of an initial sync", async () => {
    syncPull
      .mockResolvedValueOnce({
        workouts: [workout("w1", Date.now())],
        samples: [],
        latestCursorMs: 10_000,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        workouts: [workout("w2", Date.now())],
        samples: [],
        latestCursorMs: 20_000,
        hasMore: false,
      });

    const outcome = await runHealthSync(USER);
    expect(outcome.ok).toBe(true);
    expect(outcome.workouts).toBe(2);
    expect(readLocalState(USER).cursorMs).toBe(20_000);
  });
});

function setDefaultClient() {
  fromMock.mockImplementation(() => fakeFrom());
}

function writeConsentFixture(connected: boolean) {
  localStorage.setItem(
    consentKey,
    JSON.stringify({ connected, version: HEALTH_PERMISSIONS_VERSION }),
  );
}

// Same shape the engine writes — kept local so tests fix only the harness's
// starting state, not the engine's writes.
function writeLocalState(userId: string, s: StoredHealthState) {
  localStorage.setItem(`vaylo:hc:state:${userId}`, JSON.stringify(s));
}
