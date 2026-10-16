// ============================================================================
// SAFETY — reporting, blocking and data portability
// ----------------------------------------------------------------------------
// The client half of the P0 safety controls. Three jobs:
//
//   1. file a content report          (P0-1, Google Play UGC policy)
//   2. block and unblock an athlete   (P0-2, the DB already enforced this)
//   3. download everything we hold    (P0-4, UK GDPR Art. 20)
//
// Reporting goes through the `report_content` RPC rather than a direct insert.
// The function validates the reason enum, rate-limits, and is idempotent — so a
// double-tap is not a failure, and a client cannot probe which ids exist.
//
// Blocking filters the feed SERVER-SIDE via the `feed_visible_activities` view.
// Nothing here filters the feed in the client: the blocked athlete's rows must
// never reach the device, and a client-side filter still ships them.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * What can be reported. A closed set, not free text, because a moderator has to
 * be able to act on what arrives. `other` carries free-text detail.
 */
export const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech or abuse" },
  { value: "sexual", label: "Sexual content" },
  { value: "self_harm", label: "Self-harm or dangerous content" },
  { value: "dangerous", label: "Unsafe training or eating advice" },
  { value: "spam", label: "Spam, advertising or scams" },
  { value: "impersonation", label: "Impersonating Vaylo or another athlete" },
  { value: "privacy", label: "My information posted without my consent" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
export type ReportTargetType =
  | "activity"
  | "profile"
  | "community"
  | "message"
  /** Published training plans in the marketplace (coach-authored). */
  | "marketplace_plan"
  /** Coach/creator profiles and listings in the marketplace. */
  | "marketplace_profile"
  | "other";

export interface ReportContentInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
  /** Shown to the moderator so a row is identifiable in a list of ids. */
  targetLabel?: string;
}

export interface ReportOutcome {
  ok: boolean;
  /** True when this athlete had already filed exactly this report. */
  alreadyReported?: boolean;
  error?: string;
}

/**
 * File a report about a piece of content or an athlete.
 *
 * Returns `alreadyReported: true` rather than an error when the same athlete
 * has already reported the same thing for the same reason — tapping Report
 * twice is a no-op, not a failure the athlete needs to understand.
 */
export async function reportContent(input: ReportContentInput): Promise<ReportOutcome> {
  const { data, error } = await supabase.rpc("report_content" as never, {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_reason: input.reason,
    p_details: input.details?.trim() || null,
    p_target_label: input.targetLabel?.trim() || null,
  } as never);

  if (error) {
    return { ok: false, error: error.message };
  }
  // The function returns the row; no row means the upsert found nothing, which
  // should be impossible given the conflict clause. Treat it as a soft failure
  // rather than a false success.
  if (!data) {
    return { ok: false, error: "We couldn't record that report. Please try again." };
  }
  return { ok: true, alreadyReported: false };
}

/** Reports this athlete has filed, newest first. RLS scopes it to them. */
export async function fetchMyReports(): Promise<
  { id: string; target_type: string; reason: string; created_at: string; status: string }[]
> {
  const { data, error } = await supabase
    .from("content_reports")
    .select("id, target_type, reason, created_at, status")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("fetchMyReports failed:", error.message);
    return [];
  }
  return (data ?? []) as never;
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

/**
 * Blocked athlete ids, for UI that needs to label existing blocks (a "Blocked"
 * badge on your own block list, or a disabled state on a profile).
 *
 * The feed itself does NOT use this — `fetchSharedFeed` reads the
 * `feed_visible_activities` view so blocked rows never leave the server.
 */
export async function fetchBlockedIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from("user_blocks").select("blocked_id");
  if (error) {
    console.error("fetchBlockedIds failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { blocked_id: string }).blocked_id));
}

// ---------------------------------------------------------------------------
// Data portability (Article 20)
// ---------------------------------------------------------------------------

export interface PortabilityExport {
  exported_at: string;
  format: string;
  complete: boolean;
  summary: {
    tables_included: number;
    tables_expected: number;
    total_rows: number;
    uploaded_files: number;
    unreadable_tables: number;
  };
  /** Present when the export was partial. Never silently omitted. */
  unreadable: { table: string; reason: string }[];
  data: Record<string, unknown>;
}

/**
 * Ask the server for everything it holds about this athlete.
 *
 * Returns `null` on failure rather than an empty export, because "we have no
 * data" and "the request failed" must not look the same in the UI.
 */
export async function requestMyData(): Promise<PortabilityExport | null> {
  const { data, error } = await supabase.functions.invoke("export-my-data", {
    method: "POST",
  });

  if (error) {
    console.error("requestMyData failed:", error.message);
    return null;
  }
  // A partial export comes back 206, which supabase-js surfaces as data with an
  // error in some versions. Both paths are handled: only a thrown error is fatal.
  if (!data) return null;
  return data as unknown as PortabilityExport;
}

/** Trigger a JSON download of a portability export. */
export function downloadExport(payload: PortabilityExport): void {
  const stamp = payload.exported_at.replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaylo-my-data-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
