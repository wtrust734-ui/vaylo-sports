import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Trophy, Activity, Target, Heart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { lsGet, lsSet } from "@/lib/localStore";

interface FeedItem {
  id: string;
  user_id: string;
  athlete: string;
  type: "workout" | "pr" | "achievement" | "goal";
  title: string;
  stats?: string;
  ts: string;
}

const ICON = { workout: Activity, pr: Flame, achievement: Trophy, goal: Target };
const COLOR = { workout: "text-primary", pr: "text-energy", achievement: "text-electric-purple", goal: "text-success" };

const HYPE_KEY = "vaylo_feed_hype_v2";

const Feed = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [limit, setLimit] = useState(20);
  const [hype, setHype] = useState<Record<string, { count: number; users: string[] }>>(lsGet(HYPE_KEY, {}));

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: friends } = await supabase.from("friendships").select("user_id, friend_id").or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
      const ids = Array.from(new Set([user.id, ...(friends || []).flatMap(f => [f.user_id, f.friend_id])]));
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const [w, a, g] = await Promise.all([
        supabase.from("workouts").select("id,user_id,title,type,duration_minutes,distance_km,created_at,completed").in("user_id", ids).eq("completed", true).gte("created_at", since),
        supabase.from("achievements").select("id,user_id,title,earned_at,type").in("user_id", ids).gte("earned_at", since),
        supabase.from("outcome_goals").select("id,user_id,title,status,updated_at").in("user_id", ids).eq("status", "completed"),
      ]);
      const { data: profiles } = await supabase.from("profiles").select("user_id,full_name").in("user_id", ids);
      const nameOf = (id: string) => profiles?.find(p => p.user_id === id)?.full_name || "Athlete";
      const merged: FeedItem[] = [
        ...(w.data || []).map((x: any) => ({
          id: `w-${x.id}`, user_id: x.user_id, athlete: nameOf(x.user_id), type: "workout" as const,
          title: x.title, stats: `${x.duration_minutes || 0} min${x.distance_km ? ` · ${x.distance_km} km` : ""}`, ts: x.created_at,
        })),
        ...(a.data || []).map((x: any) => ({
          id: `a-${x.id}`, user_id: x.user_id, athlete: nameOf(x.user_id), type: "achievement" as const,
          title: x.title, stats: x.type, ts: x.earned_at,
        })),
        ...(g.data || []).map((x: any) => ({
          id: `g-${x.id}`, user_id: x.user_id, athlete: nameOf(x.user_id), type: "goal" as const,
          title: x.title, stats: "Goal complete", ts: x.updated_at,
        })),
      ].sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
      setItems(merged);
    })();
  }, [user]);

  const giveHype = (id: string, ownerId: string) => {
    if (!user || user.id === ownerId) return;
    const existing = hype[id] || { count: 0, users: [] };
    if (existing.users.includes(user.id)) return;
    const next = { ...hype, [id]: { count: existing.count + 1, users: [...existing.users, user.id] } };
    setHype(next); lsSet(HYPE_KEY, next);
  };

  const timeAgo = (iso: string) => {
    const diff = Math.floor((Date.now() - +new Date(iso)) / 60000);
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return `${Math.floor(diff / 1440)}d`;
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <p className="text-[11px] uppercase tracking-widest text-primary font-semibold">Live</p>
        <h1 className="text-2xl font-display font-bold mt-1">Activity Feed</h1>
        <p className="text-sm text-muted-foreground mt-1">Friends, teammates, real-time pushes.</p>
      </div>

      <div className="px-5 space-y-3">
        {items.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No activity yet. Add friends to see their grind.</p>}
        {items.slice(0, limit).map((it, i) => {
          const Icon = ICON[it.type];
          return (
            <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">
                  {it.athlete.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{it.athlete}</p>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(it.ts)}</span>
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs ${COLOR[it.type]}`}>
                    <Icon size={12} /> {it.type.toUpperCase()}
                  </div>
                  <p className="text-sm mt-1">{it.title}</p>
                  {it.stats && <p className="text-xs text-muted-foreground mt-0.5">{it.stats}</p>}
                  {(() => {
                    const h = hype[it.id];
                    const own = user?.id === it.user_id;
                    const already = !!(user && h?.users.includes(user.id));
                    const disabled = own || already;
                    return (
                      <button onClick={() => giveHype(it.id, it.user_id)} disabled={disabled}
                        title={own ? "You can't hype your own activity" : already ? "You already hyped this" : "Send hype"}
                        className={`mt-2 inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1 transition-colors border ${
                          disabled ? "bg-muted/40 border-border text-muted-foreground cursor-not-allowed" :
                          "bg-muted hover:bg-energy/10 border-border hover:border-energy/40"
                        }`}>
                        <Heart size={12} className={already ? "text-energy fill-energy" : "text-energy"} />
                        {own ? "Your post" : already ? `Hyped · ${h?.count || 1}` : `Hype${h?.count ? ` · ${h.count}` : ""}`}
                      </button>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          );
        })}
        {limit < items.length && (
          <button onClick={() => setLimit(l => l + 20)} className="w-full py-3 text-sm text-primary font-semibold">Load more</button>
        )}
      </div>
    </div>
  );
};

export default Feed;
