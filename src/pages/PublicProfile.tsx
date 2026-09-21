import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Flame, Activity, Target, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const PublicProfile = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<{ vpr: number; rank: number; streak: number; workouts: number; trophies: any[] }>({
    vpr: 0, rank: 0, streak: 0, workouts: 0, trophies: [],
  });

  useEffect(() => {
    if (!username) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("user_id", username).maybeSingle();
      setProfile(p);
      const [vpr, all, ws, ach] = await Promise.all([
        supabase.from("performance_metrics").select("value").eq("user_id", username).eq("metric_type", "vpr").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("performance_metrics").select("user_id,value").eq("metric_type", "vpr"),
        supabase.from("workouts").select("id").eq("user_id", username).eq("completed", true),
        supabase.from("achievements").select("*").eq("user_id", username).order("earned_at", { ascending: false }).limit(8),
      ]);
      const myV = Number(vpr.data?.value || 0);
      const allSorted = (all.data || []).map((x: any) => Number(x.value)).sort((a, b) => b - a);
      const rank = allSorted.indexOf(myV) + 1 || allSorted.length + 1;
      setStats({ vpr: myV, rank, streak: 0, workouts: (ws.data || []).length, trophies: ach.data || [] });
    })();
  }, [username]);

  if (!profile) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading profile…</div>;

  return (
    <div className="min-h-screen bg-background pb-24">
      <button onClick={() => navigate(-1)} className="absolute top-4 left-4 z-10 p-2 rounded-xl bg-card/80 border border-border"><ArrowLeft size={18} /></button>
      <div className="bg-gradient-card border-b border-primary/20 px-5 pt-16 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center text-3xl font-bold text-primary">
            {(profile.full_name || "A").charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">{profile.full_name || "Athlete"}</h1>
            <p className="text-sm text-muted-foreground">{profile.sport || "—"} {profile.country ? `· ${profile.country}` : ""}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] uppercase tracking-wider bg-primary/15 text-primary px-2 py-0.5 rounded-md font-bold">Global #{stats.rank}</span>
              {profile.sport && <span className="text-[10px] uppercase tracking-wider bg-energy/15 text-energy px-2 py-0.5 rounded-md font-bold">{profile.sport.split(",")[0]} ranked</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 mt-4 grid grid-cols-4 gap-2">
        <Stat icon={Activity} label="VPR" value={stats.vpr.toFixed(0)} />
        <Stat icon={Trophy} label="Trophies" value={stats.trophies.length} />
        <Stat icon={Flame} label="Streak" value={stats.streak} />
        <Stat icon={Target} label="Workouts" value={stats.workouts} />
      </div>

      <div className="px-5 mt-6">
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Recent achievements</h3>
        <div className="space-y-2">
          {stats.trophies.length === 0 && <p className="text-sm text-muted-foreground">No trophies yet.</p>}
          {stats.trophies.map((t: any) => (
            <motion.div key={t.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
              <div className="text-2xl">{t.icon || "🏆"}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(t.earned_at).toLocaleDateString()}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Stat = ({ icon: Icon, label, value }: any) => (
  <div className="bg-card border border-border rounded-xl p-3 text-center">
    <Icon size={14} className="mx-auto text-primary" />
    <p className="text-lg font-display font-bold mt-1">{value}</p>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
  </div>
);

export default PublicProfile;
