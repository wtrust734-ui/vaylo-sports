// ============================================================================
// VAYLO HEALTH — normalized health-data types
// ----------------------------------------------------------------------------
// The rest of the app consumes THESE types only. Nothing outside src/lib/health
// knows Health Connect exists. Units are fixed at the boundary:
//   distances in meters, durations in seconds, energy in kcal, HR in bpm,
//   steps in count, timestamps in ISO-8601 UTC.
//
// "No fabrication": every optional metric is `number | null`. A null heart rate
// means Health Connect had none — the UI says "—" rather than inventing one.
// ============================================================================

/** Metric kinds Vaylo Sports syncs. Add a kind here + in the native catalog + SQL. */
export type HealthMetric = "heart_rate" | "steps" | "active_calories" | "sleep" | "distance" | "vo2max" | "hrv";

export interface NormalizedWorkout {
  /** Health Connect record id — stable, used for dedup end to end. */
  sourceRecordId: string;
  title: string | null;
  activityType: string;
  startTime: string; // ISO-8601 UTC
  endTime: string; // ISO-8601 UTC
  durationSeconds: number;
  distanceMeters: number | null;
  activeCalories: number | null;
  heartRateAvg: number | null;
  heartRateMax: number | null;
  heartRateMin: number | null;
  steps: number | null;
}

export interface NormalizedSample {
  sourceRecordId: string;
  metric: HealthMetric;
  startTime: string;
  endTime: string;
  /** Sample value, or null for sessions without a scalar (e.g. sleep). */
  value: number | null;
  unit: "bpm" | "count" | "kcal" | "seconds";
  stage: string | null;
  durationSeconds?: number;
}

export interface SyncPullResult {
  workouts: NormalizedWorkout[];
  samples: NormalizedSample[];
  /** Epoch ms of the newest upstream record end time in this batch. */
  latestCursorMs: number | null;
  hasMore: boolean;
}

export type HealthConnectionStatus =
  | "checking"
  | "unavailable" // not Android / no Health Connect app
  | "not_connected" // available, never asked or user declined everything
  | "permission_required" // granted before, some permissions now missing
  | "connected";

// ---------------------------------------------------------------------------
// Multi-provider connection model (wearables)
// ---------------------------------------------------------------------------

/** Every provider Vaylo Sports can sync from (mirrors providers.ts ids). */
export type WearableProviderId = import("./providers").WearableProviderId;

export type WearableConnectionStatus =
  | "checking"
  | "unavailable"
  | "not_connected"
  | "permission_required"
  | "connected"
  | "token_expired"; // cloud OAuth token needs refresh

export interface WearableConnectionRow {
  user_id: string;
  provider: WearableProviderId;
  status: WearableConnectionStatus;
  connected: boolean;
  last_sync_at: string | null;
  last_cursor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
