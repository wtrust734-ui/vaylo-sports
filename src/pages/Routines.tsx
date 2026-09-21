import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Plus, Trash2, Check, Clock, MapPin, X, Edit3 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lsGet, lsSet } from "@/lib/localStore";

interface Step { name: string; seconds: number; cue?: string }
interface Routine {
  id: string;
  name: string;
  type: "warmup" | "cooldown" | "custom";
  sport: string;
  steps: Step[];
  custom?: boolean;
  gps_enabled?: boolean;
}

const TEMPLATES: Record<string, Routine[]> = {
  default: [
    { id: "wu-default", name: "General Warmup", type: "warmup", sport: "any", steps: [
      { name: "Joint mobility", seconds: 120, cue: "Slow, controlled circles" },
      { name: "Dynamic stretch", seconds: 180, cue: "Leg swings, hip openers" },
      { name: "Light cardio", seconds: 180, cue: "Easy jog or skip" },
      { name: "Sport-specific bursts", seconds: 120, cue: "Build to 80%" },
    ]},
    { id: "cd-default", name: "Cooldown Reset", type: "cooldown", sport: "any", steps: [
      { name: "Easy walk", seconds: 180 },
      { name: "Static stretch", seconds: 240, cue: "Hold each pose 30s" },
      { name: "Box breathing", seconds: 120, cue: "4-4-4-4" },
    ]},
  ],
  football: [
    { id: "wu-fb", name: "Football Pre-Match", type: "warmup", sport: "football", steps: [
      { name: "Activation", seconds: 180 }, { name: "Passing triangles", seconds: 240 },
      { name: "Sprints 6×30m", seconds: 240 }, { name: "Set-piece walkthrough", seconds: 120 },
    ]},
  ],
  basketball: [
    { id: "wu-bb", name: "Basketball Pre-Game", type: "warmup", sport: "basketball", steps: [
      { name: "Dynamic warmup", seconds: 240 }, { name: "Form shooting", seconds: 240 },
      { name: "5-spot shooting", seconds: 180 }, { name: "Defensive slides", seconds: 120 },
    ]},
  ],
  running: [
    { id: "wu-rn", name: "Runner's Warmup", type: "warmup", sport: "running", steps: [
      { name: "Brisk walk", seconds: 120 }, { name: "Drills (A/B skips)", seconds: 240 },
      { name: "Strides 4×80m", seconds: 240 },
    ]},
  ],
};

const KEY = "vaylo_routines_custom_v1";
const HIST = "vaylo_routine_history_v1";

// Haversine distance in meters
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const Routines = () => {
  const { profile } = useAuth();
  const sport = (profile?.sport || "").toLowerCase();
  const pack = Object.entries(TEMPLATES).find(([k]) => sport.includes(k))?.[1] || [];
  const [custom, setCustom] = useState<Routine[]>(lsGet(KEY, []));
  const all = useMemo(() => [...pack, ...TEMPLATES.default, ...custom], [pack, custom]);

  const [active, setActive] = useState<Routine | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<any>();

  // Builder state
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);

  // GPS state
  const [gpsDistance, setGpsDistance] = useState(0);
  const [gpsPoints, setGpsPoints] = useState(0);
  const gpsWatchId = useRef<number | null>(null);
  const lastPos = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!running) return;
    timer.current = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer.current);
  }, [running]);

  useEffect(() => {
    if (!active) return;
    if (elapsed >= active.steps[stepIdx].seconds) {
      if (stepIdx + 1 >= active.steps.length) {
        const hist = lsGet<any[]>(HIST, []);
        lsSet(HIST, [{
          id: active.id, name: active.name, completed: new Date().toISOString(),
          distance_m: active.gps_enabled ? Math.round(gpsDistance) : undefined,
        }, ...hist].slice(0, 60));
        stopGps();
        setRunning(false); setActive(null); setStepIdx(0); setElapsed(0);
        setGpsDistance(0); setGpsPoints(0);
      } else { setStepIdx(i => i + 1); setElapsed(0); }
    }
  }, [elapsed, active, stepIdx, gpsDistance]);

  const startGps = () => {
    if (!("geolocation" in navigator)) return;
    lastPos.current = null;
    setGpsDistance(0); setGpsPoints(0);
    gpsWatchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (lastPos.current) {
          const d = haversine(lastPos.current, p);
          if (d < 100 && d > 1) setGpsDistance((x) => x + d);
        }
        lastPos.current = p;
        setGpsPoints((n) => n + 1);
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
  };

  const stopGps = () => {
    if (gpsWatchId.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(gpsWatchId.current);
      gpsWatchId.current = null;
    }
  };

  useEffect(() => () => stopGps(), []);

  const openBuilder = (existing?: Routine) => {
    setEditing(existing ?? {
      id: crypto.randomUUID(),
      name: "My Routine",
      type: "custom",
      sport: profile?.sport || "any",
      custom: true,
      steps: [{ name: "Step 1", seconds: 60, cue: "" }],
      gps_enabled: false,
    });
    setBuilderOpen(true);
  };

  const saveBuilder = () => {
    if (!editing) return;
    if (!editing.name.trim() || editing.steps.length === 0) return;
    const clean = editing.steps.filter((s) => s.name.trim() && s.seconds > 0);
    if (clean.length === 0) return;
    const routine: Routine = { ...editing, steps: clean };
    const idx = custom.findIndex((c) => c.id === routine.id);
    const next = idx >= 0 ? custom.map((c) => (c.id === routine.id ? routine : c)) : [...custom, routine];
    setCustom(next); lsSet(KEY, next);
    setBuilderOpen(false); setEditing(null);
  };

  const remove = (id: string) => { const n = custom.filter(c => c.id !== id); setCustom(n); lsSet(KEY, n); };

  const start = (r: Routine) => {
    setActive(r); setStepIdx(0); setElapsed(0); setRunning(true);
    if (r.gps_enabled) startGps();
  };

  const history = lsGet<any[]>(HIST, []);

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <p className="text-[11px] uppercase tracking-widest text-primary font-semibold">Training</p>
        <h1 className="text-2xl font-display font-bold mt-1">Routines</h1>
        <p className="text-sm text-muted-foreground mt-1">Guided warmups, cooldowns & custom routines — with optional GPS.</p>
      </div>

      <div className="px-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {all.map(r => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-[10px] uppercase tracking-wider font-bold ${r.type === "warmup" ? "text-energy" : r.type === "cooldown" ? "text-success" : "text-primary"}`}>{r.type}</span>
                <h3 className="font-display font-bold">{r.name}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {r.sport} · {r.steps.length} steps · {Math.round(r.steps.reduce((s, x) => s + x.seconds, 0) / 60)} min
                  {r.gps_enabled && <span className="inline-flex items-center gap-1 ml-2 text-primary"><MapPin size={10} /> GPS</span>}
                </p>
              </div>
              {r.custom && (
                <div className="flex gap-1">
                  <button onClick={() => openBuilder(r)} className="p-1 text-muted-foreground"><Edit3 size={14} /></button>
                  <button onClick={() => remove(r.id)} className="p-1 text-destructive"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
            <button onClick={() => start(r)} className="mt-3 w-full bg-gradient-primary text-primary-foreground font-semibold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
              <Play size={14} /> Start
            </button>
          </motion.div>
        ))}
        <button onClick={() => openBuilder()} className="bg-card border border-dashed border-border rounded-2xl p-4 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition">
          <Plus size={18} className="inline mr-1" /> Build custom routine
        </button>
      </div>

      <div className="px-5 mt-6">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Recent completions</h3>
        <div className="space-y-2">
          {history.slice(0, 6).map((h, i) => (
            <div key={i} className="bg-card border border-border rounded-lg px-3 py-2 text-xs flex justify-between">
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {h.name}
                {h.distance_m ? <span className="text-primary ml-1">· {(h.distance_m / 1000).toFixed(2)}km</span> : null}
              </span>
              <span className="text-muted-foreground">{new Date(h.completed).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Builder modal */}
      <AnimatePresence>
        {builderOpen && editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] bg-background/90 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="w-full max-w-lg bg-card border border-border rounded-3xl p-5 my-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-display font-bold">Build routine</h2>
                <button onClick={() => { setBuilderOpen(false); setEditing(null); }} className="p-1"><X size={18} /></button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</label>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</label>
                    <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm mt-1">
                      <option value="warmup">Warmup</option>
                      <option value="cooldown">Cooldown</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Sport</label>
                    <input value={editing.sport} onChange={(e) => setEditing({ ...editing, sport: e.target.value })}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm mt-1" />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm bg-background/60 border border-border rounded-lg p-3 cursor-pointer">
                  <input type="checkbox" checked={!!editing.gps_enabled}
                    onChange={(e) => setEditing({ ...editing, gps_enabled: e.target.checked })} />
                  <MapPin size={14} className="text-primary" />
                  <span>Enable GPS tracking (distance + route)</span>
                </label>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Steps</label>
                    <button onClick={() => setEditing({ ...editing, steps: [...editing.steps, { name: `Step ${editing.steps.length + 1}`, seconds: 60, cue: "" }] })}
                      className="text-xs text-primary font-semibold flex items-center gap-1"><Plus size={12} /> Add step</button>
                  </div>
                  <div className="space-y-2">
                    {editing.steps.map((s, i) => (
                      <div key={i} className="bg-background/60 border border-border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-6">#{i + 1}</span>
                          <input value={s.name} placeholder="Step name"
                            onChange={(e) => {
                              const steps = [...editing.steps]; steps[i] = { ...s, name: e.target.value };
                              setEditing({ ...editing, steps });
                            }}
                            className="flex-1 bg-card border border-border rounded px-2 py-1.5 text-sm" />
                          <input type="number" value={s.seconds} min={5} max={3600}
                            onChange={(e) => {
                              const steps = [...editing.steps]; steps[i] = { ...s, seconds: parseInt(e.target.value) || 0 };
                              setEditing({ ...editing, steps });
                            }}
                            className="w-16 bg-card border border-border rounded px-2 py-1.5 text-sm" />
                          <span className="text-[10px] text-muted-foreground">s</span>
                          <button onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, j) => j !== i) })}
                            className="p-1 text-destructive"><Trash2 size={13} /></button>
                        </div>
                        <input value={s.cue || ""} placeholder="Cue (optional) — form reminders, tempo, etc."
                          onChange={(e) => {
                            const steps = [...editing.steps]; steps[i] = { ...s, cue: e.target.value };
                            setEditing({ ...editing, steps });
                          }}
                          className="w-full bg-card border border-border rounded px-2 py-1.5 text-xs" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button onClick={() => { setBuilderOpen(false); setEditing(null); }}
                    className="flex-1 border border-border rounded-xl py-3 text-sm">Cancel</button>
                  <button onClick={saveBuilder}
                    className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl text-sm">
                    Save routine
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active runner */}
      <AnimatePresence>
        {active && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-background/90 backdrop-blur-xl flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="w-full max-w-md bg-card border border-primary/40 rounded-3xl p-6 text-center shadow-glow">
              <p className="text-[11px] uppercase tracking-widest text-primary font-semibold">{active.name}</p>
              <h2 className="text-3xl font-display font-bold mt-1">{active.steps[stepIdx].name}</h2>
              {active.steps[stepIdx].cue && <p className="text-sm text-muted-foreground mt-1">{active.steps[stepIdx].cue}</p>}
              <div className="text-6xl font-display font-bold text-primary my-6 flex items-center justify-center gap-2">
                <Clock size={28} /> {active.steps[stepIdx].seconds - elapsed}s
              </div>
              {active.gps_enabled && (
                <div className="mb-4 bg-background/60 border border-primary/30 rounded-xl p-3 flex items-center justify-around text-sm">
                  <div><div className="text-[10px] text-muted-foreground uppercase">Distance</div><div className="font-display font-bold text-primary">{(gpsDistance / 1000).toFixed(2)} km</div></div>
                  <div><div className="text-[10px] text-muted-foreground uppercase">GPS pts</div><div className="font-display font-bold">{gpsPoints}</div></div>
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground mb-4">
                <span>Step {stepIdx + 1} / {active.steps.length}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setRunning(r => !r)} className="flex-1 bg-primary text-primary-foreground font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
                  {running ? <Pause size={16} /> : <Play size={16} />} {running ? "Pause" : "Resume"}
                </button>
                <button onClick={() => { setStepIdx(i => Math.min(i + 1, active.steps.length - 1)); setElapsed(0); }}
                  className="px-4 rounded-xl border border-border"><SkipForward size={16} /></button>
                <button onClick={() => { stopGps(); setActive(null); setRunning(false); setGpsDistance(0); setGpsPoints(0); }}
                  className="px-4 rounded-xl border border-border text-destructive">End</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Routines;
