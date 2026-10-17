// ============================================================================
// EVENT TROPHIES — time-ladder trophies for timed distance events
// ----------------------------------------------------------------------------
// The idea the athlete asked for: log a session, and if that session was a
// distance-time event (a 5K run, a 25K ride…), a card shows the time as a PB
// with the tier it earns — Bronze / Silver / Gold — as a trophy. Trophies for
// a sport you never practise do not exist for you: the trophy case only lists
// events whose sport the athlete has actually logged.
//
// This module is the pure half of the system (mirrored server-side in
// 20261017110000_event_trophies.sql):
//   * the ladder itself (events, distances, tier thresholds),
//   * matching a logged distance to an event,
//   * which tiers a time earns,
//   * whether a log is a PB against what came before.
// Kept free of supabase/auth imports so unit tests can run it directly.
// ============================================================================

export type TrophyTier = "bronze" | "silver" | "gold";

export const TIER_META: Record<TrophyTier, { label: string; color: string }> = {
  bronze: { label: "Bronze",  color: "#cd7f32" },
  silver: { label: "Silver",  color: "#c0c0c0" },
  gold:   { label: "Gold",    color: "#fbbf24" },
};

export interface TrophyTierDef {
  tier: TrophyTier;
  /** Fastest-allowed seconds to earn the tier — lower is better. */
  time_seconds: number;
}

export interface EventTrophyEvent {
  id: string;               // server id, e.g. run_5k
  sport: string;            // matches performance_logs.sport, e.g. Running
  distance_km: number;
  label: string;            // "Running · 5K"
  icon: string;             // lucide icon name shared with the seed
  tiers: TrophyTierDef[];
}

/**
 * THE LADDER — mirrors the server seed. Distances are the standard events;
 * thresholds are commonsense age-group targets, not elite ones, so a committed
 * amateur earns Bronze on a normal season and Gold needs real speed.
 * (Server is authoritative for granting; this client copy drives previews and
 * the trophy case before a fetch lands.)
 */
export const EVENT_TROPHY_EVENTS: EventTrophyEvent[] = [
  {
    id: "run_1k",    sport: "Running",  distance_km: 1,       label: "Running · 1K",     icon: "Zap",
    tiers: [ { tier: "bronze", time_seconds: 360 },  { tier: "silver", time_seconds: 300 },   { tier: "gold", time_seconds: 230 } ],
  },
  {
    id: "run_5k",    sport: "Running",  distance_km: 5,       label: "Running · 5K",     icon: "Flag",
    tiers: [ { tier: "bronze", time_seconds: 1800 }, { tier: "silver", time_seconds: 1440 },  { tier: "gold", time_seconds: 1100 } ],
  },
  {
    id: "run_10k",   sport: "Running",  distance_km: 10,      label: "Running · 10K",    icon: "Flag",
    tiers: [ { tier: "bronze", time_seconds: 3900 }, { tier: "silver", time_seconds: 3000 },  { tier: "gold", time_seconds: 2300 } ],
  },
  {
    id: "run_half",  sport: "Running",  distance_km: 21.0975, label: "Running · Half",   icon: "Timer",
    tiers: [ { tier: "bronze", time_seconds: 9000 }, { tier: "silver", time_seconds: 7200 },  { tier: "gold", time_seconds: 5760 } ],
  },
  {
    id: "run_full",  sport: "Running",  distance_km: 42.195,  label: "Running · Marathon", icon: "Trophy",
    tiers: [ { tier: "bronze", time_seconds: 18000 }, { tier: "silver", time_seconds: 15000 }, { tier: "gold", time_seconds: 12200 } ],
  },
  {
    id: "ride_10k",  sport: "Cycling",  distance_km: 10,      label: "Cycling · 10K",    icon: "Bike",
    tiers: [ { tier: "bronze", time_seconds: 1320 }, { tier: "silver", time_seconds: 1020 },  { tier: "gold", time_seconds: 780 } ],
  },
  {
    id: "ride_40k",  sport: "Cycling",  distance_km: 40,      label: "Cycling · 40K",    icon: "Bike",
    tiers: [ { tier: "bronze", time_seconds: 4680 }, { tier: "silver", time_seconds: 3900 },  { tier: "gold", time_seconds: 3180 } ],
  },
  {
    id: "swim_100m", sport: "Swimming", distance_km: 0.1,     label: "Swimming · 100m",  icon: "Waves",
    tiers: [ { tier: "bronze", time_seconds: 180 },  { tier: "silver", time_seconds: 130 },   { tier: "gold", time_seconds: 85 } ],
  },
  {
    id: "swim_1k",   sport: "Swimming", distance_km: 1,       label: "Swimming · 1K",    icon: "Waves",
    tiers: [ { tier: "bronze", time_seconds: 1500 }, { tier: "silver", time_seconds: 1200 },  { tier: "gold", time_seconds: 900 } ],
  },
];

/**
 * Distance tolerance for "same event": clocks drift and GPS pads distances,
 * so a 5K run may log at 4.9–5.2km. Within 2% counts as the event.
 */
export function matchEvent(sport: string, distanceKm: number): EventTrophyEvent | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const s = sport.trim().toLowerCase();
  if (!s || s === "general") return null;
  let best: { event: EventTrophyEvent; rel: number } | null = null;
  for (const event of EVENT_TROPHY_EVENTS) {
    if (event.sport.toLowerCase() !== s) continue;
    const rel = Math.abs(distanceKm - event.distance_km) / event.distance_km;
    if (rel > 0.02) continue;
    if (!best || rel < best.rel) best = { event, rel };
  }
  return best?.event ?? null;
}

/**
 * The tiers a given time earns, best (fastest) first. A time earns every tier
 * whose threshold it meets-or-beats — running Gold implies Silver and Bronze
 * were both passed, so the trophy case reads complete (idempotent server-side
 * repeats do the rest). E.g. a 24:00 5K meets Bronze and Silver exactly.
 */
export function tiersForTime(event: EventTrophyEvent, timeSeconds: number): TrophyTier[] {
  if (!Number.isFinite(timeSeconds) || timeSeconds <= 0) return [];
  const order: TrophyTier[] = ["gold", "silver", "bronze"];
  const met = new Set(event.tiers.filter((t) => t.time_seconds >= timeSeconds).map((t) => t.tier));
  return order.filter((t) => met.has(t));
}

/** The best tier a time earns, or null when the time is below every threshold. */
export function bestTierForTime(event: EventTrophyEvent, timeSeconds: number): TrophyTier | null {
  const met = tiersForTime(event, timeSeconds);
  if (!met.length) return null;
  const order: TrophyTier[] = ["gold", "silver", "bronze"];
  return order.find((t) => met.includes(t)) ?? null;
}

/** `mm:ss` for anything under an hour, `h:mm:ss` above. */
export function formatRaceTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Client-side reward id for a tier, mirroring the server seed's ids. */
export function trophyRewardId(eventId: string, tier: TrophyTier): string {
  return `trophy_${eventId}_${tier}`;
}

/** A performance log, reduced to what the PB/trophy evaluation needs. */
export interface LogPbInput {
  sport: string;
  log_type: string | null;
  distance_km: number | null;
  time_seconds: number | null;
}

/** The evaluated result for one log. */
export interface PbEvaluation {
  event: { id: string; label: string; sport: string } | null;
  /** True when this time beats every stored PB for the same event. */
  isPb: boolean;
  /** The previous best (seconds), when there was one. */
  previous_seconds: number | null;
  tier: TrophyTier | null;
  rewardIds: string[]; // trophies this log earns
}

/**
 * The local PB store stores ONE entry per event label (metric string), with
 * value in SECONDS and unit "". PBs page renders value+unit; seconds + "" keeps
 * the wall honest for timed events, and formatRaceTime renders mm:ss elsewhere.
 */
export function evaluateLogAgainstEvents(
  log: LogPbInput,
  existingPbs: { metric: string; value: number }[],
): PbEvaluation {
  const event = matchEvent(log.sport, log.distance_km ?? NaN);
  if (!event || !log.time_seconds || log.time_seconds <= 0) {
    return { event: null, isPb: false, previous_seconds: null, tier: null, rewardIds: [] };
  }
  const metric = event.label;
  const previous = existingPbs.find((p) => p.metric === metric);
  const previousSeconds = previous && previous.value > 0 ? previous.value : null;
  const isPb = previousSeconds === null || log.time_seconds < previousSeconds;

  // Trophies follow the TIME, not the PB flag: any session fast enough for a
  // tier earns it. The tier set is computed from the best the athlete has now
  // (this log vs stored PB), whichever is faster — the server grants each tier
  // once ever, so replaying an already-owned tier is a silent no-op there;
  // this list is what the celebration preview can honestly show as earned.
  const bestNow = previousSeconds === null ? log.time_seconds : Math.min(log.time_seconds, previousSeconds);
  return {
    event: { id: event.id, label: metric, sport: event.sport },
    isPb,
    previous_seconds: previousSeconds,
    tier: bestTierForTime(event, bestNow),
    rewardIds: tiersForTime(event, bestNow).map((t) => trophyRewardId(event.id, t)),
  };
}
