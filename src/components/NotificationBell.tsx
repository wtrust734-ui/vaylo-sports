import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotifications } from "@/hooks/useNotifications";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { items, unread, markAllRead, markRead } = useNotifications();
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative h-9 w-9 rounded-full bg-muted/40 hover:bg-muted/60 flex items-center justify-center transition"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <motion.span
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-energy text-[10px] font-bold text-background flex items-center justify-center"
          >
            {unread > 9 ? "9+" : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto z-50 bg-card border border-border rounded-2xl shadow-2xl"
            >
              <div className="flex items-center justify-between p-3 border-b border-border sticky top-0 bg-card/95 backdrop-blur">
                <span className="font-semibold text-sm">Notifications</span>
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-electric-purple hover:underline flex items-center gap-1">
                    <Check className="h-3 w-3" /> Mark all read
                  </button>
                )}
              </div>
              {items.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">You're all caught up.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={async () => {
                          await markRead(n.id);
                          if (n.link) navigate(n.link);
                          setOpen(false);
                        }}
                        className={`w-full text-left p-3 hover:bg-muted/30 transition ${!n.read ? "bg-electric-purple/5" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          {!n.read && <span className="mt-1.5 h-2 w-2 rounded-full bg-electric-purple shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{n.title}</p>
                            {n.body && <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="p-2 border-t border-border sticky bottom-0 bg-card/95 backdrop-blur">
                <button
                  onClick={() => { setOpen(false); navigate("/profile/notifications"); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  Notification settings
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
