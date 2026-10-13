// ============================================================================
// ELITE COMPARISON PROFILES
// ----------------------------------------------------------------------------
// The targets an athlete can stack their VPR against on /compare.
//
// Two separate things live in every row and they must not be confused:
//
//   * The ATHLETE AND EVENT are real and verifiable. Every name below is the
//     athlete most associated with that specific event, and `credential` states
//     the record or title that makes them the benchmark for it. A 800m runner
//     compares against an 800m runner, not against a marathoner.
//
//   * The 0–100 INDICES are illustrative, not measurements of that person.
//     Vaylo has never measured Usain Bolt; the six sub-indices are a stylised
//     shape of what that event demands, on the same 0–100 scale the athlete's
//     own VPR uses, so the radar is a directional prompt rather than a claim
//     about anyone's biometrics. The screen repeats that in words.
//
// The event list is deliberately wide: an athlete should find their own event
// in almost every sport, not only the four the app happened to ship with.
// ============================================================================

import type { VPRScores } from "./performance";

export interface EliteProfile {
  /** Stable id used for the "already unlocked" check. Never reuse one. */
  id: string;
  /** Sport family this target belongs to, for the filter chips. */
  group: string;
  /** The event, stated the way a scoresheet states it. */
  event: string;
  name: string;
  country: string;
  /** The verified achievement that justifies calling them elite in this event. */
  credential: string;
  profile: VPRScores;
}

/** Sport filter groups, and the profile-sport tokens that select them. */
export const ELITE_GROUPS: Array<{ group: string; sportKeys: string[] }> = [
  { group: "Athletics", sportKeys: ["Athletics", "Sprinting", "Running"] },
  { group: "Swimming", sportKeys: ["Swimming"] },
  { group: "Cycling", sportKeys: ["Cycling"] },
  { group: "Triathlon", sportKeys: ["Triathlon"] },
  { group: "Rowing", sportKeys: ["Rowing"] },
  {
    group: "Team sports",
    sportKeys: [
      "Football", "Basketball", "Rugby", "Cricket", "Hockey", "Volleyball",
      "Handball", "Baseball", "American football", "American Football",
    ],
  },
  { group: "Racket sports", sportKeys: ["Tennis", "Table tennis", "Badminton"] },
  { group: "Combat sports", sportKeys: ["Boxing", "MMA", "Judo", "Taekwondo", "Fencing"] },
  { group: "Strength sports", sportKeys: ["Weightlifting", "Gym/Weightlifting", "Powerlifting", "CrossFit"] },
  { group: "Gymnastics", sportKeys: ["Gymnastics"] },
  { group: "Climbing", sportKeys: ["Climbing"] },
  { group: "Winter sports", sportKeys: ["Skiing", "Alpine skiing", "Cross-country skiing", "Speed skating"] },
  {
    group: "Motorsport & outdoor",
    sportKeys: ["Formula 1", "Motorsport", "Sailing", "Archery", "Surfing", "Skateboarding", "Golf"],
  },
];

/** overall = the mean of the six indices, so it can never drift from them. */
const score = (
  speed_index: number,
  power_index: number,
  endurance_capacity: number,
  repeatability: number,
  skill_consistency: number,
  reaction_efficiency: number,
): VPRScores => ({
  speed_index,
  power_index,
  endurance_capacity,
  repeatability,
  skill_consistency,
  reaction_efficiency,
  overall_vpr: Math.round(
    (speed_index + power_index + endurance_capacity + repeatability + skill_consistency + reaction_efficiency) / 6,
  ),
});

type Row = [id: string, group: string, event: string, name: string, country: string, credential: string, scores: number[]];

const ROWS: Row[] = [
  // ── Athletics — track ────────────────────────────────────────────────────
  ["athletics-100m", "Athletics", "100m", "Usain Bolt", "Jamaica", "World record 9.58s (2009)", [100, 96, 52, 84, 86, 92]],
  ["athletics-200m", "Athletics", "200m", "Usain Bolt", "Jamaica", "World record 19.19s (2009)", [98, 94, 60, 86, 86, 90]],
  ["athletics-400m", "Athletics", "400m", "Wayde van Niekerk", "South Africa", "World record 43.03s, 2016 Olympic gold", [95, 90, 80, 92, 85, 82]],
  ["athletics-800m", "Athletics", "800m", "David Rudisha", "Kenya", "World record 1:40.91 while winning 2012 Olympic gold", [88, 80, 96, 94, 88, 80]],
  ["athletics-1500m", "Athletics", "1500m", "Hicham El Guerrouj", "Morocco", "World record 3:26.00 (1998)", [80, 70, 99, 96, 90, 78]],
  ["athletics-5000m", "Athletics", "5000m", "Joshua Cheptegei", "Uganda", "World record 12:35.36 (2020)", [78, 66, 100, 97, 90, 74]],
  ["athletics-10000m", "Athletics", "10000m", "Joshua Cheptegei", "Uganda", "World record 26:11.00 (2020)", [76, 62, 100, 97, 90, 72]],
  ["athletics-marathon", "Athletics", "Marathon", "Kelvin Kiptum", "Kenya", "World record 2:00:35, Chicago Marathon (2023)", [72, 58, 100, 98, 90, 70]],
  ["athletics-110mh", "Athletics", "110m hurdles", "Aries Merritt", "United States", "World record 12.80s (2012)", [96, 90, 70, 88, 96, 94]],
  ["athletics-400mh", "Athletics", "400m hurdles", "Karsten Warholm", "Norway", "World record 45.94s, Tokyo 2020 gold", [93, 90, 90, 94, 92, 86]],

  // ── Athletics — field ────────────────────────────────────────────────────
  ["athletics-longjump", "Athletics", "Long jump", "Mike Powell", "United States", "World record 8.95m (1991)", [95, 94, 60, 86, 90, 88]],
  ["athletics-highjump", "Athletics", "High jump", "Javier Sotomayor", "Cuba", "World record 2.45m (1993)", [80, 92, 55, 82, 88, 86]],
  ["athletics-polevault", "Athletics", "Pole vault", "Armand Duplantis", "Sweden", "Multiple world records; Olympic gold 2020 and 2024", [90, 90, 65, 86, 95, 88]],
  ["athletics-shotput", "Athletics", "Shot put", "Ryan Crouser", "United States", "World record 23.56m (2023)", [66, 100, 50, 88, 82, 78]],
  ["athletics-javelin", "Athletics", "Javelin", "Jan Železný", "Czech Republic", "World record 98.48m (1996)", [82, 96, 55, 84, 90, 84]],
  ["athletics-decathlon", "Athletics", "Decathlon", "Kevin Mayer", "France", "World record 9,126 points (2018)", [86, 90, 90, 90, 90, 86]],

  // ── Swimming ─────────────────────────────────────────────────────────────
  ["swim-50free", "Swimming", "50m freestyle", "Cameron McEvoy", "Australia", "Long-course world record 20.88s (2026)", [98, 94, 55, 84, 90, 86]],
  ["swim-100free", "Swimming", "100m freestyle", "Pan Zhanle", "China", "World record 46.40s, Paris 2024 gold", [96, 92, 72, 88, 90, 86]],
  ["swim-200free", "Swimming", "200m freestyle", "Paul Biedermann", "Germany", "World record 1:42.00 (2009)", [90, 92, 90, 90, 88, 80]],
  ["swim-100fly", "Swimming", "100m butterfly", "Caeleb Dressel", "United States", "World record 49.45s (2021)", [94, 92, 78, 90, 92, 86]],
  ["swim-200im", "Swimming", "200m individual medley", "Léon Marchand", "France", "World record 1:52.69 (2025 World Championships)", [88, 88, 94, 94, 94, 84]],
  ["swim-800free", "Swimming", "800m freestyle", "Katie Ledecky", "United States", "Olympic 800m freestyle gold at four Games", [74, 70, 100, 97, 92, 72]],
  ["swim-1500free", "Swimming", "1500m freestyle", "Katie Ledecky", "United States", "World record 15:20.48 (2018)", [72, 68, 100, 97, 92, 70]],
  ["swim-10k", "Swimming", "Open water 10km", "Sharon van Rouwendaal", "Netherlands", "Olympic 10km gold 2016 and 2024", [76, 72, 99, 96, 90, 74]],

  // ── Cycling ──────────────────────────────────────────────────────────────
  ["cycling-road", "Cycling", "Road race", "Tadej Pogačar", "Slovenia", "2024 UCI road race world champion", [78, 92, 100, 96, 88, 74]],
  ["cycling-tt", "Cycling", "Time trial", "Remco Evenepoel", "Belgium", "Olympic time-trial gold, Paris 2024", [82, 94, 96, 94, 88, 74]],
  ["cycling-track-sprint", "Cycling", "Track sprint / keirin", "Harrie Lavreysen", "Netherlands", "Three golds at Paris 2024, incl. sprint and keirin", [90, 98, 72, 90, 90, 86]],
  ["cycling-track-endurance", "Cycling", "Track endurance (omnium)", "Laura Kenny", "Great Britain", "Olympic omnium gold 2012 and 2016", [80, 84, 96, 96, 90, 80]],
  ["cycling-mtb", "Cycling", "Mountain bike XC", "Nino Schurter", "Switzerland", "Olympic XC gold 2016; multiple world titles", [82, 88, 98, 94, 92, 84]],
  ["cycling-bmx", "Cycling", "BMX racing", "Mariana Pajón", "Colombia", "Olympic BMX racing gold 2012 and 2016", [92, 92, 70, 88, 90, 92]],

  // ── Triathlon ────────────────────────────────────────────────────────────
  ["tri-olympic", "Triathlon", "Olympic distance", "Alistair Brownlee", "Great Britain", "Olympic triathlon gold 2012 and 2016", [84, 80, 98, 96, 90, 78]],
  ["tri-ironman", "Triathlon", "Ironman", "Jan Frodeno", "Germany", "Three-time IRONMAN World Champion", [76, 76, 100, 97, 88, 72]],

  // ── Rowing ───────────────────────────────────────────────────────────────
  ["rowing-1x", "Rowing", "Single sculls", "Mahé Drysdale", "New Zealand", "Olympic single-sculls gold, London 2012 and Rio 2016", [78, 92, 98, 96, 92, 76]],

  // ── Team sports ──────────────────────────────────────────────────────────
  ["football", "Team sports", "Football", "Lionel Messi", "Argentina", "2022 World Cup winner; record eight Ballon d'Or", [90, 82, 86, 90, 98, 92]],
  ["basketball", "Team sports", "Basketball", "Michael Jordan", "United States", "Six NBA championships, six Finals MVPs", [88, 94, 82, 90, 96, 94]],
  ["rugby", "Team sports", "Rugby union", "Richie McCaw", "New Zealand", "Captained New Zealand to two Rugby World Cups", [80, 92, 88, 94, 90, 84]],
  ["cricket", "Team sports", "Cricket", "Sachin Tendulkar", "India", "First to score 100 international centuries", [78, 84, 88, 92, 97, 90]],
  ["hockey", "Team sports", "Field hockey", "Dhyan Chand", "India", "Three Olympic golds with India", [82, 86, 86, 88, 95, 88]],
  ["volleyball", "Team sports", "Indoor volleyball", "Karch Kiraly", "United States", "Olympic indoor gold 1984 and 1988", [84, 88, 90, 90, 94, 88]],
  ["handball", "Team sports", "Handball", "Nikola Karabatić", "France", "Three Olympic golds", [80, 88, 90, 92, 94, 88]],
  ["baseball", "Team sports", "Baseball", "Shohei Ohtani", "Japan", "First MLB 50-home-run, 50-stolen-base season (2024)", [90, 96, 80, 88, 92, 88]],
  ["amfootball", "Team sports", "American football", "Tom Brady", "United States", "Record seven Super Bowl wins", [70, 78, 84, 92, 95, 94]],

  // ── Racket sports ────────────────────────────────────────────────────────
  ["tennis", "Racket sports", "Singles tennis", "Novak Djokovic", "Serbia", "24 Grand Slam singles titles", [82, 82, 92, 95, 97, 96]],
  ["tabletennis", "Racket sports", "Table tennis", "Ma Long", "China", "Olympic singles gold, Rio 2016 and Tokyo 2020", [90, 84, 82, 90, 97, 96]],
  ["badminton", "Racket sports", "Badminton", "Lin Dan", "China", "Consecutive Olympic men's singles golds 2008 and 2012", [92, 88, 86, 90, 95, 94]],

  // ── Combat sports ────────────────────────────────────────────────────────
  ["boxing", "Combat sports", "Heavyweight boxing", "Muhammad Ali", "United States", "Three-time world heavyweight champion", [86, 90, 84, 88, 94, 92]],
  ["mma", "Combat sports", "MMA (light heavyweight)", "Jon Jones", "United States", "UFC light-heavyweight champion; 11 title defences", [88, 94, 84, 90, 95, 90]],
  ["judo", "Combat sports", "Judo", "Teddy Riner", "France", "11-time world champion", [84, 98, 80, 90, 96, 88]],
  ["taekwondo", "Combat sports", "Taekwondo", "Jade Jones", "Great Britain", "Olympic gold 2012 and 2016", [90, 88, 82, 88, 94, 93]],
  ["fencing", "Combat sports", "Fencing (sabre)", "Mariel Zagunis", "United States", "Consecutive Olympic individual sabre golds 2004 and 2008", [90, 82, 80, 88, 97, 95]],

  // ── Strength ─────────────────────────────────────────────────────────────
  ["weightlifting", "Strength sports", "Weightlifting", "Lasha Talakhadze", "Georgia", "Olympic super-heavyweight gold 2016 and 2020", [62, 100, 60, 90, 84, 80]],

  // ── Gymnastics ───────────────────────────────────────────────────────────
  ["gymnastics", "Gymnastics", "Artistic gymnastics", "Simone Biles", "United States", "Seven-time Olympic gold medallist", [88, 92, 84, 90, 98, 92]],

  // ── Climbing ─────────────────────────────────────────────────────────────
  ["climbing", "Climbing", "Sport climbing", "Janja Garnbret", "Slovenia", "Olympic boulder & lead combined gold, Tokyo 2020 and Paris 2024", [84, 90, 86, 92, 98, 88]],

  // ── Winter ───────────────────────────────────────────────────────────────
  ["ski-alpine", "Winter sports", "Alpine skiing", "Mikaela Shiffrin", "United States", "100 career World Cup victories", [86, 88, 92, 94, 97, 94]],
  ["ski-xc", "Winter sports", "Cross-country skiing", "Marit Bjørgen", "Norway", "Eight Olympic golds; record 15 Olympic medals", [76, 84, 100, 98, 92, 78]],
  ["speed-skating", "Winter sports", "Speed skating", "Sven Kramer", "Netherlands", "Three consecutive Olympic 5000m golds (2010–2018)", [80, 88, 99, 97, 90, 78]],

  // ── Motorsport & outdoor ─────────────────────────────────────────────────
  ["f1", "Motorsport & outdoor", "Formula 1", "Lewis Hamilton", "United Kingdom", "Seven-time World Drivers' Champion", [90, 86, 92, 94, 95, 95]],
  ["sailing", "Motorsport & outdoor", "Sailing", "Ben Ainslie", "Great Britain", "Four consecutive Olympic golds (2000–2012)", [78, 84, 92, 94, 96, 92]],
  ["archery", "Motorsport & outdoor", "Archery", "Kim Soo-nyung", "South Korea", "Four Olympic golds across three Games", [70, 80, 88, 94, 97, 92]],
  ["surfing", "Motorsport & outdoor", "Surfing", "Kelly Slater", "United States", "11 world surfing titles", [86, 86, 88, 92, 96, 94]],
  ["skateboarding", "Motorsport & outdoor", "Street skateboarding", "Yuto Horigome", "Japan", "Olympic street gold 2020 and 2024", [92, 88, 86, 90, 96, 94]],
  ["golf", "Motorsport & outdoor", "Golf", "Tiger Woods", "United States", "15 major championships", [78, 92, 88, 90, 97, 92]],
];

export const ELITE_PROFILES: EliteProfile[] = ROWS.map(
  ([id, group, event, name, country, credential, s]) => ({
    id, group, event, name, country, credential,
    profile: score(s[0], s[1], s[2], s[3], s[4], s[5]),
  }),
);

/** Groups that actually have profiles, in declaration order. */
export const ELITE_GROUPS_WITH_PROFILES = ELITE_GROUPS.filter((g) =>
  ELITE_PROFILES.some((p) => p.group === g.group),
);

/**
 * The group an athlete's own sport belongs to, so the picker opens on their
 * event rather than on whatever happens to be first in the list.
 */
export function groupForSport(sport: string | null | undefined): string {
  const tokens = (sport ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const hit = ELITE_GROUPS.find((g) =>
      g.sportKeys.some((k) => k.toLowerCase() === token.toLowerCase()),
    );
    if (hit && ELITE_PROFILES.some((p) => p.group === hit.group)) return hit.group;
  }
  return ELITE_PROFILES[0].group;
}

export function profilesInGroup(group: string): EliteProfile[] {
  return ELITE_PROFILES.filter((p) => p.group === group);
}
