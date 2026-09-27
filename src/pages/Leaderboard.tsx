import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Search, TrendingUp, TrendingDown, Minus, Globe, MapPin, Map as MapIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchLeaderboard, previousPeriodWindow, LeaderboardPeriod, LeaderboardRow } from "@/lib/scoring";
import { fetchDisplayNames, UNKNOWN_ATHLETE } from "@/lib/publicIdentity";
import { continentFor, countryFlag, countryName, type Continent } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Rankings scopes: World, your continent, and your country.
//
// Country comes from `user_region`, which is publicly readable for exactly two
// columns — `user_id` and `country`. Continent is derived from the country with
// the UN M49 mapping in `src/lib/geo.ts`, so no per-athlete guesswork happens at
// read time. An athlete who has not set a country still ranks worldwide; the
// geo scopes stay disabled until they pick one, rather than silently filing them
// under a default country they never chose.
//
// Note: rows are fetched as a worldwide top-N (500) and then filtered by scope.
// A very deep country board could miss an athlete outside that cut — fine at
// current scale, worth revisiting if a country board needs to be exhaustive.
// ---------------------------------------------------------------------------

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "all", label: "All-time" },
];

type Scope = "world" | "continent" | "country";

interface Enriched extends LeaderboardRow {
  name: string;
  country: string | null;
  sportLabel?: string;
  prevRank?: number;
}

/** `points_events.sport` can hold a comma-separated list; show the first. */
const primarySport = (sport: string | null | undefined): string | undefined => {
  const first = (sport || "").split(",").map(s => s.trim()).filter(Boolean)[0];
  return first || undefined;
};

/**
 * Ranks must be recomputed inside a scope, or a country board would show gaps.
 * Generic so the enriched fields (name, country) survive the re-rank.
 */
const rankRows = <T extends LeaderboardRow>(rows: T[]): T[] =>
  [...rows]
    .sort((a, b) => b.points - a.points)
    .map((r, i) => ({ ...r, rank: i + 1 }));

const Leaderboard = () => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [sport, setSport] = useState("all");
  const [scope, setScope] = useState<Scope>("world");
  const [rows, setRows] = useState<Enriched[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sports, setSports] = useState<string[]>([]);
  const [myCountry, setMyCountry] = useState<string | null>(null);
  // Previous-window rows (with their countries) kept in a ref so changing the
  // scope can re-rank both sides without refetching. Must be a ref: a plain
  // object would be recreated on every render and lose the data.
  const prevRows = useRef<(LeaderboardRow & { country: string | null })[]>([]);

  // Own country (own row of user_region).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_region")
        .select("country")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setMyCountry(data?.country ?? null);
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const current = await fetchLeaderboard({ period, sport, limit: 500 });

        // Rank change needs the PREVIOUS window. Fetching the same period twice
        // pinned every trend arrow at zero.
        const prevWindow = previousPeriodWindow(period);
        const prev = prevWindow
          ? await fetchLeaderboard({ period, sport, limit: 500, from: prevWindow.from, to: prevWindow.to })
          : [];

        // Public data only. Names come from `avatars` and country from the
        // publicly-readable columns of `user_region` — `profiles` stays private.
        const ids = Array.from(new Set([...current, ...prev].map(r => r.user_id)));
        const [names, regions] = await Promise.all([
          fetchDisplayNames(ids),
          ids.length
            ? supabase.from("user_region").select("user_id, country").in("user_id", ids)
            : Promise.resolve({ data: [] as { user_id: string; country: string | null }[] }),
        ]);

        const countryOf = new Map<string, string | null>();
        for (const r of (regions.data ?? []) as { user_id: string; country: string | null }[]) {
          countryOf.set(r.user_id, r.country);
        }

        const uniqueSports = new Set<string>();
        current.forEach(r => (r.sport || "").split(",").map(s => s.trim()).filter(Boolean).forEach(s => uniqueSports.add(s)));

        if (cancelled) return;
        setSports(Array.from(uniqueSports).sort());

        // Keep the previous-window rows and their countries so a scope change can
        // recompute both sides consistently without another network round trip.
        prevRows.current = prev.map(r => ({ ...r, country: countryOf.get(r.user_id) ?? null }));
        setRows(current.map(r => ({
          ...r,
          name: names[r.user_id] ?? UNKNOWN_ATHLETE,
          country: countryOf.get(r.user_id) ?? null,
          sportLabel: primarySport(r.sport),
        })));
      } catch (e) {
        console.error("Leaderboard failed to load:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, sport]);

  const myContinent: Continent | null = continentFor(myCountry);

  const scoped = useMemo(() => {
    const inScope = <T extends { country: string | null }>(r: T) =>
      scope === "world" ? true
        : scope === "continent" ? continentFor(r.country) === myContinent && !!myContinent
        : r.country === myCountry && !!myCountry;

    const current = rankRows(rows.filter(inScope));
    const previous = rankRows(prevRows.current.filter(inScope));
    const prevMap: Record<string, number> = {};
    previous.forEach(r => { prevMap[r.user_id] = r.rank; });
    return current.map(r => ({ ...r, prevRank: prevMap[r.user_id] }));
  }, [rows, scope, myCountry, myContinent]);

  const filtered = useMemo(
    () => scoped.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [scoped, search],
  );
  const podium = filtered.slice(0, 3);
  const rest = filtered.slice(3);
  const me = filtered.find(r => r.user_id === user?.id);

  const SCOPES: { key: Scope; label: string; icon: typeof Globe; enabled: boolean }[] = [
    { key: "world", label: "World", icon: Globe, enabled: true },
    { key: "continent", label: myContinent ?? "Continent", icon: MapIcon, enabled: !!myContinent },
    { key: "country", label: countryName(myCountry) ?? "Country", icon: MapPin, enabled: !!myCountry },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <p className="text-[11px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5"><Trophy size={12} /> Rankings</p>
        <h1 className="text-3xl font-display font-bold mt-1 tracking-tight">Leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Points from workouts, intensity, consistency & challenges.</p>
      </div>

      {/* Scope */}
      <div className="px-5 flex gap-1.5 mb-2">
        {SCOPES.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.key} onClick={() => s.enabled && setScope(s.key)} disabled={!s.enabled}
              title={s.enabled ? undefined : "Set your country in Profile to unlock this board"}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors truncate ${
                !s.enabled ? "bg-muted/40 border-border text-muted-foreground/50 cursor-not-allowed"
                  : scope === s.key ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground"
              }`}>
              <Icon size={12} /> <span className="truncate">{s.label}</span>
            </button>
          );
        })}
      </div>

      {!myCountry && (
        <div className="px-5 mb-3">
          <button onClick={() => nav("/profile")}
            className="w-full text-start text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
            Add your country in Profile to unlock your country and continental boards →
          </button>
        </div>
      )}

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
                      <p className="text-[11px] font-semibold truncate mt-1">{countryFlag(p.country)} {p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{p.sportLabel || "—"}</p>
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
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-start transition-all ${
                    isMe ? "bg-primary/10 border-primary shadow-glow" : "bg-card border-border hover:border-primary/40"
                  }`}>
                  <div className="w-8 text-center font-display font-bold text-muted-foreground">#{r.rank}</div>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-electric-purple/30 flex items-center justify-center text-primary font-bold text-sm">
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{countryFlag(r.country)} {r.name}{isMe && <span className="ml-1 text-[10px] text-primary">· you</span>}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{r.sportLabel || "Multi-sport"}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px]" title={r.prevRank ? `Was #${r.prevRank} last period` : "New this period"}>
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
                <p className="text-sm text-muted-foreground">
                  {scope === "world"
                    ? "No ranked athletes yet. Log a workout to open the board."
                    : `No ranked athletes in ${scope === "country" ? countryName(myCountry) : myContinent} yet.`}
                </p>
              </div>
            )}
          </div>

          {me && me.rank > 3 && (
            <div className="fixed bottom-24 left-4 right-4 bg-gradient-to-r from-primary to-electric-purple text-primary-foreground rounded-2xl p-3 flex items-center gap-3 shadow-lg z-40">
              <div className="text-sm font-bold">#{me.rank}</div>
              <p className="flex-1 text-sm font-semibold truncate">You</p>
              <p className="text-sm font-display font-bold">{me.points} pts</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Leaderboard;
