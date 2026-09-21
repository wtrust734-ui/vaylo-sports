import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Play, Square, Clock, MapPin, Plus, Navigation, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables } from "@/integrations/supabase/types";
import RPEModal from "@/components/RPEModal";
import { triggerMilestone } from "@/components/MilestoneCelebration";

type Workout = Tables<"workouts">;

const workoutTypes = [
  { value: "run", label: "Run", icon: "🏃" },
  { value: "gym", label: "Gym", icon: "🏋️" },
  { value: "cycle", label: "Cycle", icon: "🚴" },
  { value: "swim", label: "Swim", icon: "🏊" },
  { value: "hiit", label: "HIIT", icon: "⚡" },
  { value: "sport", label: "Sport", icon: "⚽" },
];

const Workouts = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [type, setType] = useState("run");
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState("");
  const [gpsTracking, setGpsTracking] = useState(false);
  const [gpsDistance, setGpsDistance] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const historyRef = useRef(null);
  const historyInView = useInView(historyRef, { once: true, margin: "-30px" });

  const [rpePending, setRpePending] = useState<{ id: string; type: string; duration: number } | null>(null);
  const DEFAULT_AR = ["pace", "heart_rate", "distance", "duration", "cadence", "power"];
  const [arMetrics, setArMetrics] = useState<string[]>(DEFAULT_AR);
  const [arOverlayName, setArOverlayName] = useState<string>("Live Overlay");
  const [liveHR, setLiveHR] = useState<number>(0);

  useEffect(() => { if (user) { fetchWorkouts(); fetchArSettings(); } }, [user]);

  const fetchArSettings = async () => {
    if (!user) return;
    const { data } = await supabase.from("user_settings").select("ar_metrics, ar_overlay_name" as any).eq("user_id", user.id).maybeSingle();
    if (data) {
      const d = data as any;
      if (Array.isArray(d.ar_metrics) && d.ar_metrics.length > 0) setArMetrics(d.ar_metrics);
      if (d.ar_overlay_name) setArOverlayName(d.ar_overlay_name);
    }
  };
  useEffect(() => {
    if (!activeWorkout) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [activeWorkout]);

  // Simulated live heart-rate while workout active (real value comes from wearable bridge)
  useEffect(() => {
    if (!activeWorkout) { setLiveHR(0); return; }
    const base = 130;
    const iv = setInterval(() => setLiveHR(base + Math.round(Math.sin(Date.now() / 5000) * 15 + Math.random() * 10)), 1500);
    return () => clearInterval(iv);
  }, [activeWorkout]);

  // GPS tracking
  useEffect(() => {
    if (!gpsTracking || !activeWorkout) return;
    if (!navigator.geolocation) { toast({ title: "GPS not available" }); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (lastPosRef.current) {
          const d = haversine(lastPosRef.current.lat, lastPosRef.current.lng, latitude, longitude);
          if (d > 0.005) { setGpsDistance(prev => prev + d); lastPosRef.current = { lat: latitude, lng: longitude }; }
        } else {
          lastPosRef.current = { lat: latitude, lng: longitude };
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    watchIdRef.current = id;
    return () => { if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [gpsTracking, activeWorkout]);

  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const fetchWorkouts = async () => {
    if (!user) return;
    const { data } = await supabase.from("workouts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
    setWorkouts(data || []);
  };

  const startWorkout = async () => {
    if (!user) return;
    const typeLabel = workoutTypes.find(w => w.value === type)?.label || type;
    const { data, error } = await supabase.from("workouts").insert({
      user_id: user.id, title: `${typeLabel} Workout`, type, started_at: new Date().toISOString()
    }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setActiveWorkout(data); setElapsed(0); setShowNew(false); setGpsDistance(0); lastPosRef.current = null;
    toast({ title: "Workout started", description: "Live overlay is now visible on this screen." });
  };

  const stopWorkout = async () => {
    if (!activeWorkout || !user) return;
    const durationMin = Math.round(elapsed / 60);
    const finalDist = gpsTracking && gpsDistance > 0 ? gpsDistance : (distance ? parseFloat(distance) : null);
    const { error } = await supabase.from("workouts").update({
      completed: true, completed_at: new Date().toISOString(), duration_minutes: durationMin,
      distance_km: finalDist ? parseFloat(finalDist.toFixed(2)) : null,
    }).eq("id", activeWorkout.id);
    if (!error) {
      toast({ title: "Workout Complete! 💪", description: `${durationMin} min logged.` });
      setRpePending({ id: activeWorkout.id, type: activeWorkout.type || "", duration: durationMin });
      const wid = activeWorkout.id;
      setActiveWorkout(null); setElapsed(0); setDistance(""); setGpsTracking(false); setGpsDistance(0);
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      lastPosRef.current = null;
      fetchWorkouts();
      // Milestones
      const { count } = await supabase.from("workouts").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("completed", true);
      if (count === 1) triggerMilestone("first_workout");
      else if (count === 50) triggerMilestone("workouts_50");
    }
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
    return `${h > 0 ? h + ":" : ""}${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Workouts</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Track every session.</motion.p>
      </div>

      {activeWorkout && (
        <motion.div initial={{ opacity: 0, y: 15, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="mx-5 mb-5 bg-gradient-card border border-primary/30 rounded-2xl p-5 shadow-card">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Active</span>
          </div>
          <h3 className="font-display font-bold text-lg">{activeWorkout.title}</h3>
          <motion.div className="text-4xl font-display font-bold text-primary mt-4 text-center"
            animate={{ scale: [1, 1.02, 1] }} transition={{ duration: 1, repeat: Infinity }}>
            {formatTime(elapsed)}
          </motion.div>
          {gpsTracking && gpsDistance > 0 && (
            <p className="text-center text-sm text-muted-foreground mt-2">
              <Navigation size={12} className="inline mr-1" />{gpsDistance.toFixed(2)} km (GPS)
            </p>
          )}

          {arMetrics.length > 0 && (
            <div className="mt-4 p-3 rounded-xl border border-primary/30 bg-background/40">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-widest text-primary font-semibold flex items-center gap-1"><Eye size={11} /> Overlay {arOverlayName ? `· ${arOverlayName}` : ""}</span>
                <button onClick={() => navigate(`/ar-overlay?workout=${activeWorkout.id}&type=${activeWorkout.type || "run"}`)}
                  className="text-[10px] text-primary underline">Fullscreen</button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {arMetrics.slice(0, 6).map((m) => {
                  const val = m === "pace" ? (gpsDistance > 0 && elapsed > 0 ? `${(elapsed / 60 / gpsDistance).toFixed(2)}` : "—")
                    : m === "heart_rate" ? (liveHR ? `${liveHR}` : "—")
                    : m === "distance" ? `${gpsDistance.toFixed(2)}`
                    : m === "duration" ? formatTime(elapsed)
                    : m === "cadence" ? "172"
                    : m === "power" ? "245"
                    : "—";
                  const unit = m === "pace" ? "min/km" : m === "heart_rate" ? "bpm" : m === "distance" ? "km" : m === "cadence" ? "spm" : m === "power" ? "W" : "";
                  return (
                    <div key={m} className="bg-card/60 rounded-lg py-2 border border-border">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{m.replace("_", " ")}</div>
                      <div className="font-display font-bold text-sm text-primary">{val}</div>
                      <div className="text-[9px] text-muted-foreground">{unit}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!gpsTracking && (
            <div className="mt-4">
              <label className="text-xs text-muted-foreground mb-1 block">Distance (km)</label>
              <input type="number" step="0.01" placeholder="0.00" value={distance} onChange={(e) => setDistance(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-300" />
            </div>
          )}
          <motion.button onClick={stopWorkout} whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2 bg-destructive text-destructive-foreground font-semibold py-3 rounded-xl mt-4">
            <Square size={18} /> Stop & Save
          </motion.button>
        </motion.div>
      )}

      {!activeWorkout && (
        <div className="px-5 mb-5">
          {!showNew ? (
            <motion.button onClick={() => setShowNew(true)} whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }}
              className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
              <Plus size={18} /> Start Workout
            </motion.button>
          ) : (
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              className="bg-gradient-card border border-border rounded-2xl p-4 shadow-card space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {workoutTypes.map((w) => (
                  <motion.button key={w.value} onClick={() => setType(w.value)} whileTap={{ scale: 0.93 }}
                    className={`p-2 rounded-xl text-center border text-xs font-medium transition-all duration-200 ${type === w.value ? "bg-primary/15 border-primary text-primary shadow-glow" : "bg-card border-border text-foreground hover:border-primary/30"}`}>
                    <span className="text-lg block">{w.icon}</span>{w.label}
                  </motion.button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={gpsTracking} onChange={e => setGpsTracking(e.target.checked)} className="accent-primary" />
                <Navigation size={14} /> Track with GPS
              </label>
              <div className="flex gap-2">
                <button onClick={() => setShowNew(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                <motion.button onClick={startWorkout} whileTap={{ scale: 0.98 }}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow">
                  <Play size={16} /> Start
                </motion.button>
              </div>
            </motion.div>
          )}
        </div>
      )}

      <div ref={historyRef} className="px-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Recent Workouts</h3>
        <div className="space-y-3 mb-8">
          {workouts.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No workouts yet. Start your first one!</p>}
          {workouts.map((w, i) => (
            <motion.div key={w.id} initial={{ opacity: 0, x: -15 }} animate={historyInView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.06, duration: 0.4 }}
              whileHover={{ x: 4, transition: { duration: 0.2 } }}
              className="bg-card border border-border rounded-xl p-4 hover:border-primary/20 transition-colors duration-300">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">{w.title}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    {w.duration_minutes && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock size={12} /> {w.duration_minutes} min</span>}
                    {w.distance_km && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} /> {Number(w.distance_km)} km</span>}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleDateString()}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <RPEModal open={!!rpePending} workoutId={rpePending?.id} type={rpePending?.type} duration={rpePending?.duration}
        onClose={() => setRpePending(null)} />
    </div>
  );
};

export default Workouts;
