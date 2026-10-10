// ============================================================================
// VAYLO SPORTS — friends
// ----------------------------------------------------------------------------
// The friend graph has always existed in the database and never had a screen:
// `friend_codes`, `friend_requests`, `friendships` and the `accept_friend_request`
// RPC were all in place, the Friends page was removed on 2026-10-08 as an empty
// surface, and nothing has been able to reach the graph since. This module is the
// client half of it being reachable again.
//
// Two things it does NOT do, deliberately:
//
//   * It never inserts a friendship. Friendships are created by
//     `accept_friend_request` alone — a pair trigger (`guard_friendship_pair`)
//     refuses a hand-written row, so a client that "adds a friend" by inserting
//     would get a Postgres error it could not explain.
//   * It never unfriends row by row. `unfriend()` removes both directional rows
//     AND the accepted request that authorised them in one transaction; deleting
//     only the rows would leave the request behind, which is what certifies a
//     friendship row, so either athlete could put it back.
//
// Every failure is returned as `{ ok: false, error }` with the trigger's own
// sentence, because those messages ("This athlete is not accepting friend
// requests") are written for the athlete, not for a log file.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";
import { fetchDisplayNames } from "@/lib/publicIdentity";

export interface Friend {
  /** The other athlete's user id. */
  id: string;
  /** Public display name, resolved from `avatars`. */
  name: string;
  /** When the friendship was accepted. */
  since: string | null;
}

export interface FriendRequest {
  id: string;
  /** The other athlete. */
  userId: string;
  name: string;
  createdAt: string;
}

/** Why a request was refused, for the sentence the screen shows. */
export type FriendRequestFailure =
  | "not_found"
  | "self"
  | "already_friends"
  | "already_sent"
  | "they_sent_one"
  | "opted_out"
  | "blocked"
  | "unknown";

export interface FriendActionResult {
  ok: boolean;
  error?: string;
  reason?: FriendRequestFailure;
}

const MAX_REQUESTS = 200;

/**
 * Maps a Postgres error onto something a screen can explain.
 *
 * The messages are matched literally because they come from our own triggers
 * (`guard_friend_request_insert`, `guard_friend_request_blocked`,
 * `guard_friend_request_existing_friend`). If one is reworded the match falls
 * through to "unknown" and the athlete still sees the message itself — this
 * never turns a failure into a success.
 */
function classifyRequestError(message: string, code?: string): FriendRequestFailure {
  if (code === "23505") return "already_sent";
  if (message.includes("not accepting friend requests")) return "opted_out";
  if (message.includes("already sent you a request")) return "they_sent_one";
  if (message.includes("already friends")) return "already_friends";
  if (message.includes("blocked")) return "blocked";
  return "unknown";
}

/** Athletes this account is friends with, newest friendship first. */
export async function fetchFriends(userId: string): Promise<Friend[]> {
  const { data, error } = await supabase
    .from("friendships")
    .select("friend_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_REQUESTS);

  if (error) {
    console.error("fetchFriends failed:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const names = await fetchDisplayNames(rows.map((r) => r.friend_id));
  return rows.map((r) => ({
    id: r.friend_id,
    name: names[r.friend_id] ?? "Athlete",
    since: r.created_at,
  }));
}

/** Requests waiting for this athlete to answer. */
export async function fetchIncomingRequests(userId: string): Promise<FriendRequest[]> {
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id, from_user_id, created_at")
    .eq("to_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(MAX_REQUESTS);

  if (error) {
    console.error("fetchIncomingRequests failed:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const names = await fetchDisplayNames(rows.map((r) => r.from_user_id));
  return rows.map((r) => ({
    id: r.id,
    userId: r.from_user_id,
    name: names[r.from_user_id] ?? "Athlete",
    createdAt: r.created_at,
  }));
}

/** Requests this athlete has sent and not had answered. */
export async function fetchOutgoingRequests(userId: string): Promise<FriendRequest[]> {
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id, to_user_id, created_at")
    .eq("from_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(MAX_REQUESTS);

  if (error) {
    console.error("fetchOutgoingRequests failed:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const names = await fetchDisplayNames(rows.map((r) => r.to_user_id));
  return rows.map((r) => ({
    id: r.id,
    userId: r.to_user_id,
    name: names[r.to_user_id] ?? "Athlete",
    createdAt: r.created_at,
  }));
}

/**
 * Send a friend request to whoever owns this code.
 *
 * The lookup goes through `find_user_by_friend_code` rather than reading
 * `friend_codes`: that table is own-row readable on purpose, so a client cannot
 * enumerate codes, and the RPC is an exact-match lookup only. A null result
 * means no such code — which is also what an attacker learns, since "no such
 * code" and "code belongs to an athlete who opted out" are different sentences.
 */
export async function sendFriendRequestByCode(
  code: string,
  userId: string,
): Promise<FriendActionResult> {
  const trimmed = code.trim();
  if (trimmed.length < 4) {
    return { ok: false, reason: "not_found", error: "Enter the code you were given." };
  }

  const { data: targetId, error: lookupError } = await supabase.rpc(
    "find_user_by_friend_code" as never,
    { p_code: trimmed } as never,
  );
  if (lookupError) return { ok: false, reason: "unknown", error: lookupError.message };
  if (!targetId) {
    return {
      ok: false,
      reason: "not_found",
      error: "We couldn't find that code. Check it with your friend and try again.",
    };
  }
  if (targetId === userId) {
    return { ok: false, reason: "self", error: "That's your own code." };
  }

  const { error } = await supabase
    .from("friend_requests")
    .insert({ from_user_id: userId, to_user_id: targetId as string });

  if (error) {
    return { ok: false, reason: classifyRequestError(error.message, error.code), error: error.message };
  }
  return { ok: true };
}

/**
 * Accept a request. The RPC does all of it: flips the request to accepted and
 * writes BOTH friendship rows in one transaction, so two taps or two devices
 * collapse to one friendship instead of half of one.
 *
 * A null return is "there was nothing pending" — already accepted, cancelled,
 * or never yours — and is reported as such rather than as a success.
 */
export async function acceptFriendRequest(requestId: string): Promise<FriendActionResult & { friendId?: string }> {
  const { data, error } = await supabase.rpc("accept_friend_request" as never, {
    p_request_id: requestId,
  } as never);
  if (error) return { ok: false, error: error.message };
  if (!data) {
    return { ok: false, error: "That request is no longer waiting — it may have been cancelled." };
  }
  return { ok: true, friendId: data as string };
}

/** Decline a request sent to me. RLS already scopes the update to my own inbox. */
export async function declineFriendRequest(requestId: string): Promise<FriendActionResult> {
  const { error } = await supabase
    .from("friend_requests")
    .update({ status: "declined" })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Withdraw a request I sent. The DELETE policy allows own PENDING rows only. */
export async function cancelFriendRequest(requestId: string): Promise<FriendActionResult> {
  const { error } = await supabase.from("friend_requests").delete().eq("id", requestId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * End a friendship. Both rows, the accepted request, and any pending request in
 * either direction go together — see `unfriend()` in
 * 20261008120000_friends_messaging_and_unfriend.sql for why the request cannot
 * be left behind.
 */
export async function unfriend(friendId: string): Promise<FriendActionResult> {
  const { data, error } = await supabase.rpc("unfriend" as never, {
    p_friend_id: friendId,
  } as never);
  if (error) return { ok: false, error: error.message };
  if (data !== true) {
    return { ok: false, error: "You are not friends with this athlete." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Friend codes
// ---------------------------------------------------------------------------

/**
 * Codes avoid 0/O/1/I/L: this is read off a screen and typed by a friend, and
 * the pairs that look alike are the ones that get transcribed wrongly.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/**
 * This athlete's own code, creating one if the account has never had one.
 *
 * No trigger creates these — `friend_codes` has sat empty since the table was
 * added, which is why "add a friend by code" could never have worked. `on
 * conflict do nothing` makes a code that arrives from a signup trigger later
 * harmless, and a collision on `code` returns no row, so the caller can retry.
 */
export async function ensureMyFriendCode(userId: string): Promise<string | null> {
  const { data: existing, error: readError } = await supabase
    .from("friend_codes")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) {
    console.error("ensureMyFriendCode read failed:", readError.message);
    return null;
  }
  if (existing?.code) return existing.code;

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase
      .from("friend_codes")
      .insert({ user_id: userId, code: makeCode() })
      .select("code")
      .maybeSingle();
    if (!error && data?.code) return data.code;
    // 23505 on user_id means another device created it a moment ago; re-read.
    if (error?.code === "23505") {
      const { data: again, error: againError } = await supabase
        .from("friend_codes")
        .select("code")
        .eq("user_id", userId)
        .maybeSingle();
      // This is the "did the insert actually land" re-read. A failed one makes a
      // code that exists look missing, so the athlete is handed a second code.
      readFailed(againError, "your friend code", { quiet: true });
      if (again?.code) return again.code;
    }
    // Any other error (including a code collision) retries with a fresh code.
  }
  return null;
}
