// ===========================================================================
// VAYLO HEALTH — unified wearable connections (read-side)
// ---------------------------------------------------------------------------
// The app's single read path for \"which wearables are connected, and when did
// each last sync\". Backed by the health_connections table (see migration
// 20260926_wearables) and by the existing health_sync_state row for the
// legacy Health Connect hub. Every screen imports this file — nothing in the
// UI touches health_sync_state / health_connections directly.
//
// For backward compatibility: the legacy health_sync_state row is surfaced as
// the \"health_connect\" provider in the returned map, so the existing native
// sync engine keeps working unchanged.
// ===========================================================================

import { supabase } from "@/integrations/supabase/client";
import type { WearableProviderId } from "./providers";
import type { WearableConnectionStatus } from "./types";

export interface WearableConnection {
  provider: WearableProviderId;
  status: WearableConnectionStatus;
  connected: boolean;
  lastSyncAt: string | null;
  lastCursor: string | null;
  updatedAt: string | null;
}

export type WearableConnectionMap = Record<WearableProviderId, WearableConnection | null>;

const HC_LOCAL_STATE = (uid: string) => `vaylo:hc:state:${uid}`;
const HC_CONSENT_KEY = (uid: string) => `vaylo:hc:consent:${uid}`;

function readLocalHcState(uid: string): { lastSyncAt: string | null; cursorMs: number | null } {
  try {
    const raw = localStorage.getItem(HC_LOCAL_STATE(uid));
    if (raw) {
      const p = JSON.parse(raw);
      return { lastSyncAt: p.lastSyncAt ?? null, cursorMs: p.cursorMs ?? null };
    }
  } catch { /* ignore */ }
  return { lastSyncAt: null, cursorMs: null };
}

function readLocalHcConsent(uid: string): boolean {
  try {
    const raw = localStorage.getItem(HC_CONSENT_KEY(uid));
    if (raw) return !!JSON.parse(raw)?.connected;
  } catch { /* ignore */ }
  return false;
}

/** Reads health_connections (+ legacy health_sync_state) into a provider map. */
export async function fetchWearableConnections(userId: string): Promise<WearableConnectionMap> {
  const map = {} as WearableConnectionMap;

  // --- Cloud / multi-provider rows (new table) ------------------------------
  try {
    const { data } = await (supabase as any)
      .from("health_connections")
      .select("provider, status, connected, last_sync_at, last_cursor, updated_at")
      .eq("user_id", userId);
    for (const row of (data ?? []) as Array<{
      provider: WearableProviderId; status: string; connected: boolean;
      last_sync_at: string | null; last_cursor: string | null; updated_at: string | null;
    }>) {
      map[row.provider] = {
        provider: row.provider,
        status: (row.status as WearableConnectionStatus) ?? (row.connected ? "connected" : "not_connected"),
        connected: !!row.connected,
        lastSyncAt: row.last_sync_at,
        lastCursor: row.last_cursor,
        updatedAt: row.updated_at,
      };
    }
  } catch { /* table not yet migrated */ }

  // --- Legacy Health Connect hub (health_sync_state + localStorage consent) --
  try {
    const local = readLocalHcState(userId);
    const hasConsent = readLocalHcConsent(userId);
    const { data } = await (supabase as any)
      .from("health_sync_state")
      .select("connected, last_sync_at, last_incremental_cursor, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    const connected = !!(data?.connected ?? hasConsent);
    const lastSync = (local.lastSyncAt ?? data?.last_sync_at) ?? null;
    const cursor = local.cursorMs != null
      ? new Date(local.cursorMs).toISOString()
      : (data?.last_incremental_cursor ?? null);
    if (!map.health_connect) {
      map.health_connect = {
        provider: "health_connect",
        status: connected ? "connected" : hasConsent ? "permission_required" as const : "not_connected",
        connected,
        lastSyncAt: lastSync,
        lastCursor: cursor,
        updatedAt: data?.updated_at ?? null,
      };
    } else if (lastSync && !map.health_connect.lastSyncAt) {
      map.health_connect.lastSyncAt = lastSync;
    }
  } catch { /* ignore */ }

  return map;
}

export function isProviderConnected(
  map: WearableConnectionMap,
  provider: WearableProviderId
): boolean {
  return !!map[provider]?.connected;
}

export function connectedProviders(map: WearableConnectionMap): WearableProviderId[] {
  return (Object.keys(map) as WearableProviderId[]).filter((k) => !!map[k]?.connected);
}

export function lastSyncAny(map: WearableConnectionMap): string | null {
  let best: string | null = null;
  for (const c of Object.values(map) as (WearableConnection | null)[]) {
    if (!c?.lastSyncAt) continue;
    if (!best || c.lastSyncAt > best) best = c.lastSyncAt;
  }
  return best;
}
