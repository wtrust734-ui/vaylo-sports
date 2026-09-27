import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { Bell } from "lucide-react";
import { toast } from "sonner";

const KEYS: { key: string; label: string; desc: string }[] = [
  { key: "workout_reminders", label: "Workout reminders", desc: "Daily nudges to keep you on plan." },
  { key: "friend_activity", label: "Friend activity", desc: "Likes, comments, friend PRs." },
  { key: "streak_alerts", label: "Streak alerts", desc: "Warnings before your streak breaks." },
  { key: "challenge_deadlines", label: "Challenge deadlines", desc: "Reminders for joined challenges." },
  { key: "reengagement", label: "We miss you", desc: "Occasional re-engagement after inactivity." },
];

export default function NotificationPrefs() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("notification_prefs").select("*").eq("user_id", user.id).maybeSingle();
      setPrefs(data || KEYS.reduce((a, k) => ({ ...a, [k.key]: true }), {}));
      setLoading(false);
    })();
  }, [user]);

  const toggle = async (key: string, value: boolean) => {
    if (!user) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    if (error) toast.error(error.message); else toast.success("Saved");
  };

  return (
    <div className="px-5 pt-8 pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Bell className="h-6 w-6 text-electric-purple" /> Notification settings</h1>
      <p className="text-sm text-muted-foreground mb-6">Choose what we ping you about. Smart send-times prevent late-night noise.</p>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2">
          {KEYS.map((k, i) => (
            <motion.div
              key={k.key}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-border bg-card"
            >
              <div>
                <p className="font-medium">{k.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{k.desc}</p>
              </div>
              <Switch checked={!!prefs[k.key]} onCheckedChange={(v) => toggle(k.key, v)} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
