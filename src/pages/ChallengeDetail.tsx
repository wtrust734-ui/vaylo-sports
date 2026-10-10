import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Trophy, Users, Clock, Target, Flag, Plus, Share2 } from "lucide-react";
import { shareWithInvite } from "@/lib/share";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { joinChallenge, leaveChallenge, updateChallengeProgress } from "@/lib/scoring";
import { fetchDisplayNames, UNKNOWN_ATHLETE } from "@/lib/publicIdentity";
import { toast } from "sonner";
import { readFailed } from "@/lib/dbRead";
import type { Tables } from "@/integrations/supabase/types";

type ChallengeRow = Tables<"challenges">;
type ParticipantRow = { user_id: string; progress: number | null; status: string | null; completed_at: string | null; joined_at: string | null };
type RankedParticipant = ParticipantRow & { name: string; rank: number };

const ChallengeDetail = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [ch, setCh] = useState<ChallengeRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<ParticipantRow | null>(null);
  const [ranks, setRanks] = useState<RankedParticipant[]>([]);
  const [delta, setDelta] = useState("1");

  const load = async () => {
    if (!id) return;
    setLoadError(null);
    const { data: c, error } = await supabase.from("challenges").select("*").eq("id", id).maybeSingle();
    if (error) { setLoadError(error.message); return; }
    // null data with no error = deleted, hidden, or closed — render that as a
    // real "not found" state instead of an eternal spinner.
    setCh(c);
    const { data: parts, error: partsError } = await supabase.from("challenge_participants").select("user_id,progress,status,completed_at,joined_at").eq("challenge_id", id).order("progress", { ascending: false });
    // The ranking IS this page, and an empty one has to mean "nobody has logged
    // anything" rather than "we could not read it". Same error state as the
    // challenge row failing, whose Try again re-runs the load.
    if (readFailed(partsError, "the participant list")) {
      setLoadError("We couldn't load the participant list.");
      return;
    }
    const list = parts || [];
    const ids = list.map((p) => p.user_id);
    // Names come from `avatars` (the publicly-readable identity table). Reading
    // `profiles.full_name` here returned nothing, because profiles is self-read-only
    // under RLS — so every competitor in the ranking list showed as "Athlete".
    const names = ids.length ? await fetchDisplayNames(ids) : {};
    setRanks(list.map((p, i) => ({ ...p, name: names[p.user_id] ?? UNKNOWN_ATHLETE, rank: i + 1 })));
    if (user) setMine(list.find((p) => p.user_id === user.id) || null);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id, user?.id]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-background p-5 pt-[var(--vaylo-screen-top)]">
        <button onClick={() => nav(-1)} className="flex items-center gap-1 text-xs text-muted-foreground mb-3"><ArrowLeft size={14}/> Back</button>
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-center">
          <p className="text-sm text-destructive mb-2">Couldn't load this challenge.</p>
          <button onClick={load} className="text-xs font-semibold text-primary underline">Try again</button>
        </div>
      </div>
    );
  }
  if (!ch) {
    return (
      <div className="min-h-screen bg-background p-5 pt-[var(--vaylo-screen-top)] text-center">
        <Trophy className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
        <p className="text-sm text-muted-foreground mb-1">Challenge not found.</p>
        <p className="text-xs text-muted-foreground mb-4">It may have been removed, or is no longer visible to you.</p>
        <button onClick={() => nav("/challenges")} className="text-sm font-semibold text-primary underline">Browse challenges</button>
      </div>
    );
  }

  const pct = Math.min(100, Math.round(((mine?.progress || 0) / Number(ch.target_value || 1)) * 100));
  const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date).getTime() - Date.now()) / 86400000));

  const handleLog = async () => {
    if (busy) return;
    const n = Number(delta);
    if (!n || n <= 0) return toast.error("Enter a positive value");
    if (!Number.isInteger(n)) return toast.error("Enter a whole number");
    setBusy(true);
    const { data, error } = await updateChallengeProgress(ch.id, n);
    setBusy(false);
    if (error) return toast.error(error.message);
    const result = (data ?? {}) as {
      completed?: boolean | null;
      reward_points?: number | string | null;
      progress?: number | null;
      clamped?: boolean;
    };
    // The server clamps a single entry to the challenge target, so saying
    // "Logged 9999 km" when it recorded 100 would be a lie the athlete cannot
    // see through. Say what was recorded instead.
    if (result.completed) toast.success(`Challenge complete! +${result.reward_points} pts`);
    else if (result.clamped) toast.success(`Logged ${result.progress} ${ch.target_unit} (the most this challenge can count)`);
    else toast.success(`Logged ${n} ${ch.target_unit}`);
    setDelta("1");
    load();
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <button onClick={() => nav(-1)} className="flex items-center gap-1 text-xs text-muted-foreground mb-3"><ArrowLeft size={14}/> Back</button>
        <div className="flex items-start gap-3">
          <div className="text-3xl">{ch.icon || "🏆"}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] uppercase tracking-widest text-energy font-semibold">{ch.scope} · {ch.type}</p>
            <h1 className="text-xl font-display font-bold mt-0.5">{ch.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{ch.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 text-center text-[12px]">
          <div className="bg-card border border-border rounded-xl p-2"><Clock className="w-3 h-3 mx-auto text-muted-foreground"/><p className="font-semibold mt-1">{daysLeft}d left</p></div>
          <div className="bg-card border border-border rounded-xl p-2"><Users className="w-3 h-3 mx-auto text-muted-foreground"/><p className="font-semibold mt-1">{ch.participant_count} joined</p></div>
          <div className="bg-card border border-border rounded-xl p-2"><Trophy className="w-3 h-3 mx-auto text-energy"/><p className="font-semibold mt-1">+{ch.reward_points} pts</p></div>
        </div>

        {/* Viral loop: a shared challenge link lands on the public invite page,
            where the friend sees this head-to-head and a signup CTA. */}
        <button
          onClick={() => {
            void shareWithInvite({
              title: ch.title || "Vaylo Sports challenge",
              text: `I'm in "${ch.title}" on Vaylo Sports — think you can beat me?`,
            });
          }}
          className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-energy/40 bg-energy/10 py-2.5 text-sm font-semibold text-energy"
        >
          <Share2 size={14} /> Challenge a friend
        </button>

        <div className="mt-4 bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold flex items-center gap-1"><Target size={12}/> Your progress</p>
            <p className="text-xs text-muted-foreground">{(mine?.progress || 0).toFixed(1)} / {ch.target_value} {ch.target_unit}</p>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-energy" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-4 gap-1 mt-2 text-[12px] text-muted-foreground">
            {[25,50,75,100].map(m => (
              <div key={m} className={`text-center ${pct >= m ? "text-primary font-bold" : ""}`}>◆ {m}%</div>
            ))}
          </div>

          {mine ? (
            mine.status === "completed" ? (
              <p className="mt-3 text-xs text-primary font-semibold flex items-center gap-1"><Flag size={12}/> Completed!</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-3">
                <input value={delta} onChange={e => setDelta(e.target.value)} type="number" min={1}
                  aria-label={`Progress in ${ch.target_unit}`}
                  className="min-w-0 flex-1 basis-28 bg-muted rounded-lg px-3 py-2 text-sm" placeholder={`+ ${ch.target_unit}`} />
                <button onClick={handleLog} disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1 disabled:opacity-40"><Plus size={14}/> Log</button>
                <button onClick={async () => { if (busy) return; setBusy(true); await leaveChallenge(ch.id); setBusy(false); toast.success("Left"); load(); }} disabled={busy} className="px-3 py-2 rounded-lg border border-border text-xs disabled:opacity-40">Leave</button>
              </div>
            )
          ) : (
            <button onClick={async () => { if (busy) return; setBusy(true); const { error } = await joinChallenge(ch.id); setBusy(false); if (error) return toast.error(error.message); toast.success("Joined"); load(); }}
              disabled={busy} className="mt-3 w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40">Join challenge</button>
          )}
        </div>

        <h2 className="text-sm font-display font-bold mt-6 mb-2">Rankings</h2>
        <div className="space-y-1.5">
          {ranks.slice(0, 50).map(r => (
            <div key={r.user_id} className={`flex items-center gap-3 p-2.5 rounded-xl border ${r.user_id === user?.id ? "bg-primary/10 border-primary" : "bg-card border-border"}`}>
              <div className={`w-7 text-center text-sm font-bold ${r.rank <= 3 ? "text-energy" : "text-muted-foreground"}`}>
                {r.rank <= 3 ? ["🥇","🥈","🥉"][r.rank-1] : `#${r.rank}`}
              </div>
              <p className="flex-1 text-sm truncate">{r.name}</p>
              <p className="text-sm font-bold">{Number(r.progress).toFixed(1)}</p>
              <p className="text-[12px] uppercase text-muted-foreground">{ch.target_unit}</p>
            </div>
          ))}
          {ranks.length === 0 && <p className="text-xs text-muted-foreground">Be the first to join.</p>}
        </div>
      </div>
    </div>
  );
};

export default ChallengeDetail;
