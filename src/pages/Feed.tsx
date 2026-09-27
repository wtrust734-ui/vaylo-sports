import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Trophy, Activity, Target, Heart, Lock, Globe } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMyShareKeys,
  fetchSharedFeed,
  hypeActivity,
  unhypeActivity,
  shareKey,
  workoutShareInput,
  type ShareInput,
  type ShareKind,
} from "@/lib/activitySharing";
import ShareActivityButton from "@/components/feed/ShareActivityButton";

// ---------------------------------------------------------------------------
// The feed shows two things: YOUR OWN training, and activities other athletes
// explicitly chose to share.
//
// It used to aggregate `workouts`, `achievements` and `outcome_goals` across the
// friendship graph. All three are self-read-only under RLS, so it could only
// ever return the signed-in athlete's own rows — friends' training was never
// visible, and it never could be. Making it visible would have meant exposing
// private training and health data to everyone, so the friendship-based read is
// gone. Sharing is now per-activity and opt-in.
// ---------------------------------------------------------------------------

type FeedKind = ShareKind;

interface FeedItem {
  /** Unique within this render. */
  key: string;
  ts: string;
  kind: FeedKind;
  title: string;
  stats?: string | null;
  athlete: string;
  userId: string;
  visibility: "private" | "shared";
  /** Present for the athlete's own not-yet-shared items. */
  shareInput?: ShareInput;
  /** Present for items that are already published. */
  sharedId?: string;
  hypeCount: number;
  hypedByMe: boolean;
}

const ICON: Record<FeedKind, typeof Activity> = {
  workout: Activity,
  personal_best: Flame,
  achievement: Trophy,
  goal: Target,
  note: Globe,
};
const COLOR: Record<FeedKind, string> = {
  workout: "text-primary",
  personal_best: "text-energy",
  achievement: "text-electric-purple",
  goal: "text-success",
  note: "text-muted-foreground",
};

const WINDOW_DAYS = 14;

const Feed = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [sharedKeys, setSharedKeys] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

      // Own training (self-readable by RLS) + everyone's published shares.
      const [workouts, achievements, goals, shared, myKeys] = await Promise.all([
        supabase.from("workouts").select("id,title,type,duration_minutes,distance_km,created_at,completed")
          .eq("user_id", user.id).eq("completed", true).gte("created_at", since),
        supabase.from("achievements").select("id,title,type,earned_at")
          .eq("user_id", user.id).gte("earned_at", since),
        supabase.from("outcome_goals").select("id,title,updated_at")
          .eq("user_id", user.id).eq("status", "completed"),
        fetchSharedFeed({ limit: 60, userId: user.id }),
        fetchMyShareKeys(user.id),
      ]);

      setSharedKeys(myKeys);

      const own: FeedItem[] = [
        ...(workouts.data ?? []).map((w) => {
          const shareInput = workoutShareInput(w);
          return {
            key: `w-${w.id}`,
            ts: w.created_at,
            kind: "workout" as const,
            title: w.title,
            stats: shareInput.detail ?? null,
            athlete: "You",
            userId: user.id,
            visibility: "private" as const,
            shareInput,
            hypeCount: 0,
            hypedByMe: false,
          };
        }),
        ...(achievements.data ?? []).map((a) => ({
          key: `a-${a.id}`,
          ts: a.earned_at,
          kind: "achievement" as const,
          title: a.title,
          stats: a.type,
          athlete: "You",
          userId: user.id,
          visibility: "private" as const,
          shareInput: { kind: "achievement" as const, sourceId: a.id, title: a.title, detail: a.type },
          hypeCount: 0,
          hypedByMe: false,
        })),
        ...(goals.data ?? []).map((g) => ({
          key: `g-${g.id}`,
          ts: g.updated_at,
          kind: "goal" as const,
          title: g.title,
          stats: "Goal complete",
          athlete: "You",
          userId: user.id,
          visibility: "private" as const,
          shareInput: { kind: "goal" as const, sourceId: g.id, title: g.title, detail: "Goal complete" },
          hypeCount: 0,
          hypedByMe: false,
        })),
      ];

      const published: FeedItem[] = shared.map((s) => ({
        key: `s-${s.id}`,
        ts: s.shared_at,
        kind: s.source_kind as FeedKind,
        title: s.title,
        stats: s.detail,
        athlete: s.user_id === user.id ? "You" : s.athlete,
        userId: s.user_id,
        visibility: "shared" as const,
        sharedId: s.id,
        shareInput: { kind: s.source_kind as ShareKind, sourceId: s.source_id, title: s.title, detail: s.detail, sport: s.sport },
        hypeCount: s.hypeCount,
        hypedByMe: s.hypedByMe,
      }));

      // An item that is already published appears once, as a shared post.
      const alreadyShared = new Set(
        (shared ?? []).filter((s) => s.user_id === user.id).map((s) => shareKey(s.source_kind as ShareKind, s.source_id)),
      );
      const merged = [
        ...published,
        ...own.filter((o) => !o.shareInput || !alreadyShared.has(shareKey(o.shareInput.kind, o.shareInput.sourceId))),
      ].sort((a, b) => +new Date(b.ts) - +new Date(a.ts));

      setItems(merged);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  /**
   * Flips an item's published state in place, so sharing feels instant and
   * unsharing returns the card to private rather than making it vanish. The
   * athlete's activity still exists — only its visibility changed.
   */
  const setPublished = (key: string, shared: boolean) => {
    setItems(prev => prev.map(i => (i.key === key
      ? {
        ...i,
        visibility: shared ? "shared" as const : "private" as const,
        athlete: "You",
        // Hype only applies to published posts.
        hypeCount: shared ? i.hypeCount : 0,
        hypedByMe: shared ? i.hypedByMe : false,
      }
      : i)));
  };

  const toggleHype = async (item: FeedItem) => {
    if (!user || item.userId === user.id || !item.sharedId) return;
    const next = !item.hypedByMe;
    // Optimistic, then corrected if the write is refused.
    setItems(prev => prev.map(i => (i.key === item.key
      ? { ...i, hypedByMe: next, hypeCount: Math.max(0, i.hypeCount + (next ? 1 : -1)) }
      : i)));
    const { ok } = next
      ? await hypeActivity(item.sharedId, user.id)
      : await unhypeActivity(item.sharedId, user.id);
    if (!ok) {
      setItems(prev => prev.map(i => (i.key === item.key
        ? { ...i, hypedByMe: item.hypedByMe, hypeCount: item.hypeCount }
        : i)));
    }
  };

  const timeAgo = (iso: string) => {
    const diff = Math.floor((Date.now() - +new Date(iso)) / 60000);
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return `${Math.floor(diff / 1440)}d`;
  };

  const mine = items.filter(i => i.userId === user?.id);
  const communityShared = items.filter(i => i.userId !== user?.id);

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <p className="text-[11px] uppercase tracking-widest text-primary font-semibold">Activity</p>
        <h1 className="text-2xl font-display font-bold mt-1">Feed</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your training, plus what athletes choose to share.
        </p>
      </div>

      {loading ? (
        <p className="px-5 text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : (
        <div className="px-5 space-y-6">
          {/* --- what you chose to publish --- */}
          {communityShared.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
                <Globe size={11} /> Shared by athletes
              </h2>
              {communityShared.slice(0, limit).map((it, i) => {
                const Icon = ICON[it.kind];
                return (
                  <motion.div key={it.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
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
                        <div className={`flex items-center gap-1.5 text-xs ${COLOR[it.kind]}`}>
                          <Icon size={12} /> {it.kind.replace("_", " ").toUpperCase()}
                        </div>
                        <p className="text-sm mt-1">{it.title}</p>
                        {it.stats && <p className="text-xs text-muted-foreground mt-0.5">{it.stats}</p>}
                        <button onClick={() => toggleHype(it)}
                          className={`mt-2 inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1 transition-colors border ${
                            it.hypedByMe ? "bg-energy/15 border-energy/50 text-energy" : "bg-muted hover:bg-energy/10 border-border hover:border-energy/40"
                          }`}>
                          <Heart size={12} className={it.hypedByMe ? "text-energy fill-energy" : "text-energy"} />
                          {it.hypedByMe ? `Hyped · ${it.hypeCount}` : `Hype${it.hypeCount ? ` · ${it.hypeCount}` : ""}`}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </section>
          )}

          {/* --- your own training, shareable one item at a time --- */}
          <section className="space-y-3">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
              <Lock size={11} /> Your activity · private until you share
            </h2>
            {mine.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Nothing here yet. Log a workout and you can share it with one tap.
              </p>
            )}
            {mine.slice(0, limit).map((it, i) => {
              const Icon = ICON[it.kind];
              const isOwnShared = it.visibility === "shared";
              return (
                <motion.div key={it.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="bg-card border border-border rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold ${isOwnShared ? "text-primary" : "text-muted-foreground"}`}>
                          {isOwnShared ? "Shared" : "Private"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(it.ts)}</span>
                      </div>
                      <p className="text-sm mt-1">{it.title}</p>
                      {it.stats && <p className="text-xs text-muted-foreground mt-0.5">{it.stats}</p>}
                      {it.shareInput && (
                        <div className="mt-2">
                          <ShareActivityButton
                            input={it.shareInput}
                            shared={isOwnShared}
                            onToggle={(shared) => setPublished(it.key, shared)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </section>

          {limit < items.length && (
            <button onClick={() => setLimit(l => l + 20)} className="w-full py-3 text-sm text-primary font-semibold">
              Load more
            </button>
          )}

          {items.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              No activity yet. When athletes share a session, it lands here.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default Feed;
