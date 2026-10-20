// ============================================================================
// FRIENDS ACCESS — the client half of the >3-distinct-report restriction
// ----------------------------------------------------------------------------
// The Friends restriction is enforced by the database (trg_guard_friendrequest_
// restriction, trg_guard_messaging_restriction, and the friendships read
// policy), so the screens do not implement an access rule — they READ one
// result and render the explanation instead of pretending the feature works
// normally for that athlete.
//
// What the server returns is deliberately small: restricted?, the qualifying
// distinct-report count, and the policy threshold ("more than three"). No
// reporter identities, no report contents — reports are private to their
// reporter, and this surface has no reason to guess at who said what.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

export interface FriendAccessState {
  restricted: boolean;
  /** Distinct non-dismissed reporter count against this athlete. */
  qualifyingReports: number;
  /** The policy threshold: MORE than this many distinct reports restricts. */
  thresholdForRestriction: number;
}

export type FriendAccessResult =
  | { ok: true; state: FriendAccessState; error?: string };

/**
 * The signed-in athlete's own Friends-restriction state.
 *
 * A failed read is NOT a restriction: the page cannot redesign itself around
 * "unknown", and the server refuses restricted actions anyway — this API can
 * only ever lag the truth, never loosen it.
 */
export async function fetchMyFriendAccess(): Promise<FriendAccessResult> {
  const { data, error } = await supabase.rpc("my_friend_restriction" as never, {} as never);
  if (error) {
    // The promise holds: unreadable ≠ restricted. The caller still sees WHY —
    // surfaced in dev, ignored by the plot — so a silently broken read is not
    // the price of an honest page.
    return {
      ok: true,
      state: { restricted: false, qualifyingReports: 0, thresholdForRestriction: 4 },
      error: error.message,
    };
  }
  const raw = (data ?? {}) as {
    restricted?: boolean;
    qualifying_reports?: number;
    threshold_for_restriction?: number;
  };
  const reports = Number(raw.qualifying_reports);
  const threshold = Number(raw.threshold_for_restriction);
  return {
    ok: true,
    state: {
      restricted: raw.restricted === true,
      qualifyingReports: Number.isFinite(reports) ? reports : 0,
      thresholdForRestriction: Number.isFinite(threshold) && threshold > 0 ? threshold : 4,
    },
  };
}

/** The explanation the restricted athlete reads. Shared by every surface that
 *  gates on the same server truth, so the policy is worded once. */
export const FRIEND_RESTRICTION_POLICY =
  "Access to Friends is restricted after more than three qualifying reports were filed about this account by different athletes. Reports are only a signal for review — they are not a verdict, and a moderator can review the reports and restore access.";

/**
 * The appeal path: files the restriction review through the same
 * support-request function every other in-app request uses (validated,
 * rate-limited, stored with a reference, emailed to the operator). Category
 * "safety" because a restriction review is a moderation matter; the subject
 * names the feature so the operator's queue can triage without opening the
 * body. The athlete writes the argument; the count and the policy it came
 * from are attached server-side by the recompute trigger, not quoted here.
 */
export async function appealFriendRestriction(
  message: string
): Promise<{ ok: boolean; reference?: string; error?: string }> {
  const trimmed = message.trim();
  if (trimmed.length < 10) return { ok: false, error: "Write at least a sentence about why the reports are wrong." };
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user?.email ?? "";
  if (!email) return { ok: false, error: "Your session has expired. Sign in again and appeal from here." };
  const { data, error } = await supabase.functions.invoke("support-request", {
    body: {
      category: "safety",
      email,
      subject: "Friends restriction appeal",
      body: `[Friends restriction appeal] ${trimmed}`,
    },
  });
  if (error) return { ok: false, error: error.message };
  const reference = (data as { reference?: string } | null)?.reference;
  return { ok: true, reference: reference ?? "saved" };
}

export const FRIEND_RESTRICTION_APPEAL =
  "If you believe the reports are wrong or abusive, contact support and ask for a review — say you are appealing a Friends restriction.";
