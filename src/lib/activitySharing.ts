// ============================================================================
// VAYLO SPORTS — activity sharing
// ----------------------------------------------------------------------------
// Sharing is an explicit, per-activity choice. The athlete presses Share and one
// row lands in `shared_activities`; the feed reads that table, never the private
// training tables.
//
// Why it works this way: `workouts`, `achievements` and `outcome_goals` are
// self-read-only under RLS, so a feed built on a friendship graph could only
// ever show an athlete their own rows — and relaxing RLS to change that would
// expose everyone's training and health data. Publishing is the only safe way to
// make activity social, and it gives the athlete control over each item.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { fetchDisplayNames } from "@/lib/publicIdentity";

export type SharedActivityRow = Tables<"shared_activities">;

export const SHARE_KINDS = ["workout", "achievement", "goal", "personal_best", "note"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export interface ShareInput {
  kind: ShareKind;
  /** The row being shared. Null/omitted for a free-form note. */
  sourceId?: string | null;
  title: string;
  detail?: string | null;
  sport?: string | null;
}

export interface SharedActivity extends SharedActivityRow {
  /** Public display name, resolved from `avatars`. */
  athlete: string;
  /** Total hypes from other athletes. */
  hypeCount: number;
  /** Whether the signed-in athlete has hyped this one. */
  hypedByMe: boolean;
}

const MAX_TITLE = 140;
const MAX_DETAIL = 280;

function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Stable key for "have I already shared this?" lookups. */
export function shareKey(kind: ShareKind, sourceId: string | null | undefined): string {
  return `${kind}:${sourceId ?? ""}`;
}

/**
 * Publishes an activity. Re-sharing the same source is idempotent — the unique
 * index rejects the duplicate and we report success, so a double tap or a race
 * between two tabs can't create two copies.
 */
export async function shareActivity(input: ShareInput, userId: string): Promise<{ ok: boolean; error?: string }> {
  const title = clean(input.title, MAX_TITLE);
  if (!title) return { ok: false, error: "Give your share a title first." };

  const row: TablesInsert<"shared_activities"> = {
    user_id: userId,
    source_kind: input.kind,
    source_id: input.sourceId ?? null,
    title,
    detail: clean(input.detail, MAX_DETAIL),
    sport: clean(input.sport, 80),
  };

  const { error } = await supabase.from("shared_activities").insert(row);
  // 23505 = this activity is already shared. That is the desired end state.
  if (error && error.code !== "23505") {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Removes a share. RLS restricts this to the athlete's own rows. */
export async function unshareActivity(input: { kind: ShareKind; sourceId?: string | null }): Promise<{ ok: boolean }> {
  let q = supabase.from("shared_activities").delete().eq("source_kind", input.kind);
  q = input.sourceId ? q.eq("source_id", input.sourceId) : q.is("source_id", null);
  const { error } = await q;
  if (error) {
    console.error("unshareActivity failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

export async function unshareById(id: string): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("shared_activities").delete().eq("id", id);
  if (error) {
    console.error("unshareById failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Keys of the signed-in athlete's existing shares, for button state. */
export async function fetchMyShareKeys(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("shared_activities")
    .select("source_kind, source_id")
    .eq("user_id", userId);
  if (error) {
    console.error("fetchMyShareKeys failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => shareKey(r.source_kind as ShareKind, r.source_id)));
}

/** How many hypes each activity has, and whether I added one. */
async function fetchHypeState(activityIds: string[], userId: string | null) {
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  if (activityIds.length === 0) return { counts, mine };

  const { data, error } = await supabase
    .from("activity_hypes")
    .select("activity_id, user_id")
    .in("activity_id", activityIds);
  if (error) {
    console.error("fetchHypeState failed:", error.message);
    return { counts, mine };
  }
  for (const row of data ?? []) {
    counts.set(row.activity_id, (counts.get(row.activity_id) ?? 0) + 1);
    if (userId && row.user_id === userId) mine.add(row.activity_id);
  }
  return { counts, mine };
}

/**
 * The shared feed: newest shares from every athlete, with public display names
 * and real hype counts. Never throws — a failure yields an empty list so the
 * page around it still renders.
 */
export async function fetchSharedFeed(opts: { limit?: number; userId: string | null }): Promise<SharedActivity[]> {
  const { data, error } = await supabase
    .from("shared_activities")
    .select("*")
    .order("shared_at", { ascending: false })
    .limit(opts.limit ?? 50);

  if (error) {
    console.error("fetchSharedFeed failed:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [hype, names] = await Promise.all([
    fetchHypeState(ids, opts.userId),
    fetchDisplayNames(rows.map((r) => r.user_id)),
  ]);

  return rows.map((r) => ({
    ...r,
    athlete: names[r.user_id] ?? "Athlete",
    hypeCount: hype.counts.get(r.id) ?? 0,
    hypedByMe: hype.mine.has(r.id),
  }));
}

/** Adds a hype. A duplicate is fine — the primary key makes it impossible. */
export async function hypeActivity(activityId: string, userId: string): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("activity_hypes").insert({ activity_id: activityId, user_id: userId });
  if (error && error.code !== "23505") {
    // The database refuses self-hype by design; surface that rather than silently
    // leaving the button looking broken.
    console.warn("hypeActivity:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

export async function unhypeActivity(activityId: string, userId: string): Promise<{ ok: boolean }> {
  const { error } = await supabase
    .from("activity_hypes")
    .delete()
    .eq("activity_id", activityId)
    .eq("user_id", userId);
  if (error) {
    console.error("unhypeActivity failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Builds the share payload for a completed workout. */
export function workoutShareInput(w: {
  id: string;
  title: string | null;
  type: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
}): ShareInput {
  const bits: string[] = [];
  if (w.duration_minutes) bits.push(`${w.duration_minutes} min`);
  if (w.distance_km) bits.push(`${Number(w.distance_km)} km`);
  return {
    kind: "workout",
    sourceId: w.id,
    title: w.title?.trim() || "Workout",
    detail: bits.join(" · ") || null,
    sport: w.type,
  };
}
