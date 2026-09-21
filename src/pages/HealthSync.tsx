import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { HeartPulse, Loader2, RefreshCw, Smartphone, Activity, Check, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type SourceKey = "google_fit";

const SOURCES: { key: SourceKey; label: string; icon: any; desc: string }[] = [
  { key: "google_fit", label: "Google Fit", icon: Activity, desc: "Workouts, steps and heart rate from Google Fit / Health Connect. The only connected sync Vaylo supports." },
];

const HealthSync = () => {
  const { user } = useAuth();
  const [connections, setConnections] = useState<Record<SourceKey, boolean>>({} as any);
  const [syncing, setSyncing] = useState<SourceKey | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [manual, setManual] = useState({ type: "run", duration: "", distance: "", calories: "" });

  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem(`vaylo:health:${user.id}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Migrate old multi-source flags down to google_fit only
        if (parsed.google_fit != null) setConnections({ google_fit: !!parsed.google_fit } as any);
        else if (parsed.google_health_connect != null) setConnections({ google_fit: !!parsed.google_health_connect } as any);
      } catch {}
    }
    const last = localStorage.getItem(`vaylo:health:lastsync:${user.id}`);
    if (last) setLastSync(last);
  }, [user]);

  const toggle = (key: SourceKey) => {
    if (!user) return;
    const next = { ...connections, [key]: !connections[key] };
    setConnections(next);
    localStorage.setItem(`vaylo:health:${user.id}`, JSON.stringify(next));
    toast.success(next[key] ? `Linked ${SOURCES.find((s) => s.key === key)?.label}` : "Unlinked");
  };

  const sync = async (key: SourceKey) => {
    if (!user) return;
    setSyncing(key);
    try {
      const bridge = (window as any).VayloHealth;
      let pushed: any[] = [];
      if (bridge?.fetchWorkouts) {
        pushed = await bridge.fetchWorkouts(key);
      }
      if (pushed.length) {
        const rows = pushed.map((w: any) => ({
          user_id: user.id,
          title: w.title || `Google Fit ${w.type || "workout"}`,
          type: w.type || "sport",
          started_at: w.startedAt,
          completed_at: w.endedAt,
          duration_minutes: Math.round((w.durationSeconds || 0) / 60),
          distance_km: w.distanceKm ?? null,
          calories_burned: w.calories ?? null,
          heart_rate_avg: w.avgHr ?? null,
          completed: true,
          notes: "Imported from Google Fit",
        }));
        const { error } = await supabase.from("workouts").insert(rows);
        if (error) throw error;
        toast.success(`${rows.length} workouts imported from Google Fit.`);
      } else {
        toast(`No new Google Fit workouts. (Native bridge required for live sync.)`);
      }
      const ts = new Date().toISOString();
      setLastSync(ts);
      localStorage.setItem(`vaylo:health:lastsync:${user.id}`, ts);
    } catch (e: any) {
      toast.error(e?.message || "Sync failed.");
    } finally {
      setSyncing(null);
    }
  };

  const submitManual = async () => {
    if (!user) return;
    const dur = Number(manual.duration);
    if (!dur) return toast.error("Duration required");
    const { error } = await supabase.from("workouts").insert({
      user_id: user.id,
      title: `${manual.type} (manual import)`,
      type: manual.type,
      started_at: new Date(Date.now() - dur * 60_000).toISOString(),
      completed_at: new Date().toISOString(),
      duration_minutes: dur,
      distance_km: manual.distance ? Number(manual.distance) : null,
      calories_burned: manual.calories ? Number(manual.calories) : null,
      completed: true,
      notes: "Manual import",
    });
    if (error) return toast.error(error.message);
    toast.success("Workout imported.");
    setManual({ type: "run", duration: "", distance: "", calories: "" });
  };

  return (
    <div className="min-h-screen pb-32 max-w-3xl mx-auto px-5 pt-16">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><HeartPulse size={14} /> Health Sync</div>
        <h1 className="text-3xl font-display font-black mt-1">Connect <span className="text-gradient-electric\">Google Fit</span></h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vaylo syncs workouts, steps and heart rate from <span className="font-semibold text-foreground">Google Fit</span> (via Health Connect). Wearable sync is not supported directly — connect your watch or tracker to Google Fit and Vaylo will import from there.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
          <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            <span className="font-bold text-amber-200">Google Fit only.</span> Apple Health, Garmin, WHOOP, Fitbit and other direct wearable integrations are not supported. If your device can push to Google Fit, its workouts will appear here after a sync.
          </p>
        </div>
        {lastSync && <p className="text-[10px] text-muted-foreground mt-2">Last sync: {new Date(lastSync).toLocaleString()}</p>}
      </motion.div>

      <div className="mt-5 grid gap-3">
        {SOURCES.map((s) => {
          const Icon = s.icon;
          const linked = !!connections[s.key];
          return (
            <motion.div key={s.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card/70 border border-border rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{s.label}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{s.desc}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button size="sm" variant={linked ? "outline" : "default"} onClick={() => toggle(s.key)}
                  className={linked ? "" : "bg-gradient-electric"}>
                  {linked ? <><Check size={12} /> Linked</> : "Connect"}
                </Button>
                {linked && (
                  <button onClick={() => sync(s.key)} disabled={syncing === s.key}
                    className="text-[10px] uppercase tracking-wider text-primary font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    {syncing === s.key ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Sync now
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-6 bg-card/60 border border-electric-purple/30 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2"><Smartphone size={14} className="text-electric-purple" />
          <h3 className="text-sm font-bold">How it works</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">
          In the Vaylo Android app, Google Fit / Health Connect access runs via the native bridge and pushes workouts automatically. On the web preview you can manually import a session below — useful for testing your dashboard and training plan.\n        </p>
      </div>

      <div className="mt-5 bg-card/70 border border-border rounded-2xl p-4 space-y-2">
        <h3 className="text-sm font-bold">Manual workout import</h3>
        <div className="grid grid-cols-2 gap-2">
          <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-sm">
            {["run","cycle","swim","gym","hiit","sport","yoga","row"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Input placeholder="Duration (min)" type="number" value={manual.duration} onChange={(e) => setManual({ ...manual, duration: e.target.value })} />
          <Input placeholder="Distance (km)" type="number" step="0.01" value={manual.distance} onChange={(e) => setManual({ ...manual, distance: e.target.value })} />
          <Input placeholder="Calories" type="number" value={manual.calories} onChange={(e) => setManual({ ...manual, calories: e.target.value })} />
        </div>
        <Button onClick={submitManual} className="w-full bg-gradient-primary">Import</Button>
      </div>
    </div>
  );
};

export default HealthSync;
