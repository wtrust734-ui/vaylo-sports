import { useState, useEffect, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { Calendar, Plus, X, MapPin, Clock, Target, Trophy, ChevronRight, BarChart3, Users, Flag, TrendingUp, Swords, Edit3, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

type Tab = "events" | "rivals";

type EventRow = Tables<"events">;
type RivalRow = Tables<"event_rivals">;
type RivalWithEvent = RivalRow & { events: { title: string; event_date: string; sport: string } | null };

const Events = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [rivals, setRivals] = useState<RivalRow[]>([]);
  const [showAddRival, setShowAddRival] = useState(false);
  const [rivalName, setRivalName] = useState("");
  const [rivalTime, setRivalTime] = useState("");
  const [rivalPos, setRivalPos] = useState("");
  const [rivalSport, setRivalSport] = useState("");
  const [rivalNotes, setRivalNotes] = useState("");
  const [selectedRivalEvent, setSelectedRivalEvent] = useState("");
  const listRef = useRef(null);
  const listInView = useInView(listRef, { once: true, margin: "-30px" });

  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("Running");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [prediction, setPrediction] = useState("");
  const [strategy, setStrategy] = useState("");

  const [showLogResult, setShowLogResult] = useState(false);
  const [actualTime, setActualTime] = useState("");
  const [actualPos, setActualPos] = useState("");
  const [editingStrategy, setEditingStrategy] = useState(false);
  const [newStrategy, setNewStrategy] = useState("");
  const [editingTactics, setEditingTactics] = useState(false);
  const [tactics, setTactics] = useState("");

  const [allRivals, setAllRivals] = useState<RivalWithEvent[]>([]);
  const [editingRivalId, setEditingRivalId] = useState<string | null>(null);
  const [editRivalTime, setEditRivalTime] = useState("");
  const [editRivalPos, setEditRivalPos] = useState("");
  const [editingMyEventId, setEditingMyEventId] = useState<string | null>(null);
  const [myEventTime, setMyEventTime] = useState("");
  const [myEventPos, setMyEventPos] = useState("");

  useEffect(() => { if (user) { fetchEvents(); fetchAllRivals(); } }, [user]);

  const fetchEvents = async () => {
    if (!user) return;
    const { data } = await supabase.from("events").select("*").eq("user_id", user.id).order("event_date", { ascending: true });
    setEvents(data || []);
  };

  const fetchRivals = async (eventId: string) => {
    if (!user) return;
    const { data } = await supabase.from("event_rivals").select("*").eq("event_id", eventId).eq("user_id", user.id);
    setRivals(data || []);
  };

  const fetchAllRivals = async () => {
    if (!user) return;
    const { data } = await supabase.from("event_rivals").select("*, events(title, event_date, sport)").eq("user_id", user.id).order("created_at", { ascending: false });
    setAllRivals((data as RivalWithEvent[] | null) || []);
  };

  const createEvent = async () => {
    if (!user || !title.trim() || !eventDate) return;
    const { error } = await supabase.from("events").insert({
      user_id: user.id, title: title.trim(), sport, event_date: eventDate,
      location: location || null, distance_km: distanceKm ? parseFloat(distanceKm) : null,
      prediction_time: prediction || null, strategy: strategy || null,
    });
    if (error) { toast({ title: "Couldn't create the event", description: error.message, variant: "destructive" }); return; }
    setShowCreate(false); setTitle(""); setEventDate(""); setLocation(""); setDistanceKm(""); setPrediction(""); setStrategy("");
    fetchEvents();
    toast({ title: "Event created! 🏁" });
  };

  const logResult = async () => {
    if (!selectedEvent) return;
    const { error } = await supabase.from("events").update({
      actual_time: actualTime || null, actual_position: actualPos ? parseInt(actualPos) : null,
    }).eq("id", selectedEvent.id);
    if (error) { toast({ title: "Couldn't log the result", description: error.message, variant: "destructive" }); return; }
    setShowLogResult(false); setActualTime(""); setActualPos("");
    const updated = { ...selectedEvent, actual_time: actualTime, actual_position: actualPos ? parseInt(actualPos) : null };
    setSelectedEvent(updated);
    fetchEvents();
    toast({ title: "Result logged! 🏆" });
  };

  const addRival = async (eventId?: string) => {
    const eid = eventId || selectedRivalEvent || selectedEvent?.id;
    if (!eid || !user || !rivalName.trim()) {
      if (!eid) {
        toast({ title: "Select an event", description: "You need at least one event to link a rival to.", variant: "destructive" });
        return;
      }
      return;
    }
    const { error } = await supabase.from("event_rivals").insert({
      event_id: eid, user_id: user.id, rival_name: rivalName.trim(),
      result_time: rivalTime || null, position: rivalPos ? parseInt(rivalPos) : null,
    });
    if (error) {
      toast({ title: "Error adding rival", description: error.message, variant: "destructive" });
      return;
    }
    setShowAddRival(false); setRivalName(""); setRivalTime(""); setRivalPos(""); setRivalNotes(""); setSelectedRivalEvent("");
    if (selectedEvent) fetchRivals(selectedEvent.id);
    fetchAllRivals();
    toast({ title: "Rival added!" });
  };

  const deleteRival = async (id: string) => {
    const { error } = await supabase.from("event_rivals").delete().eq("id", id);
    if (error) { toast({ title: "Couldn't remove the rival", description: error.message, variant: "destructive" }); return; }
    fetchAllRivals();
    if (selectedEvent) fetchRivals(selectedEvent.id);
    toast({ title: "Rival removed" });
  };

  const updateRivalResult = async (rivalId: string) => {
    const { error } = await supabase.from("event_rivals").update({
      result_time: editRivalTime || null,
      position: editRivalPos ? parseInt(editRivalPos) : null,
    }).eq("id", rivalId);
    if (error) { toast({ title: "Couldn't update the rival", description: error.message, variant: "destructive" }); return; }
    setEditingRivalId(null);
    fetchAllRivals();
    if (selectedEvent) fetchRivals(selectedEvent.id);
    toast({ title: "Rival result updated! 📊" });
  };

  const logMyEventResult = async (eventId: string) => {
    const { error } = await supabase.from("events").update({
      actual_time: myEventTime || null,
      actual_position: myEventPos ? parseInt(myEventPos) : null,
    }).eq("id", eventId);
    if (error) { toast({ title: "Couldn't log your result", description: error.message, variant: "destructive" }); return; }
    setEditingMyEventId(null); setMyEventTime(""); setMyEventPos("");
    fetchEvents();
    toast({ title: "Your result logged! 🏆" });
  };

  const saveStrategy = async () => {
    if (!selectedEvent) return;
    const { error } = await supabase.from("events").update({ strategy: newStrategy }).eq("id", selectedEvent.id);
    if (error) { toast({ title: "Couldn't save the strategy", description: error.message, variant: "destructive" }); return; }
    setSelectedEvent({ ...selectedEvent, strategy: newStrategy });
    setEditingStrategy(false);
    toast({ title: "Strategy saved!" });
  };

  const saveNotes = async (notes: string) => {
    if (!selectedEvent) return;
    const { error } = await supabase.from("events").update({ notes }).eq("id", selectedEvent.id);
    if (error) { toast({ title: "Couldn't save the notes", description: error.message, variant: "destructive" }); return; }
    setSelectedEvent({ ...selectedEvent, notes });
    setEditingTactics(false);
    toast({ title: "Tactics saved!" });
  };

  const getCountdown = (dateStr: string) => {
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff <= 0) return "Event passed";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-300";

  const getResultsChartData = () => {
    if (!selectedEvent) return [];
    const data: { name: string; time: string; position: number }[] = [];
    if (selectedEvent.actual_time) {
      data.push({ name: "You", time: selectedEvent.actual_time, position: selectedEvent.actual_position || 0 });
    }
    rivals.forEach(r => {
      data.push({ name: r.rival_name, time: r.result_time || "—", position: r.position || 0 });
    });
    return data.sort((a, b) => (a.position || 999) - (b.position || 999));
  };

  const getUniqueRivals = () => {
    const names = new Map<string, RivalWithEvent[]>();
    allRivals.forEach(r => {
      const existing = names.get(r.rival_name) || [];
      existing.push(r);
      names.set(r.rival_name, existing);
    });
    return Array.from(names.entries());
  };

  // Event detail view
  if (selectedEvent) {
    const chartData = getResultsChartData();
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <motion.button onClick={() => setSelectedEvent(null)} whileTap={{ scale: 0.9 }} className="text-muted-foreground">
            <ChevronRight size={20} className="rotate-180" />
          </motion.button>
          <h1 className="text-xl font-display font-bold">{selectedEvent.title}</h1>
        </div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-5 shadow-card text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-2">Countdown</p>
          <motion.p className="text-3xl font-display font-bold text-primary"
            animate={{ scale: [1, 1.03, 1] }} transition={{ duration: 2, repeat: Infinity }}>
            {getCountdown(selectedEvent.event_date)}
          </motion.p>
          <p className="text-sm text-muted-foreground mt-2">
            {new Date(selectedEvent.event_date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
          {selectedEvent.location && <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1"><MapPin size={12} />{selectedEvent.location}</p>}
          {selectedEvent.distance_km && <p className="text-xs text-muted-foreground mt-1">{Number(selectedEvent.distance_km)} km · {selectedEvent.sport}</p>}
        </motion.div>

        {selectedEvent.prediction_time && (
          <div className="mx-5 mb-3 bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1"><Target size={14} className="text-primary" /><span className="text-xs font-semibold text-muted-foreground">Prediction</span></div>
            <p className="text-sm font-semibold">{selectedEvent.prediction_time}</p>
          </div>
        )}

        {selectedEvent.actual_time ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="mx-5 mb-5 bg-gradient-card border border-primary/30 rounded-2xl p-5 shadow-card text-center">
            <Trophy size={24} className="mx-auto text-accent-foreground mb-2" />
            <p className="text-xs font-semibold text-muted-foreground mb-1">Your Result</p>
            <p className="text-2xl font-display font-bold">{selectedEvent.actual_time}</p>
            {selectedEvent.actual_position && <p className="text-sm text-muted-foreground mt-1">Position: #{selectedEvent.actual_position}</p>}
          </motion.div>
        ) : (
          <div className="px-5 mb-5">
            {showLogResult ? (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <input type="text" placeholder="Time (e.g. 1:45:30)" value={actualTime} onChange={e => setActualTime(e.target.value)} className={inputClass} />
                <input type="number" placeholder="Position" value={actualPos} onChange={e => setActualPos(e.target.value)} className={inputClass} />
                <div className="flex gap-2">
                  <button onClick={() => setShowLogResult(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
                  <motion.button onClick={logResult} whileTap={{ scale: 0.98 }} className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow">Save</motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.button onClick={() => setShowLogResult(true)} whileTap={{ scale: 0.98 }}
                className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow flex items-center justify-center gap-2">
                <Trophy size={18} /> Log Your Result
              </motion.button>
            )}
          </div>
        )}

        {/* Results & Rivals */}
        <div className="px-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-1"><Users size={14} /> Results & Rivals</h3>
            <button onClick={() => { setShowAddRival(true); fetchRivals(selectedEvent.id); }} className="text-xs text-primary font-semibold"><Plus size={14} className="inline" /> Add Rival</button>
          </div>

          {chartData.length > 0 && chartData.some(d => d.position) && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-card border border-border rounded-xl p-4 mb-4">
              <h4 className="text-xs font-semibold text-muted-foreground mb-3">Position Comparison</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} reversed />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                  <Bar dataKey="position" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          )}

          {chartData.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
              <div className="grid grid-cols-3 bg-muted/50 px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">
                <span>Name</span><span className="text-center">Position</span><span className="text-right">Time</span>
              </div>
              {chartData.map((d, i) => (
                <div key={i} className={`grid grid-cols-3 px-4 py-3 text-sm border-t border-border ${d.name === "You" ? "bg-primary/5" : ""}`}>
                  <span className="font-semibold">{d.name}</span>
                  <span className="text-center text-muted-foreground">{d.position ? `#${d.position}` : "—"}</span>
                  <span className="text-right text-muted-foreground">{d.time || "—"}</span>
                </div>
              ))}
            </div>
          )}

          {chartData.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No results yet. Log your result and add rivals.</p>}

          <AnimatePresence>
            {showAddRival && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-card border border-border rounded-2xl p-4 space-y-3 mt-3">
                <input type="text" placeholder="Rival name *" value={rivalName} onChange={e => setRivalName(e.target.value)} className={inputClass} />
                <input type="text" placeholder="Time (optional)" value={rivalTime} onChange={e => setRivalTime(e.target.value)} className={inputClass} />
                <input type="number" placeholder="Position (optional)" value={rivalPos} onChange={e => setRivalPos(e.target.value)} className={inputClass} />
                <div className="flex gap-2">
                  <button onClick={() => setShowAddRival(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
                  <motion.button onClick={() => addRival()} disabled={!rivalName.trim()} whileTap={{ scale: 0.98 }}
                    className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl disabled:opacity-40 shadow-glow">Add Rival</motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Strategy */}
        <div className="px-5 mb-5">
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1"><BarChart3 size={14} className="text-primary" /> Race Strategy</h3>
              <button onClick={() => { setEditingStrategy(true); setNewStrategy(selectedEvent.strategy || ""); }} className="text-xs text-primary font-semibold">Edit</button>
            </div>
            {editingStrategy ? (
              <div className="space-y-3">
                <textarea value={newStrategy} onChange={e => setNewStrategy(e.target.value)} rows={6}
                  placeholder="Describe your race strategy..."
                  className={inputClass + " resize-none"} />
                <div className="flex gap-2">
                  <button onClick={() => setEditingStrategy(false)} className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
                  <motion.button onClick={saveStrategy} whileTap={{ scale: 0.98 }} className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2 rounded-xl shadow-glow">Save</motion.button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{selectedEvent.strategy || "No strategy set. Tap Edit to plan your race approach."}</p>
            )}
          </div>
        </div>

        {/* Tactics */}
        <div className="px-5 mb-5">
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1"><Flag size={14} className="text-primary" /> Race Tactics & Planning</h3>
              <button onClick={() => { setEditingTactics(true); setTactics(selectedEvent.notes || ""); }} className="text-xs text-primary font-semibold">Edit</button>
            </div>
            {editingTactics ? (
              <div className="space-y-3">
                <textarea value={tactics} onChange={e => setTactics(e.target.value)} rows={6}
                  placeholder="Warm-up routine, what to eat before, gear checklist, mental preparation, split targets..."
                  className={inputClass + " resize-none"} />
                <div className="flex gap-2">
                  <button onClick={() => setEditingTactics(false)} className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
                  <motion.button onClick={() => saveNotes(tactics)} whileTap={{ scale: 0.98 }} className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2 rounded-xl shadow-glow">Save</motion.button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{selectedEvent.notes || "No tactics set."}</p>
            )}
          </div>
        </div>

        <div className="px-5 mb-8">
          <div className="bg-card border border-border rounded-xl p-4">
            <h4 className="text-xs font-semibold text-muted-foreground mb-3">📋 Event Planning Checklist</h4>
            <div className="space-y-2">
              {[
                { label: "Strategy set", done: !!selectedEvent.strategy },
                { label: "Prediction time set", done: !!selectedEvent.prediction_time },
                { label: "Tactics planned", done: !!selectedEvent.notes },
                { label: "Rivals added", done: rivals.length > 0 },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center ${item.done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {item.done ? "✓" : "○"}
                  </div>
                  <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Rivals tab
  if (tab === "rivals") {
    const uniqueRivals = getUniqueRivals();
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="px-5 pt-14 pb-4">
          <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Events</motion.h1>
        </div>
        <div className="px-5 mb-5">
          <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
            <button onClick={() => setTab("events")} className="flex-1 py-2 rounded-lg text-xs font-semibold text-muted-foreground">Events</button>
            <button className="flex-1 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground">Rivals</button>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="px-5 text-center py-12">
            <p className="text-sm text-muted-foreground mb-3">Create an event first before adding rivals.</p>
            <motion.button onClick={() => { setTab("events"); setShowCreate(true); }} whileTap={{ scale: 0.98 }}
              className="bg-gradient-primary text-primary-foreground font-semibold py-3 px-6 rounded-xl shadow-glow">
              Create Event
            </motion.button>
          </div>
        ) : (
          <>
            <div className="px-5 mb-4">
              <motion.button onClick={() => setShowAddRival(true)} whileTap={{ scale: 0.98 }}
                className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow flex items-center justify-center gap-2">
                <Plus size={18} /> Add Rival
              </motion.button>
            </div>

            <AnimatePresence>
              {showAddRival && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mx-5 mb-4 bg-card border border-border rounded-2xl p-4 space-y-3">
                  <input type="text" placeholder="Rival name *" value={rivalName} onChange={e => setRivalName(e.target.value)} className={inputClass} />
                  <input type="text" placeholder="Their best time/score (optional)" value={rivalTime} onChange={e => setRivalTime(e.target.value)} className={inputClass} />
                  <input type="number" placeholder="Their typical position (optional)" value={rivalPos} onChange={e => setRivalPos(e.target.value)} className={inputClass} />
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Link to event *</label>
                    <select value={selectedRivalEvent} onChange={e => setSelectedRivalEvent(e.target.value)} className={inputClass}>
                      <option value="">Select an event</option>
                      {events.map(evt => <option key={evt.id} value={evt.id}>{evt.title}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowAddRival(false); setSelectedRivalEvent(""); }} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
                    <motion.button onClick={() => addRival(selectedRivalEvent)} disabled={!rivalName.trim() || !selectedRivalEvent} whileTap={{ scale: 0.98 }}
                      className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl disabled:opacity-40 shadow-glow">Add</motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="px-5 space-y-4 mb-8">
              {uniqueRivals.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No rivals added yet.</p>}
              {uniqueRivals.map(([name, records], i) => (
                <motion.div key={name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  className="bg-card border border-border rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Swords size={16} className="text-primary" />
                      <h3 className="font-display font-bold">{name}</h3>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{records.length} event{records.length > 1 ? "s" : ""}</span>
                  </div>

                  {records.filter(r => r.position).length > 0 && (
                    <div className="mb-3">
                      <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={records.map(r => ({ event: r.events?.title?.slice(0, 10) || "Event", position: r.position || 0 }))}>
                          <XAxis dataKey="event" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} reversed />
                          <Bar dataKey="position" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {records.map(r => {
                      const isEditing = editingRivalId === r.id;
                      const evt = events.find(e => e.id === r.event_id);
                      const isMyEditing = editingMyEventId === r.event_id;
                      return (
                        <div key={r.id} className="bg-muted/30 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between text-xs">
                            <div>
                              <span className="font-medium">{r.events?.title || "Event"}</span>
                              <span className="text-muted-foreground ml-2">{r.result_time || "No time"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {r.position && <span className="text-primary font-bold">#{r.position}</span>}
                              <button onClick={() => { setEditingRivalId(isEditing ? null : r.id); setEditRivalTime(r.result_time || ""); setEditRivalPos(r.position ? String(r.position) : ""); }}
                                className="text-muted-foreground hover:text-primary" title="Edit rival result"><Edit3 size={12} /></button>
                              <button onClick={() => deleteRival(r.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                            </div>
                          </div>
                          {isEditing && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2 space-y-2">
                              <input type="text" placeholder="Rival's time/score" value={editRivalTime} onChange={e => setEditRivalTime(e.target.value)} className={inputClass} />
                              <input type="number" placeholder="Rival's position" value={editRivalPos} onChange={e => setEditRivalPos(e.target.value)} className={inputClass} />
                              <motion.button onClick={() => updateRivalResult(r.id)} whileTap={{ scale: 0.98 }}
                                className="w-full bg-primary text-primary-foreground font-semibold py-2 rounded-xl text-sm">Save Rival Result</motion.button>
                            </motion.div>
                          )}
                          {/* Your own result for this event */}
                          {evt && (
                            <div className="mt-2 pt-2 border-t border-border/40">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-muted-foreground">Your result: <span className={evt.actual_time ? "text-primary font-semibold" : ""}>{evt.actual_time || "Not logged"}{evt.actual_position ? ` · #${evt.actual_position}` : ""}</span></span>
                                <button onClick={() => { setEditingMyEventId(isMyEditing ? null : evt.id); setMyEventTime(evt.actual_time || ""); setMyEventPos(evt.actual_position ? String(evt.actual_position) : ""); }}
                                  className="text-primary font-semibold">{isMyEditing ? "Cancel" : (evt.actual_time ? "Edit" : "Log mine")}</button>
                              </div>
                              {isMyEditing && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2 space-y-2">
                                  <input type="text" placeholder="Your time/score" value={myEventTime} onChange={e => setMyEventTime(e.target.value)} className={inputClass} />
                                  <input type="number" placeholder="Your position" value={myEventPos} onChange={e => setMyEventPos(e.target.value)} className={inputClass} />
                                  <motion.button onClick={() => logMyEventResult(evt.id)} whileTap={{ scale: 0.98 }}
                                    className="w-full bg-gradient-primary text-primary-foreground font-semibold py-2 rounded-xl text-sm shadow-glow">Save My Result</motion.button>
                                </motion.div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // Main events list
  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Events</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Race day. Your day.</motion.p>
      </div>

      <div className="px-5 mb-5">
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
          <button className="flex-1 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground">Events</button>
          <button onClick={() => setTab("rivals")} className="flex-1 py-2 rounded-lg text-xs font-semibold text-muted-foreground">Rivals</button>
        </div>
      </div>

      {events.filter(e => new Date(e.event_date) > new Date()).length > 0 && (
        <div className="px-5 mb-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Upcoming</h3>
          <div className="space-y-3">
            {events.filter(e => new Date(e.event_date) > new Date()).map((evt, i) => (
              <motion.div key={evt.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                onClick={() => { setSelectedEvent(evt); fetchRivals(evt.id); }}
                className="bg-gradient-card border border-border rounded-2xl p-4 shadow-card cursor-pointer hover:border-primary/20 transition-colors duration-300">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-display font-bold">{evt.title}</h4>
                  <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">{getCountdown(evt.event_date)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar size={12} />{new Date(evt.event_date).toLocaleDateString()}</span>
                  {evt.location && <span className="flex items-center gap-1"><MapPin size={12} />{evt.location}</span>}
                  {evt.distance_km && <span>{Number(evt.distance_km)} km</span>}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {!showCreate ? (
        <div className="px-5 mb-5">
          <motion.button onClick={() => setShowCreate(true)} whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }}
            className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
            <Plus size={18} /> Add Event
          </motion.button>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 15, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-4 shadow-card space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-display font-bold">New Event</h3><button onClick={() => setShowCreate(false)} className="text-muted-foreground"><X size={18} /></button></div>
          <input type="text" placeholder="Event name *" value={title} onChange={e => setTitle(e.target.value)} className={inputClass} />
          <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className={inputClass} />
          <div className="flex flex-wrap gap-1.5">
            {["Running", "Cycling", "Swimming", "Triathlon", "Athletics", "Football", "Other"].map(s => (
              <button key={s} onClick={() => setSport(s)} className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${sport === s ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-foreground"}`}>{s}</button>
            ))}
          </div>
          <input type="text" placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} className={inputClass} />
          <input type="number" step="0.1" placeholder="Distance (km)" value={distanceKm} onChange={e => setDistanceKm(e.target.value)} className={inputClass} />
          <input type="text" placeholder="Prediction time (e.g. 1:45:00)" value={prediction} onChange={e => setPrediction(e.target.value)} className={inputClass} />
          <textarea placeholder="Race strategy..." value={strategy} onChange={e => setStrategy(e.target.value)} rows={3} className={inputClass + " resize-none"} />
          <motion.button onClick={createEvent} disabled={!title.trim() || !eventDate} whileTap={{ scale: 0.98 }}
            className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-40 shadow-glow">Create Event</motion.button>
        </motion.div>
      )}

      <div ref={listRef} className="px-5 mb-8">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Past Events</h3>
        {events.filter(e => new Date(e.event_date) <= new Date()).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No past events yet.</p>
        )}
        <div className="space-y-3">
          {events.filter(e => new Date(e.event_date) <= new Date()).map((evt, i) => (
            <motion.div key={evt.id} initial={{ opacity: 0, x: -15 }} animate={listInView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.06 }}
              onClick={() => { setSelectedEvent(evt); fetchRivals(evt.id); }}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/20 transition-colors duration-300">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">{evt.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(evt.event_date).toLocaleDateString()}
                    {evt.actual_time && ` · ${evt.actual_time}`}
                    {evt.actual_position && ` · #${evt.actual_position}`}
                  </p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Events;
