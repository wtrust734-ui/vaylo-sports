import { useEffect } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { motion } from "framer-motion";
import { Bell, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

export default function Notifications() {
  const { items, loading, markAllRead, markRead } = useNotifications();
  const navigate = useNavigate();

  useEffect(() => { markAllRead(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="px-5 pt-8 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="h-6 w-6 text-electric-purple" /> Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">All your activity in one place.</p>
        </div>
        <button onClick={() => navigate("/profile/notifications")} className="h-9 w-9 rounded-full bg-muted/40 hover:bg-muted/60 flex items-center justify-center">
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && items.length === 0 && (
        <div className="p-12 rounded-3xl border border-border bg-card text-center">
          <Bell className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No notifications yet</p>
          <p className="text-sm text-muted-foreground mt-1">You'll see workout reminders, friend activity, and streak alerts here.</p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((n, i) => (
          <motion.button
            key={n.id}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            onClick={() => { markRead(n.id); if (n.link) navigate(n.link); }}
            className={`w-full text-start p-4 rounded-2xl border border-border bg-card hover:border-electric-purple/40 transition ${!n.read ? "ring-1 ring-electric-purple/40" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{n.title}</p>
                {n.body && <p className="text-sm text-muted-foreground mt-1">{n.body}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
