import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Trophy, Users, Clock, Target, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { joinChallenge } from "@/lib/scoring";
import { stashPendingJoin } from "@/hooks/usePendingJoin";
import { fetchDisplayNames, UNKNOWN_ATHLETE } from "@/lib/publicIdentity";

type InviteChallenge = {
  title: string;
  description: string | null;
  sport: string;
  type: string;
  target_value: number | string | null;
  target_unit: string | null;
  end_date: string;
  participant_count: number | null;
  icon: string | null;
};

/**
 * Public challenge invite page (/c/:id) — the landing surface for shared
 * challenge links. Works logged-out (view + sign-up-to-join) and logged-in
 * (view + one-tap join). No app chrome: crawlers and first-time visitors see
 * a clean page, the CTA is the whole point.
 */
const ChallengeInvite = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, session } = useAuth();
  const [ch, setCh] = useState<InviteChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [ranks, setRanks] = useState<{ name: string; progress: number }[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("challenges")
        .select("title, description, sport, type, target_value, target_unit, end_date, participant_count, icon")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      setCh(data);

      const { data: parts } = await supabase
        .from("challenge_participants")
        .select("user_id, progress")
        .eq("challenge_id", id)
        .order("progress", { ascending: false })
        .limit(10);
      if (cancelled) return;
      const list = parts || [];
      const names = list.length ? await fetchDisplayNames(list.map((p) => p.user_id)) : {};
      if (cancelled) return;
      setRanks(list.map((p) => ({ name: names[p.user_id] ?? UNKNOWN_ATHLETE, progress: Number(p.progress) || 0 })));

      if (user) {
        const { data: mine } = await supabase
          .from("challenge_participants")
          .select("id")
          .eq("challenge_id", id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled && mine) setJoined(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  const handleJoin = async () => {
    if (!id) return;
    if (!session) {
      stashPendingJoin(id);
      nav("/auth");
      return;
    }
    setJoining(true);
    const res = await joinChallenge(id);
    setJoining(false);
    if (!res.error) {
      setJoined(true);
      setCh((c) => (c ? { ...c, participant_count: (c.participant_count ?? 0) + 1 } : c));
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }

  if (!ch) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Trophy className="text-muted-foreground" size={40} />
        <p className="text-lg font-semibold">Challenge not found</p>
        <p className="text-sm text-muted-foreground">This invite may have expired.</p>
        <a href="/auth" className="mt-2 rounded-xl bg-gradient-to-r from-electric-purple to-energy px-5 py-2.5 text-sm font-semibold text-white">
          Start training free →
        </a>
      </div>
    );
  }

  const unit = ch.target_unit ? ` ${ch.target_unit}` : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-12 pb-4 max-w-lg mx-auto">
        {session && (
          <button onClick={() => nav("/challenges")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} /> Open app
          </button>
        )}
        <div className="rounded-3xl border border-electric-purple/30 bg-gradient-to-br from-card via-card to-electric-purple/20 p-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-energy mb-2">Vaylo Sports Challenge</p>
          <h1 className="text-2xl font-display font-bold leading-tight">{ch.title}</h1>
          {ch.description && <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{ch.description}</p>}

          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            {ch.target_value != null && (
              <div className="rounded-xl bg-muted/50 border border-border p-2">
                <Target className="mx-auto text-muted-foreground" size={14} />
                <p className="mt-1 text-sm font-semibold">{Number(ch.target_value)}{unit}</p>
              </div>
            )}
            {ch.sport && (
              <div className="rounded-xl bg-muted/50 border border-border p-2 capitalize">
                <Zap className="mx-auto text-muted-foreground" size={14} />
                <p className="mt-1 text-sm font-semibold">{String(ch.sport).replace(/^\w/, (c) => c.toUpperCase())}</p>
              </div>
            )}
            <div className="rounded-xl bg-muted/50 border border-border p-2">
              <Users className="mx-auto text-muted-foreground" size={14} />
              <p className="mt-1 text-sm font-semibold">{ch.participant_count ?? 0} in</p>
            </div>
            {ch.end_date && (
              <div className="rounded-xl bg-muted/50 border border-border p-2">
                <Clock className="mx-auto text-muted-foreground" size={14} />
                <p className="mt-1 text-sm font-semibold">Ends {String(ch.end_date).slice(0, 10)}</p>
              </div>
            )}
          </div>

          <button
            onClick={handleJoin}
            disabled={joining || joined}
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-electric-purple to-energy py-3.5 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-70"
          >
            {joined ? "You're in ✓" : joining ? "Joining…" : session ? "Join challenge" : "Sign up & join — it's free"}
          </button>
          {!session && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Already have an account? <a href="/auth" className="text-energy underline">Sign in</a> — you'll join right after.
            </p>
          )}
        </div>

        {ranks.length > 0 && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Leaderboard</p>
            <ol className="space-y-2">
              {ranks.map((r, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-5 text-right font-semibold text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{r.name}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{r.progress}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!session && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            AI coaching, challenges and leaderboards for your sport. <a href="/auth" className="text-energy underline">Create a free account</a>.
          </p>
        )}
      </div>
    </div>
  );
};

export default ChallengeInvite;
