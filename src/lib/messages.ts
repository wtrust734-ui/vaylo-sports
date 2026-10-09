// ============================================================================
// VAYLO SPORTS — direct messages
// ----------------------------------------------------------------------------
// One-to-one messaging between friends. The rules live in Postgres
// (20261008120000_friends_messaging_and_unfriend.sql) and this file does not
// re-implement them:
//
//   * friends only, no block in either direction   → BEFORE INSERT trigger
//   * read only by the two participants, and not   → SELECT policy
//     at all once a block exists between them
//   * attachments must be your own published share → BEFORE INSERT trigger
//   * read receipts go through mark_messages_read() → no UPDATE grant exists
//
// That last one is why `markConversationRead` is an RPC rather than an update:
// the recipient needs to write `read_at` and nothing else, and an UPDATE policy
// that allowed the column would also allow rewriting the words they received.
//
// A failure is always `{ ok: false, error }` carrying the trigger's own
// sentence, so a refusal reads as a refusal rather than as a message that
// silently did not arrive.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { fetchDisplayNames } from "@/lib/publicIdentity";

export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  /** A shared activity of the sender's, sent as an attachment. */
  activityId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface Conversation {
  friendId: string;
  /** Public display name, resolved from `avatars`. */
  name: string;
  lastBody: string;
  lastAt: string;
  lastFromMe: boolean;
  unread: number;
}

/** The raw `direct_messages` row, as the database returns it. */
export interface DirectMessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  activity_id: string | null;
  created_at: string;
  read_at: string | null;
}

export const MESSAGE_MAX_LENGTH = 2000;

/** How many recent messages the conversation list is built from. */
const CONVERSATION_SCAN = 500;

/**
 * Row → shape, exported for Realtime: an INSERT payload arrives as the raw
 * row, and the chat appends it without a second round trip.
 */
export const messageFromRow = (row: DirectMessageRow): DirectMessage => ({
  id: row.id,
  senderId: row.sender_id,
  recipientId: row.recipient_id,
  body: row.body ?? "",
  activityId: row.activity_id,
  createdAt: row.created_at,
  readAt: row.read_at,
});

/**
 * One conversation, oldest first (the order a thread is read in).
 *
 * The participant filter is a belt-and-braces `or`: the SELECT policy already
 * returns only rows this athlete is part of, and asking for the pair explicitly
 * keeps the meaning of the query readable.
 */
export async function fetchConversation(
  friendId: string,
  viewerId: string,
  limit = 200,
): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("id, sender_id, recipient_id, body, activity_id, created_at, read_at")
    .or(
      `and(sender_id.eq.${viewerId},recipient_id.eq.${friendId}),` +
        `and(sender_id.eq.${friendId},recipient_id.eq.${viewerId})`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchConversation failed:", error.message);
    return [];
  }
  // Newest-first from the database (so the limit keeps the newest), oldest-first
  // for the thread.
  return (data ?? []).map((r) => messageFromRow(r as DirectMessageRow)).reverse();
}

/**
 * Conversations, newest first, built from the athlete's own recent traffic.
 *
 * Grouping happens here rather than in a view: the set is bounded by one
 * athlete's messages, and every row involved has already passed the SELECT
 * policy (so a blocked athlete's conversation is simply absent).
 */
export async function fetchConversations(
  viewerId: string,
  friends: { id: string; name: string }[],
): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("id, sender_id, recipient_id, body, activity_id, created_at, read_at")
    .or(`sender_id.eq.${viewerId},recipient_id.eq.${viewerId}`)
    .order("created_at", { ascending: false })
    .limit(CONVERSATION_SCAN);

  if (error) {
    console.error("fetchConversations failed:", error.message);
    return [];
  }

  const byFriend = new Map<string, Conversation>();
  for (const row of (data ?? []) as DirectMessageRow[]) {
    const friendId = row.sender_id === viewerId ? row.recipient_id : row.sender_id;
    const existing = byFriend.get(friendId);
    const unread = row.recipient_id === viewerId && row.read_at === null ? 1 : 0;

    if (!existing) {
      byFriend.set(friendId, {
        friendId,
        name: "",
        lastBody: row.body || (row.activity_id ? "Shared an activity" : ""),
        lastAt: row.created_at,
        lastFromMe: row.sender_id === viewerId,
        unread,
      });
    } else if (unread) {
      existing.unread += 1;
    }
  }

  const conversations = [...byFriend.values()];
  if (conversations.length === 0) return [];

  // A conversation can outlive the friendship (unfriending keeps the history),
  // so names fall back to a lookup rather than only to the friends list.
  const known = new Map(friends.map((f) => [f.id, f.name]));
  const missing = conversations.filter((c) => !known.has(c.friendId)).map((c) => c.friendId);
  const names = missing.length ? await fetchDisplayNames(missing) : {};
  for (const c of conversations) {
    c.name = known.get(c.friendId) ?? names[c.friendId] ?? "Athlete";
  }
  return conversations;
}

/** Total unread messages, for a badge. */
export async function fetchUnreadCount(viewerId: string): Promise<number> {
  const { count, error } = await supabase
    .from("direct_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", viewerId)
    .is("read_at", null);
  if (error) {
    console.error("fetchUnreadCount failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Send a message to a friend, optionally with one of your own published
 * activities attached. Rejects locally on the shapes the database would reject
 * anyway (empty, over-long, to yourself) so the common mistake does not need a
 * round trip.
 */
export async function sendMessage(
  input: { recipientId: string; body: string; activityId?: string | null },
  viewerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = input.body.trim();
  if (body.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Messages can be up to ${MESSAGE_MAX_LENGTH} characters.` };
  }
  if (!body && !input.activityId) {
    return { ok: false, error: "Write something first." };
  }
  if (input.recipientId === viewerId) {
    return { ok: false, error: "You can't message yourself." };
  }

  const { error } = await supabase.from("direct_messages").insert({
    sender_id: viewerId,
    recipient_id: input.recipientId,
    body,
    activity_id: input.activityId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Mark everything this friend sent me as read. Returns how many changed. */
export async function markConversationRead(friendId: string): Promise<number> {
  const { data, error } = await supabase.rpc("mark_messages_read" as never, {
    p_friend_id: friendId,
  } as never);
  if (error) {
    console.error("markConversationRead failed:", error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/** Unsend. Removes the message for both sides; only the sender may do this. */
export async function unsendMessage(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("direct_messages").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
