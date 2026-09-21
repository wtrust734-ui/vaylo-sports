import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Search, TrendingUp, TrendingDown, Minus, Globe2, MapPin, Flag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { fetchLeaderboard, LeaderboardPeriod, LeaderboardRow } from "@/lib/scoring";

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "all", label: "All-time" },
];

type Geo = "worldwide" | "continental" | "national" | "regional";

const GEO_TABS: { key: Geo; label: string; icon: any }[] = [
  { key: "worldwide", label: "World", icon: Globe2 },
  { key: "continental", label: "Continent", icon: Globe2 },
  { key: "national", label: "National", icon: Flag },
  { key: "regional", label: "Regional", icon: MapPin },
];

// Minimal ISO country → continent map (extend as needed)
const CONTINENT: Record<string, string> = {
  US: "NA", CA: "NA", MX: "NA",
  BR: "SA", AR: "SA", CL: "SA", CO: "SA", PE: "SA", UY: "SA",
  GB: "EU", IE: "EU", FR: "EU", DE: "EU", ES: "EU", IT: "EU", PT: "EU", NL: "EU", BE: "EU", SE: "EU", NO: "EU", DK: "EU", FI: "EU", PL: "EU", CH: "EU", AT: "EU", GR: "EU", CZ: "EU", RO: "EU", HU: "EU", UA: "EU",
  ZA: "AF", NG: "AF", KE: "AF", EG: "AF", MA: "AF", GH: "AF", ET: "AF", TN: "AF", DZ: "AF",
  CN: "AS", JP: "AS", KR: "AS", IN: "AS", PK: "AS", ID: "AS", TH: "AS", VN: "AS", PH: "AS", MY: "AS", SG: "AS", AE: "AS", SA: "AS", IL: "AS", TR: "AS",
  AU: "OC", NZ: "OC", FJ: "OC",
};
const CONTINENT_NAME: Record<string, string> = { NA: "North America", SA: "South America", EU: "Europe", AF: "Africa", AS: "Asia", OC: "Oceania" };

interface Enriched extends LeaderboardRow { name: string; country?: string; region?: string; prevRank?: number; }

const Leaderboard = () => {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [geo, setGeo] = useState<Geo>("worldwide");
  const [sport, setSport] = useState("all");
  const [rows, setRows] = useState<Enriched[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sports, setSports] = useState<string[]>([]);

  const myCountry = (profile as any)?.country || "";
  const myRegion = (profile as any)?.region || (profile as any)?.city || "";
  const myContinent = CONTINENT[myCountry?.toUpperCase()] || "";

  useEffect(() => {
    (async () => {
      setLoading(true);
      const current = await fetchLeaderboard({ period, sport, limit: 500 });
      const prev = period === "all" ? [] : await fetchLeaderboard({ period, sport, limit: 500 });
      const prevMap: Record<string, number> = {};
      prev.forEach(r => { prevMap[r.user_id] = r.rank; });
      const ids = current.map(r => r.user_id);
      const { data: profiles } = await (supabase as any)
        .from("profiles")
        .select("user_id,full_name,country,region,city,sport")
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const pm: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { pm[p.user_id] = p; });
      const uniqueSports = new Set<string>();
      (profiles || []).forEach((p: any) => (p.sport || "").split(",").map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => uniqueSports.add(s)));
      setSports(Array.from(uniqueSports));
      setRows(current.map(r => ({
        ...r,
        name: pm[r.user_id]?.full_name || "Athlete",
        country: pm[r.user_id]?.country,
        region: pm[r.user_id]?.region || pm[r.user_id]?.city,
        prevRank: prevMap[r.user_id],
      })));
      setLoading(false);
    })();
  }, [period, sport]);

  const scoped = useMemo(() => {
    const list = rows.filter(r => {
      if (geo === "worldwide") return true;
      if (geo === "national") return myCountry && r.country && r.country.toUpperCase() === myCountry.toUpperCase();
      if (geo === "regional") return myRegion && r.region && r.region.toLowerCase() === myRegion.toLowerCase();
      if (geo === "continental") return myContinent && r.country && CONTINENT[r.country.toUpperCase()] === myContinent;
      return true;
    });
    // rerank inside scope
    return list.sort((a, b) => b.points - a.points).map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, geo, myCountry, myRegion, myContinent]);

  const filtered = useMemo(() => scoped.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase())), [scoped, search]);
  const podium = filtered.slice(0, 3);
  const rest = filtered.slice(3);
  const me = scoped.find(r => r.user_id === user?.id);

  const geoLabel: Record<Geo, string> = {
    worldwide: "Worldwide",
    continental: myContinent ? CONTINENT_NAME[myContinent] : "Set country in profile",
    national: myCountry || "Set country in profile",
    regional: myRegion || "Set region in profile",
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <p className="text-[11px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5"><Trophy size={12} /> Rankings</p>
        <h1 className="text-3xl font-display font-bold mt-1 tracking-tight">Leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Points from workouts, intensity, consistency & challenges.</p>
      </div>

      {/* Geo scope */}
      <div className="px-5 mb-3">
        <div className="grid grid-cols-4 gap-1.5 bg-card border border-border rounded-xl p-1">
          {GEO_TABS.map(g => {
            const Icon = g.icon;
            const active = geo === g.key;
            return (
              <button key={g.key} onClick={() => setGeo(g.key)}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] font-semibold transition-all ${
                  active ? "bg-gradient-to-br from-primary to-electric-purple text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"
                }`}>
                <Icon size={13} />
                {g.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{geoLabel[geo]}</p>
      </div>

      {/* Period */}
      <div className="px-5 flex gap-1.5 mb-3">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              period === p.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Sport + search */}
      <div className="px-5 flex gap-2 mb-4 text-xs">
        <select value={sport} onChange={e => setSport(e.target.value)} className="bg-card border border-border rounded-lg px-2 py-1.5 max-w-[45%]">
          <option value="all">All sports</option>
          {sports.map(s => <option key={s}>{s}</option>)}
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search athletes"
            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-card border border-border" />
        </div>
      </div>

      {loading ? <p className="px-5 text-sm text-muted-foreground">Loading…</p> : (
        <>
          {podium.length > 0 && (
            <div className="px-5 mb-4">
              <div className="grid grid-cols-3 gap-2 items-end">
                {[1,0,2].map(idx => {
                  const p = podium[idx]; if (!p) return <div key={idx}/>;
                  const heights = ["h-20","h-28","h-16"];
                  const medals = ["🥈","🥇","🥉"];
                  const glows = ["shadow-lg shadow-slate-400/20","shadow-lg shadow-amber-400/30","shadow-lg shadow-orange-400/20"];
                  return (
                    <motion.button key={p.user_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}
                      onClick={() => nav(`/profile/${p.user_id}`)} className="text-center">
                      <div className="text-2xl mb-1">{medals[idx]}</div>
                      <div className={`${heights[idx]} bg-gradient-to-t from-primary/40 via-primary/20 to-primary/5 border border-primary/40 rounded-t-xl flex flex-col items-center justify-center ${glows[idx]}`}>
                        <p className="font-display font-bold text-primary text-lg">{p.points}</p>
                        <p className="text-[9px] uppercase text-muted-foreground">pts</p>
                      </div>
                      <p className="text-[11px] font-semibold truncate mt-1">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{p.country || "—"}</p>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-5 space-y-1.5">
            {rest.map((r, i) => {
              const change = r.prevRank ? r.prevRank - r.rank : 0;
              const isMe = r.user_id === user?.id;
              return (
                <motion.button key={r.user_id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.015 }}
                  onClick={() => nav(`/profile/${r.user_id}`)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                    isMe ? "bg-primary/10 border-primary shadow-glow" : "bg-card border-border hover:border-primary/40"
                  }`}>
                  <div className="w-8 text-center font-display font-bold text-muted-foreground">#{r.rank}</div>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-electric-purple/30 flex items-center justify-center text-primary font-bold text-sm">
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.name}{isMe && <span className="ml-1 text-[10px] text-primary">· you</span>}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{r.country || "—"}{r.region ? ` · ${r.region}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px]">
                    {change > 0 ? <><TrendingUp size={10} className="text-primary"/> <span className="text-primary">+{change}</span></>
                      : change < 0 ? <><TrendingDown size={10} className="text-destructive"/> <span className="text-destructive">{change}</span></>
                      : <Minus size={10} className="text-muted-foreground"/>}
                  </div>
                  <div className="text-right w-14">
                    <p className="text-sm font-display font-bold text-primary">{r.points}</p>
                    <p className="text-[10px] uppercase text-muted-foreground">pts</p>
                  </div>
                </motion.button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-10">
                <Trophy className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No athletes in this scope yet.</p>
                {(geo === "national" || geo === "regional" || geo === "continental") && !myCountry && (
                  <p className="text-xs text-muted-foreground mt-1">Add your country in Profile to unlock geo rankings.</p>
                )}
              </div>
            )}
          </div>

          {me && me.rank > 3 && (
            <div className="fixed bottom-24 left-4 right-4 bg-gradient-to-r from-primary to-electric-purple text-primary-foreground rounded-2xl p-3 flex items-center gap-3 shadow-lg z-40">
              <div className="text-sm font-bold">#{me.rank}</div>
              <p className="flex-1 text-sm font-semibold truncate">You · {geoLabel[geo]}</p>
              <p className="text-sm font-display font-bold">{me.points} pts</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Leaderboard;
