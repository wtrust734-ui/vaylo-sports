import { supabase } from "@/integrations/supabase/client";

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
  const { data } = await (supabase as any)
    .from("notifications").select("*")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  return (data || []) as AppNotification[];
}

export async function markAllRead(userId: string) {
  const { error } = await (supabase as any).from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  if (error) console.error("markAllRead failed:", error.message);
}

export async function markRead(id: string) {
  const { error } = await (supabase as any).from("notifications").update({ read: true }).eq("id", id);
  if (error) console.error("markRead failed:", error.message);
}

export async function pushNotification(userId: string, type: string, title: string, body?: string, link?: string) {
  const { error } = await (supabase as any).from("notifications").insert({ user_id: userId, type, title, body, link });
  if (error) console.error("createNotification failed:", error.message);
}
