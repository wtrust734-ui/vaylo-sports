// ============================================================================
// VAYLO HEALTH — Capacitor bridge
// ----------------------------------------------------------------------------
// The single seam between the web app and the native Android layer. Resolves
// the custom `VayloHealthConnect` plugin through `loadPlugin`, which owns the
// one `registerPlugin` call that gives the Kotlin class a JS proxy. On web every
// function resolves to a "web" sentinel result instead of throwing, so callers
// can branch on platform without try/catch noise.
//
// Raw health data is NEVER logged here.
// ============================================================================

import { loadPlugin, isAndroid } from "@/lib/platform";
import type { NormalizedSample, NormalizedWorkout, SyncPullResult } from "./types";

/** Shape the Kotlin plugin answers with (camelCase, normalized units). */
interface HealthConnectPluginShape {
  isAvailable(): Promise<{ available: boolean; apiStatus?: number }>;
  checkPermissionsStatus(): Promise<{ granted: string[]; missing: string[]; partial: boolean; version: number }>;
  requestPermissionsStatus(): Promise<{ granted: string[]; missing: string[]; cancelled?: boolean }>;
  openHealthConnectSettings(): Promise<{ opened: boolean; store?: boolean }>;
  syncPull(options: { sinceMs?: number | null; limit?: number }): Promise<{
    workouts: NormalizedWorkout[];
    samples: NormalizedSample[];
    latestCursorMs: number | null;
    hasMore: boolean;
  }>;
}

export async function loadHealthBridge(): Promise<HealthConnectPluginShape | null> {
  if (!isAndroid()) return null; // web / iOS: no bridge, page explains gracefully
  return loadPlugin<HealthConnectPluginShape>("VayloHealthConnect");
}

export type HealthApiStatus = "unavailable" | "update_required" | "available" | "unknown";

export async function bridgeAvailability(): Promise<{
  supported: boolean;
  status: HealthApiStatus;
}> {
  const bridge = await loadHealthBridge();
  if (!bridge) return { supported: false, status: "unavailable" };
  try {
    const res = await bridge.isAvailable();
    if (res.available) return { supported: true, status: "available" };
    return {
      supported: false,
      status: res.apiStatus === 3 ? "update_required" : "unavailable",
    };
  } catch {
    return { supported: false, status: "unavailable" };
  }
}

export async function bridgeCheckPermissions(): Promise<{
  grantedCount: number;
  missingCount: number;
  version: number;
} | null> {
  const bridge = await loadHealthBridge();
  if (!bridge) return null;
  try {
    const res = await bridge.checkPermissionsStatus();
    return { grantedCount: res.granted?.length ?? 0, missingCount: res.missing?.length ?? 0, version: res.version };
  } catch {
    return null;
  }
}

export async function bridgeRequestPermissions(): Promise<{
  grantedCount: number;
  missingCount: number;
  cancelled: boolean;
} | null> {
  const bridge = await loadHealthBridge();
  if (!bridge) return null;
  try {
    const res = await bridge.requestPermissionsStatus();
    return {
      grantedCount: res.granted?.length ?? 0,
      missingCount: res.missing?.length ?? 0,
      cancelled: !!res.cancelled,
    };
  } catch {
    return null;
  }
}

export async function bridgeOpenSettings(): Promise<boolean> {
  const bridge = await loadHealthBridge();
  if (!bridge) return false;
  try {
    const res = await bridge.openHealthConnectSettings();
    return !!res.opened;
  } catch {
    return false;
  }
}

export async function bridgeSyncPull(sinceMs: number | null, limit = 200): Promise<SyncPullResult | null> {
  const bridge = await loadHealthBridge();
  if (!bridge) return null;
  try {
    return await bridge.syncPull({ sinceMs, limit });
  } catch (e) {
    // Distinguish revoked permissions from transient failure by error message
    // code only — never log payloads.
    const code = (e as { message?: string })?.message ?? "";
    throw new Error(code.includes("permission") ? "permission_revoked" : "sync_failed");
  }
}
