import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export async function listNotifications(userId: string, limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications").select("*")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  // An empty inbox and an unreadable one look identical to the athlete, and
  // "you have no notifications" is a claim this app should not make by accident.
  readFailed(error, "your notifications", { quiet: true });
  return (data || []) as AppNotification[];
}

export async function markAllRead(userId: string) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  if (error) console.error("markAllRead failed:", error.message);
}

export async function markRead(id: string) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
  if (error) console.error("markRead failed:", error.message);
}

export async function pushNotification(userId: string, type: string, title: string, body?: string, link?: string) {
  const { error } = await supabase.from("notifications").insert({ user_id: userId, type, title, body, link });
  if (error) console.error("createNotification failed:", error.message);
}

/**
 * Only in-app routes may be navigated to from a notification. Links come from
 * many writers (triggers, future jobs), so a malformed or hostile value must
 * never reach the router: `javascript:` URLs, protocol-relative `//host`, and
 * absolute `https://` links are refused, as are the `vaylo:*` dedup keys the
 * daily triggers store in the same column (they are not routes).
 */
export function safeNotificationLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const l = link.trim();
  if (!l.startsWith("/") || l.startsWith("//") || l.startsWith("/\\")) return null;
  return l;
}
