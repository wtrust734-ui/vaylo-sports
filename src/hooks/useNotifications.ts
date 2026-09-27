import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { listNotifications, markAllRead, markRead, AppNotification } from "@/lib/notifications";

export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setItems(await listNotifications(user.id));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => setItems((prev) => [payload.new as AppNotification, ...prev]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const unread = items.filter((i) => !i.read).length;

  return {
    items, loading, unread,
    markAllRead: async () => { if (user) { await markAllRead(user.id); setItems((p) => p.map((n) => ({ ...n, read: true }))); } },
    markRead: async (id: string) => { await markRead(id); setItems((p) => p.map((n) => n.id === id ? { ...n, read: true } : n)); },
    refresh: load,
  };
}
