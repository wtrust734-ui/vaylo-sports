// ============================================================================
// VAYLO SPORTS — blocking
// ----------------------------------------------------------------------------
// Blocking is the one abuse control that must be airtight: a blocked athlete
// cannot send friend requests to (or receive them from) the blocker, enforced
// by the trg_guard_friend_blocked trigger. The block list itself is private —
// only the blocker can read their own rows.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

/**
 * Block another athlete.
 *
 * `blocker_id` is sent explicitly. It is NOT NULL with no column default, so the
 * insert that omitted it could never have succeeded: blocking was broken from the
 * day this file was written, and it failed silently because nothing in the app
 * reports a failed block as anything but a message. Found by regenerating
 * src/integrations/supabase/types.ts, which had been stale for long enough that
 * the column was not even known to the compiler.
 *
 * The id comes from the session rather than a parameter, so a caller cannot block
 * on somebody else's behalf.
 */
export async function blockUser(blockedId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { ok: false, error: "Your session has expired. Sign in again." };

  const { error } = await supabase
    .from("user_blocks")
    .insert({ blocker_id: user.id, blocked_id: blockedId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function unblockUser(blockedId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("user_blocks").delete().eq("blocked_id", blockedId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchBlockedUsers(): Promise<string[]> {
  const { data, error } = await supabase.from("user_blocks").select("blocked_id");
  if (error) {
    console.error("fetchBlockedUsers failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.blocked_id);
}
