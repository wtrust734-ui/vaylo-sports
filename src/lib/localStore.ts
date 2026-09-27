// Tiny typed localStorage helper for client-only features.
import { localDateKey } from "./dates";
export const lsGet = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};
export const lsSet = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or unavailable — non-critical */ }
};
/** Local calendar day (see lib/dates.ts) — was UTC, which misfiled evening logs. */
export const isoDate = (d = new Date()) => localDateKey(d);
