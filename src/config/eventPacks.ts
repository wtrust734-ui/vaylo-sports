// Vaylo Sports — Event Pack catalog (built-in source of truth).
// Admin rows in the `event_packs` table override or extend these entries.
// Prices and pack contents are intentionally preserved from the original catalog.

export type EventPackDifficulty = "Beginner" | "Intermediate" | "Advanced" | "Elite";

export type EventPackSection =
  | "featured"
  | "popular"
  | "beginner"
  | "new"
  | "seasonal"
  | "recommended";

export interface EventPack {
  id: string;
  name: string;
  sport: string;
  category: string;
  /** The event this pack prepares the athlete for. */
  targetEvent: string;
  /** Distance label where the event has one (e.g. "10K"). */
  distance: string | null;
  description: string;
  weeks: number;
  price: string;
  priceCents: number;
  difficulty: EventPackDifficulty;
  /** Who the plan is designed for. */
  designedFor: string;
  includes: string[];
  version: string;
  updatedAt: string;
  futureUpdatesIncluded: boolean;
  /** 0-100 deterministic popularity score used for sorting/badges. */
  popularity: number;
  sections: EventPackSection[];
  featured: boolean;
  retired: boolean;
}

export const EVENT_PACK_SPORTS = [
  "All", "Running", "Cycling", "Swimming", "Triathlon", "Football", "Basketball",
  "Tennis", "Rugby", "Boxing", "Athletics", "CrossFit", "Rowing", "Martial Arts",
  "Cricket", "Volleyball", "Hockey", "Badminton", "Gymnastics", "Wrestling",
];

export const EVENT_PACK_DIFFICULTIES: EventPackDifficulty[] = [
  "Beginner", "Intermediate", "Advanced", "Elite",
];

export const DESIGNED_FOR: Record<EventPackDifficulty, string> = {
  Beginner: "New athletes, or anyone taking on this event for the first time. Assumes little or no structured training background.",
  Intermediate: "Athletes training consistently who want a structured build towards a solid performance.",
  Advanced: "Experienced, competitive athletes chasing a personal best with high weekly training volume.",
  Elite: "High-performance athletes competing at regional level or above, training close to full-time.",
};

const BASE_INCLUDES = [
  "Complete training programme",
  "Week-by-week schedule",
  "Session-by-session breakdown",
  "Recovery guidance",
  "Event-day preparation",
  "Taper protocol",
  "Progression guidance",
  "Coaching notes",
];

const EXTRA_INCLUDES: Record<EventPackDifficulty, string[]> = {
  Beginner: ["Technique foundations", "Build-up milestones"],
  Intermediate: ["Pacing targets", "Cross-training sessions"],
  Advanced: ["Threshold & interval blocks", "Performance benchmarking"],
  Elite: ["Peaking & sharpening block", "Competition tactics", "Load monitoring guidance"],
};

const CATALOG_UPDATED = "2026-08-01";

function hashOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100000;
  return h;
}

function distanceOf(name: string): string | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s?(K|km|mi|m|M)\b/);
  if (!m) return null;
  return `${m[1]}${m[2].toLowerCase() === "mi" ? "mi" : m[2].toUpperCase()}`;
}

const TEMPLATES: { sport: string; events: { name: string; cat: string; weeks: number; price: number; desc: string }[] }[] = [
  { sport: "Running", events: [
    { name: "5K Race Prep", cat: "Road", weeks: 6, price: 1499, desc: "Complete 5K preparation with intervals, tempo runs & taper" },
    { name: "10K Race Prep", cat: "Road", weeks: 8, price: 1999, desc: "Build endurance and speed for your 10K goal" },
    { name: "Half Marathon", cat: "Road", weeks: 12, price: 2999, desc: "Full half marathon program with progressive long runs" },
    { name: "Marathon", cat: "Road", weeks: 16, price: 3999, desc: "Complete marathon training with periodisation & fuelling strategy" },
    { name: "Ultra Marathon 50K", cat: "Trail", weeks: 16, price: 4499, desc: "Ultra distance preparation with back-to-back long runs" },
    { name: "Ultra 100K", cat: "Trail", weeks: 20, price: 5999, desc: "Extreme distance prep with night running and nutrition" },
    { name: "Trail 10K", cat: "Trail", weeks: 8, price: 1999, desc: "Trail-specific strength and technical running" },
    { name: "Sprint Speed Camp", cat: "Track", weeks: 4, price: 1299, desc: "Explosive speed development for 100-400m events" },
    { name: "800m Specialist", cat: "Track", weeks: 8, price: 1999, desc: "Lactate threshold and speed endurance for 800m" },
    { name: "1500m Peak", cat: "Track", weeks: 8, price: 1999, desc: "VO2max and race tactics for the 1500m" },
    { name: "3000m Steeplechase", cat: "Track", weeks: 10, price: 2499, desc: "Barrier technique and water jump preparation" },
    { name: "5000m Track", cat: "Track", weeks: 10, price: 2499, desc: "Track-specific 5K with interval sessions" },
    { name: "10000m Track", cat: "Track", weeks: 12, price: 2999, desc: "High-mileage track preparation" },
    { name: "Cross Country Season", cat: "XC", weeks: 12, price: 2999, desc: "Hill work, mud running and XC race prep" },
    { name: "Parkrun PB", cat: "Road", weeks: 6, price: 1299, desc: "Targeted 5K parkrun personal best plan" },
  ]},
  { sport: "Cycling", events: [
    { name: "Century Ride 100mi", cat: "Road", weeks: 12, price: 2999, desc: "Build to 100 miles with endurance base and nutrition" },
    { name: "Gran Fondo", cat: "Road", weeks: 10, price: 2499, desc: "Climbing and endurance for gran fondo events" },
    { name: "Criterium Racing", cat: "Road", weeks: 8, price: 1999, desc: "Short sharp racing with cornering and sprinting" },
    { name: "Time Trial", cat: "Road", weeks: 8, price: 1999, desc: "FTP and aerodynamic position for TT events" },
    { name: "Hill Climb Season", cat: "Road", weeks: 8, price: 1999, desc: "Power-to-weight and climbing technique" },
    { name: "MTB XC Race", cat: "MTB", weeks: 10, price: 2499, desc: "Technical skills and off-road endurance" },
    { name: "MTB Enduro", cat: "MTB", weeks: 10, price: 2499, desc: "Downhill skills with climbing fitness" },
    { name: "Track Cycling Sprint", cat: "Track", weeks: 8, price: 1999, desc: "Explosive power for velodrome sprinting" },
    { name: "Track Pursuit", cat: "Track", weeks: 10, price: 2499, desc: "Sustained power for individual pursuit" },
    { name: "Gravel 100K", cat: "Gravel", weeks: 10, price: 2499, desc: "Mixed terrain endurance and bike handling" },
    { name: "Sportive 80mi", cat: "Road", weeks: 10, price: 2499, desc: "Long-distance sportive preparation" },
    { name: "Cycle Tour Stage", cat: "Road", weeks: 12, price: 2999, desc: "Multi-day touring with back-to-back rides" },
  ]},
  { sport: "Swimming", events: [
    { name: "50m Sprint", cat: "Pool", weeks: 6, price: 1499, desc: "Explosive starts and underwater technique" },
    { name: "100m Freestyle", cat: "Pool", weeks: 8, price: 1999, desc: "Sprint endurance and turn technique" },
    { name: "200m IM", cat: "Pool", weeks: 8, price: 1999, desc: "All four strokes with race strategy" },
    { name: "400m Freestyle", cat: "Pool", weeks: 10, price: 2499, desc: "Aerobic swimming with pace control" },
    { name: "1500m Freestyle", cat: "Pool", weeks: 12, price: 2999, desc: "Distance swimming with drafting and pacing" },
    { name: "Open Water 1K", cat: "Open Water", weeks: 8, price: 1999, desc: "Sighting, drafting and open water skills" },
    { name: "Open Water 5K", cat: "Open Water", weeks: 12, price: 2999, desc: "Endurance swimming with cold water prep" },
    { name: "Open Water 10K", cat: "Open Water", weeks: 16, price: 3999, desc: "Marathon swimming with feeding strategy" },
    { name: "Channel Crossing", cat: "Open Water", weeks: 20, price: 5999, desc: "Ultimate open water challenge preparation" },
    { name: "Masters Meet", cat: "Pool", weeks: 8, price: 1999, desc: "Multi-event preparation for masters swimming" },
  ]},
  { sport: "Triathlon", events: [
    { name: "Sprint Triathlon", cat: "Multi", weeks: 8, price: 2499, desc: "750m swim, 20K bike, 5K run preparation" },
    { name: "Olympic Triathlon", cat: "Multi", weeks: 12, price: 3499, desc: "1.5K swim, 40K bike, 10K run with transitions" },
    { name: "Half Ironman 70.3", cat: "Multi", weeks: 16, price: 4999, desc: "Full 70.3 preparation with brick sessions" },
    { name: "Ironman Full", cat: "Multi", weeks: 20, price: 6999, desc: "Complete Ironman preparation over 20 weeks" },
    { name: "Super Sprint", cat: "Multi", weeks: 6, price: 1999, desc: "Short course triathlon for beginners" },
    { name: "Duathlon", cat: "Multi", weeks: 8, price: 2499, desc: "Run-bike-run specific preparation" },
    { name: "Aquathlon", cat: "Multi", weeks: 6, price: 1999, desc: "Swim-run event preparation" },
    { name: "Off-Road Tri", cat: "Multi", weeks: 10, price: 2999, desc: "MTB and trail running triathlon" },
  ]},
  { sport: "Football", events: [
    { name: "Pre-Season Camp", cat: "Team", weeks: 6, price: 1499, desc: "Fitness base, agility and match readiness" },
    { name: "In-Season Maintenance", cat: "Team", weeks: 12, price: 2999, desc: "Maintain fitness during competitive season" },
    { name: "Speed & Agility", cat: "Performance", weeks: 6, price: 1499, desc: "Quick feet, change of direction, acceleration" },
    { name: "Striker Finishing", cat: "Skills", weeks: 6, price: 1499, desc: "Shooting technique and positioning" },
    { name: "Goalkeeper Camp", cat: "Skills", weeks: 6, price: 1499, desc: "Reflexes, distribution and positioning" },
    { name: "Defensive Masterclass", cat: "Skills", weeks: 6, price: 1499, desc: "Tackling, heading and tactical awareness" },
    { name: "Midfield Engine", cat: "Performance", weeks: 8, price: 1999, desc: "Box-to-box fitness and passing under pressure" },
    { name: "Tournament Prep", cat: "Team", weeks: 4, price: 1299, desc: "Peak for cup or tournament schedule" },
    { name: "Youth Development", cat: "Skills", weeks: 8, price: 1999, desc: "Technical foundation for U18 players" },
    { name: "Trial Preparation", cat: "Performance", weeks: 4, price: 1299, desc: "Physical tests and showcase readiness" },
    { name: "Winger Pace & Crossing", cat: "Skills", weeks: 6, price: 1499, desc: "1v1 beating, crossing accuracy and end product" },
    { name: "Set Piece Mastery", cat: "Tactical", weeks: 4, price: 1299, desc: "Free kicks, corners and throw-in routines" },
    { name: "Recovery Between Matches", cat: "Performance", weeks: 8, price: 1999, desc: "2-game weeks: managing load and staying fresh" },
    { name: "Strength for Football", cat: "Performance", weeks: 8, price: 1999, desc: "Lower body power, injury prevention & core stability" },
    { name: "Passing & Vision", cat: "Skills", weeks: 6, price: 1499, desc: "Short passing, long balls, through balls and game reading" },
  ]},
  { sport: "Basketball", events: [
    { name: "Pre-Season", cat: "Team", weeks: 6, price: 1499, desc: "Court fitness, shooting drills and conditioning" },
    { name: "Vertical Leap Program", cat: "Performance", weeks: 8, price: 1999, desc: "Plyometrics and explosive power for dunking" },
    { name: "Shooting Camp", cat: "Skills", weeks: 6, price: 1499, desc: "Three-point and mid-range accuracy" },
    { name: "Guard Skills", cat: "Skills", weeks: 6, price: 1499, desc: "Ball handling, court vision, passing" },
    { name: "Post Play", cat: "Skills", weeks: 6, price: 1499, desc: "Low-post moves, rebounding, footwork" },
    { name: "Defensive Intensity", cat: "Performance", weeks: 6, price: 1499, desc: "On-ball and off-ball defence drills" },
    { name: "Tournament Ready", cat: "Team", weeks: 4, price: 1299, desc: "Peak conditioning for tournament play" },
    { name: "Fast Break & Transition", cat: "Tactical", weeks: 6, price: 1499, desc: "Outlet passes, lanes, finishing at pace" },
    { name: "Free Throw & Clutch", cat: "Skills", weeks: 4, price: 1299, desc: "Mental focus and routine for pressure shots" },
    { name: "Court Endurance", cat: "Performance", weeks: 8, price: 1999, desc: "Sustained high intensity over 4 quarters" },
  ]},
  { sport: "Tennis", events: [
    { name: "Serve & Volley", cat: "Skills", weeks: 6, price: 1499, desc: "Serve technique, approach shots and net play" },
    { name: "Clay Court Season", cat: "Tactical", weeks: 8, price: 1999, desc: "Slide movement and heavy topspin rallies" },
    { name: "Hard Court Prep", cat: "Tactical", weeks: 8, price: 1999, desc: "Flat shots, quick exchanges and footwork" },
    { name: "Tournament Block", cat: "Performance", weeks: 6, price: 1499, desc: "Match-play conditioning and recovery between matches" },
    { name: "Return of Serve", cat: "Skills", weeks: 4, price: 1299, desc: "Read, react and neutralise the serve" },
    { name: "Fitness for Tennis", cat: "Performance", weeks: 8, price: 1999, desc: "Court-specific agility, endurance and power" },
    { name: "Doubles Strategy", cat: "Tactical", weeks: 4, price: 1299, desc: "Communication, positioning and poach plays" },
    { name: "Baseline Domination", cat: "Skills", weeks: 6, price: 1499, desc: "Heavy groundstrokes, angle play and rally construction" },
    { name: "Mental Toughness", cat: "Performance", weeks: 4, price: 1299, desc: "Handling pressure points, momentum swings and self-talk" },
    { name: "Junior Development", cat: "Skills", weeks: 8, price: 1999, desc: "Technical foundation and match play for young players" },
  ]},
  { sport: "Rugby", events: [
    { name: "Pre-Season Beast Mode", cat: "Team", weeks: 8, price: 1999, desc: "Raw strength, conditioning and contact prep" },
    { name: "Scrum Power", cat: "Position", weeks: 6, price: 1499, desc: "Front row strength and scrummaging technique" },
    { name: "Back Line Speed", cat: "Position", weeks: 6, price: 1499, desc: "Sprint speed, passing accuracy and evasion" },
    { name: "Breakdown Master", cat: "Skills", weeks: 6, price: 1499, desc: "Ruck, maul and jackalling technique" },
    { name: "Kicking Game", cat: "Skills", weeks: 6, price: 1499, desc: "Goal kicking, restarts and tactical kicking" },
    { name: "Sevens Prep", cat: "Team", weeks: 6, price: 1499, desc: "High-intensity intervals for 7-a-side rugby" },
    { name: "Injury Prevention", cat: "Performance", weeks: 8, price: 1999, desc: "Prehab, neck strength and mobility" },
    { name: "Lineout Mastery", cat: "Skills", weeks: 4, price: 1299, desc: "Lifting, jumping, timing and calling" },
    { name: "Tackle Technique", cat: "Skills", weeks: 6, price: 1499, desc: "Safe and effective tackling, chop and dominant" },
    { name: "Fly-Half Playmaker", cat: "Position", weeks: 8, price: 1999, desc: "Decision making, distribution, running lines" },
  ]},
  { sport: "Boxing", events: [
    { name: "White Collar Fight Prep", cat: "Fight", weeks: 8, price: 1999, desc: "Technical boxing and conditioning for first fight" },
    { name: "Amateur Fight Camp", cat: "Fight", weeks: 10, price: 2499, desc: "Structured camp with sparring peaking" },
    { name: "Conditioning Block", cat: "Performance", weeks: 6, price: 1499, desc: "Gas tank, power endurance and recovery" },
    { name: "Technical Sparring", cat: "Skills", weeks: 8, price: 1999, desc: "Combinations, counter punching and ring IQ" },
    { name: "Weight Cut Protocol", cat: "Performance", weeks: 4, price: 1299, desc: "Safe weight management for competition" },
    { name: "Heavy Bag Mastery", cat: "Skills", weeks: 6, price: 1499, desc: "Power shots, combos and footwork on the bag" },
    { name: "Defence & Head Movement", cat: "Skills", weeks: 6, price: 1499, desc: "Slip, roll, block and counter techniques" },
  ]},
  { sport: "Athletics", events: [
    { name: "100m Sprint", cat: "Sprint", weeks: 8, price: 1999, desc: "Starts, drive phase and maximum velocity" },
    { name: "200m Sprint", cat: "Sprint", weeks: 8, price: 1999, desc: "Bend running and speed endurance" },
    { name: "400m Sprint", cat: "Sprint", weeks: 10, price: 2499, desc: "Lactate tolerance and race distribution" },
    { name: "High Jump", cat: "Field", weeks: 8, price: 1999, desc: "Approach, takeoff and Fosbury flop technique" },
    { name: "Long Jump", cat: "Field", weeks: 8, price: 1999, desc: "Run-up consistency and flight technique" },
    { name: "Shot Put", cat: "Field", weeks: 8, price: 1999, desc: "Glide and rotational technique with power" },
    { name: "Javelin Throw", cat: "Field", weeks: 8, price: 1999, desc: "Run-up, release point and technique" },
    { name: "Discus Throw", cat: "Field", weeks: 8, price: 1999, desc: "Rotation technique and release" },
    { name: "Pole Vault", cat: "Field", weeks: 10, price: 2499, desc: "Plant, takeoff and bar clearance" },
    { name: "Decathlon/Heptathlon", cat: "Multi", weeks: 12, price: 2999, desc: "Multi-event training across all disciplines" },
    { name: "Hurdles 110m/100m", cat: "Sprint", weeks: 8, price: 1999, desc: "Hurdle technique, trail leg and rhythm" },
    { name: "400m Hurdles", cat: "Sprint", weeks: 10, price: 2499, desc: "Stride pattern and hurdle endurance" },
  ]},
  { sport: "CrossFit", events: [
    { name: "CrossFit Open Prep", cat: "Competition", weeks: 8, price: 1999, desc: "Benchmark WODs, skills and competition strategy" },
    { name: "Muscle-Up Journey", cat: "Skills", weeks: 8, price: 1999, desc: "Bar and ring muscle-ups progression" },
    { name: "Olympic Lifting", cat: "Strength", weeks: 8, price: 1999, desc: "Snatch and clean & jerk technique" },
    { name: "Engine Builder", cat: "Performance", weeks: 8, price: 1999, desc: "Aerobic capacity for longer WODs" },
    { name: "Competitor Camp", cat: "Competition", weeks: 12, price: 2999, desc: "Multi-modal training for regional competition" },
    { name: "Handstand Walk", cat: "Skills", weeks: 6, price: 1499, desc: "Balance, kick-up and obstacle walks" },
  ]},
  { sport: "Rowing", events: [
    { name: "2K Erg Test", cat: "Indoor", weeks: 8, price: 1999, desc: "Peak power and pacing for the 2K" },
    { name: "Head Race Season", cat: "On Water", weeks: 10, price: 2499, desc: "Long-distance racing technique and fitness" },
    { name: "Sprint Regatta", cat: "On Water", weeks: 8, price: 1999, desc: "500m/1000m explosive race preparation" },
    { name: "Sculling Technique", cat: "Skills", weeks: 6, price: 1499, desc: "Single and double scull refinement" },
    { name: "Indoor Rowing Challenge", cat: "Indoor", weeks: 6, price: 1499, desc: "Training for indoor rowing competitions" },
  ]},
  { sport: "Martial Arts", events: [
    { name: "MMA Fight Camp", cat: "Fight", weeks: 10, price: 2499, desc: "Striking, grappling and conditioning for MMA" },
    { name: "BJJ Competition", cat: "Grappling", weeks: 8, price: 1999, desc: "Submission game and tournament conditioning" },
    { name: "Muay Thai Fight", cat: "Striking", weeks: 8, price: 1999, desc: "Clinch work, kicks, knees and elbows" },
    { name: "Karate Tournament", cat: "Striking", weeks: 6, price: 1499, desc: "Kata and kumite preparation" },
    { name: "Judo Competition", cat: "Grappling", weeks: 8, price: 1999, desc: "Throw technique and groundwork" },
    { name: "Kickboxing Camp", cat: "Striking", weeks: 8, price: 1999, desc: "Combinations, leg kicks and movement" },
  ]},
  { sport: "Cricket", events: [
    { name: "Fast Bowling Camp", cat: "Skills", weeks: 8, price: 1999, desc: "Run-up, action and pace generation" },
    { name: "Batting Masterclass", cat: "Skills", weeks: 8, price: 1999, desc: "Footwork, shot selection and match simulation" },
    { name: "Spin Bowling", cat: "Skills", weeks: 6, price: 1499, desc: "Turn, flight and variations" },
    { name: "Fielding Excellence", cat: "Skills", weeks: 6, price: 1499, desc: "Catching, throwing and ground fielding" },
    { name: "T20 Specialist", cat: "Tactical", weeks: 6, price: 1499, desc: "Power hitting, death bowling and field settings" },
    { name: "Pre-Season Fitness", cat: "Performance", weeks: 8, price: 1999, desc: "Cricket-specific conditioning and mobility" },
  ]},
  { sport: "Volleyball", events: [
    { name: "Beach Volleyball", cat: "Outdoor", weeks: 8, price: 1999, desc: "Sand movement, setting and spiking" },
    { name: "Indoor Season Prep", cat: "Team", weeks: 8, price: 1999, desc: "Hitting, blocking and serve receive" },
    { name: "Vertical Jump", cat: "Performance", weeks: 6, price: 1499, desc: "Plyometrics for higher net play" },
    { name: "Setting Mastery", cat: "Skills", weeks: 6, price: 1499, desc: "Hand position, decision making and deception" },
    { name: "Serving Power", cat: "Skills", weeks: 4, price: 1299, desc: "Jump serve, float serve and placement" },
    { name: "Libero Defence", cat: "Position", weeks: 6, price: 1499, desc: "Digging, reading hitters and court coverage" },
  ]},
  { sport: "Hockey", events: [
    { name: "Pre-Season Camp", cat: "Team", weeks: 6, price: 1499, desc: "Fitness, stick skills and match conditioning" },
    { name: "Drag Flick", cat: "Skills", weeks: 6, price: 1499, desc: "Penalty corner drag flick technique" },
    { name: "Goalkeeper Specialist", cat: "Position", weeks: 6, price: 1499, desc: "Reflexes, aerial shots and one-on-ones" },
    { name: "Speed & Endurance", cat: "Performance", weeks: 8, price: 1999, desc: "Repeated sprint ability for hockey" },
    { name: "Midfield Control", cat: "Skills", weeks: 6, price: 1499, desc: "Trapping, passing and game management" },
    { name: "Defensive Structure", cat: "Tactical", weeks: 6, price: 1499, desc: "Zone defence, marking and pressing" },
  ]},
  { sport: "Badminton", events: [
    { name: "Singles Tournament", cat: "Competition", weeks: 6, price: 1499, desc: "Court coverage, deception and match fitness" },
    { name: "Doubles Strategy", cat: "Tactical", weeks: 6, price: 1499, desc: "Front-back and side-by-side formations" },
    { name: "Smash Power", cat: "Skills", weeks: 4, price: 1299, desc: "Overhead technique and power generation" },
    { name: "Footwork Camp", cat: "Performance", weeks: 6, price: 1499, desc: "Split step, lunge and recovery movement" },
    { name: "Net Play", cat: "Skills", weeks: 4, price: 1299, desc: "Net kills, drops, lifts and tight spinning" },
    { name: "Deception & Trick Shots", cat: "Skills", weeks: 4, price: 1299, desc: "Disguised shots and wrong-footing opponents" },
  ]},
  { sport: "Gymnastics", events: [
    { name: "Floor Routine", cat: "Apparatus", weeks: 10, price: 2499, desc: "Tumbling, dance and routine composition" },
    { name: "Vault Prep", cat: "Apparatus", weeks: 8, price: 1999, desc: "Run-up, board contact and flight" },
    { name: "Bars Progression", cat: "Apparatus", weeks: 10, price: 2499, desc: "Grip, swing and release moves" },
    { name: "Flexibility & Strength", cat: "Performance", weeks: 8, price: 1999, desc: "Splits, bridges and core power" },
    { name: "Beam Confidence", cat: "Apparatus", weeks: 8, price: 1999, desc: "Balance, turns, leaps and dismounts" },
    { name: "Rings Mastery", cat: "Apparatus", weeks: 10, price: 2499, desc: "Strength holds, swings and dismounts" },
  ]},
  { sport: "Wrestling", events: [
    { name: "Freestyle Competition", cat: "Competition", weeks: 8, price: 1999, desc: "Takedowns, defence and mat wrestling" },
    { name: "Greco-Roman Prep", cat: "Competition", weeks: 8, price: 1999, desc: "Upper body throws and clinch work" },
    { name: "Strength & Power", cat: "Performance", weeks: 8, price: 1999, desc: "Wrestling-specific strength training" },
    { name: "Weight Management", cat: "Performance", weeks: 4, price: 1299, desc: "Safe weight cutting and recovery protocol" },
    { name: "Conditioning & Gas Tank", cat: "Performance", weeks: 6, price: 1499, desc: "6-minute match endurance and recovery" },
    { name: "Takedown Clinic", cat: "Skills", weeks: 6, price: 1499, desc: "Single leg, double leg, snap down and ankle pick" },
  ]},
];


function build(): EventPack[] {
  const packs: EventPack[] = [];
  let idCounter = 0;

  for (const group of TEMPLATES) {
    for (const evt of group.events) {
      for (const diff of EVENT_PACK_DIFFICULTIES) {
        const id = `ep_${idCounter}`;
        const h = hashOf(id + evt.name);
        const popularity = h % 101;
        const sections: EventPackSection[] = [];
        if (h % 19 === 0) sections.push("featured");
        if (popularity >= 82) sections.push("popular");
        if (diff === "Beginner") sections.push("beginner");
        if (h % 23 === 0) sections.push("new");
        if (h % 29 === 0) sections.push("seasonal");

        packs.push({
          id,
          name: `${evt.name} — ${diff}`,
          sport: group.sport,
          category: evt.cat,
          targetEvent: evt.name,
          distance: distanceOf(evt.name),
          description: evt.desc,
          weeks: evt.weeks,
          price: `$${(evt.price / 100).toFixed(2)}`,
          priceCents: evt.price,
          difficulty: diff,
          designedFor: DESIGNED_FOR[diff],
          includes: [...BASE_INCLUDES, ...EXTRA_INCLUDES[diff]],
          version: diff === "Elite" ? "2.1" : "2.0",
          updatedAt: CATALOG_UPDATED,
          futureUpdatesIncluded: true,
          popularity,
          sections,
          featured: sections.includes("featured"),
          retired: false,
        });
        idCounter++;
      }
    }
  }
  return packs;
}

export const BUILT_IN_EVENT_PACKS: EventPack[] = build();

export function formatPackPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
