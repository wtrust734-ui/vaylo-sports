// VAYLO Learning — curated content library.
// Presentation-free structured data: the Learning UI reads only these exports,
// so new sports, categories and lessons can be added without touching page code.
// A future Supabase-backed store can replace LESSONS behind the same types.

export interface QuizQuestion {
  q: string;
  options: string[];
  correct: number; // index
}

export type LessonCategory =
  | "Technique"
  | "Training"
  | "Strength"
  | "Recovery"
  | "Nutrition"
  | "Psychology"
  | "Injury Prevention"
  | "Tactics"
  | "Equipment"
  // Legacy categories kept so existing rows render correctly; mapped below.
  | "Sport Science"
  | "Hybrid Athlete";

export type Difficulty = "Beginner" | "Developing" | "Intermediate" | "Advanced";
export type ContentType = "Article" | "Guide" | "Quick Learn" | "Technique" | "Explainer";

export interface Lesson {
  id: string;
  category: LessonCategory;
  title: string;
  duration: string;
  summary: string;
  body: string;
  quiz: QuizQuestion[];
  // Targeting — used by search and recommendations.
  sports?: string[]; // e.g. ["Football", "Rugby"]
  goals?: string[];  // e.g. ["Speed", "Power", "Endurance"]
  tags?: string[];   // lowercase search synonyms, e.g. ["800m", "middle distance"]
  difficulty?: Difficulty;
  contentType?: ContentType;
  takeaways?: string[];
  // Curated editorial popularity (static, honest metadata — not live telemetry).
  views?: number;
  saves?: number;
  trending?: boolean;
}

/** Presentation metadata stays separate from the lesson copy so new subjects
 * and sports can be added without changing the Learning page layout. */
export const LEARNING_CATEGORIES = [
  { id: "Technique", label: "Technique", description: "Learn the fundamentals and advanced techniques of your sport.", icon: "Crosshair" },
  { id: "Training", label: "Training", description: "Understand how to train effectively and structure progression.", icon: "Dumbbell" },
  { id: "Strength", label: "Strength", description: "Learn how strength and power transfer to sporting performance.", icon: "Zap" },
  { id: "Recovery", label: "Recovery", description: "Sleep, recovery, mobility, fatigue management and rest.", icon: "Moon" },
  { id: "Nutrition", label: "Nutrition", description: "The fundamentals of fuelling, hydration and nutrition for sport.", icon: "Apple" },
  { id: "Psychology", label: "Psychology", description: "Confidence, focus, competition preparation and mental skills.", icon: "Brain" },
  { id: "Injury Prevention", label: "Injury Prevention", description: "Understand common injury risks and ways to reduce training problems.", icon: "ShieldCheck" },
  { id: "Tactics", label: "Tactics", description: "Game and race strategy, decision-making and tactical knowledge.", icon: "Map" },
  { id: "Equipment", label: "Equipment", description: "Shoes, equipment, technology and how to use them effectively.", icon: "Footprints" },
] as const;

export const SPORTS = ["All Sports", "Running", "Football", "Basketball", "Tennis", "Swimming", "Cycling", "Athletics", "Rugby", "Golf", "Cricket", "Gymnastics", "Combat Sports", "More"] as const;

/** Sports with dedicated chips; anything else (Triathlon, CrossFit, MMA…) is reachable via "More". */
export const MAIN_SPORTS = ["Running", "Athletics", "Football", "Basketball", "Tennis", "Swimming", "Cycling", "Rugby", "Golf", "Cricket", "Gymnastics", "Combat Sports"];

/** Honest search-starters; matches real library content. */
export const TRENDING_SEARCHES = [
  "800m race tactics",
  "football finishing technique",
  "vertical jump",
  "how should I recover?",
  "progressive overload",
  "nerves before competition",
];

export const LEARNING_GOALS = [
  { id: "speed", title: "Get Faster", description: "Improve speed, acceleration and speed endurance.", terms: ["Speed", "Power", "Acceleration", "Sprinting"] },
  { id: "strength", title: "Get Stronger", description: "Build useful strength and power for your sport.", terms: ["Strength", "Power", "Muscle Gain"] },
  { id: "technique", title: "Improve Technique", description: "Fix weaknesses and learn better movement patterns.", terms: ["Technique", "Skill", "Movement"] },
  { id: "pressure", title: "Perform Under Pressure", description: "Competition preparation, confidence and focus.", terms: ["Psychology", "Mental", "Confidence", "Focus"] },
  { id: "recovery", title: "Recover Better", description: "Sleep, recovery, mobility and fatigue management.", terms: ["Recovery", "Sleep", "Fatigue"] },
  { id: "training", title: "Understand Your Training", description: "Learn what your workouts actually do.", terms: ["Training", "Endurance", "Overload", "Programming"] },
] as const;

/** Lesson category → goal mapping used when a lesson has no explicit goals. */
export const GOAL_CATEGORY_FALLBACK: Record<string, string[]> = {
  speed: ["Technique", "Training"],
  strength: ["Strength"],
  technique: ["Technique"],
  pressure: ["Psychology"],
  recovery: ["Recovery"],
  training: ["Training", "Injury Prevention"],
};

// ---- Shared classification helpers (single source for page + engine + reader) ----

/** Maps legacy categories onto the nine presentation categories. */
export const categoryFor = (lesson: Lesson): string =>
  lesson.category === "Sport Science" ? "Training" : lesson.category === "Hybrid Athlete" ? "Strength" : lesson.category;

export const readMinutes = (lesson: Lesson): number => Number.parseInt(lesson.duration, 10) || 4;

export const difficultyFor = (lesson: Lesson): Difficulty =>
  lesson.difficulty ?? (readMinutes(lesson) <= 3 ? "Beginner" : readMinutes(lesson) >= 5 ? "Intermediate" : "Developing");

export const typeFor = (lesson: Lesson): ContentType =>
  lesson.contentType ?? (readMinutes(lesson) <= 3 ? "Quick Learn" : lesson.category === "Technique" ? "Technique" : "Article");

export const CATEGORIES = ["Technique", "Recovery", "Nutrition", "Sport Science", "Hybrid Athlete"] as const;

export const LESSONS: Lesson[] = [
  // ==================== EXISTING LIBRARY (preserved) ====================

  // ---- Technique ----
  { id: "tech-001", category: "Technique", title: "The Universal Athletic Stance", duration: "4 min", summary: "Why every sport starts from the same balanced base.",
    tags: ["stance", "balance", "agility", "fundamentals"], views: 11200, saves: 940,
    body: "A neutral spine, soft knees, weight on the mid-foot, and hips slightly hinged is the position from which every athletic movement is most efficient. Sprinters, defenders in soccer, point guards in basketball, and tennis players all return to it. Train this stance daily to rewire reaction speed.",
    quiz: [
      { q: "Where should weight be in the athletic stance?", options: ["Heels", "Mid-foot", "Toes"], correct: 1 },
      { q: "The spine should be:", options: ["Rounded", "Hyperextended", "Neutral"], correct: 2 },
      { q: "Hips are:", options: ["Locked straight", "Slightly hinged", "Fully bent"], correct: 1 },
    ]},
  { id: "tech-002", category: "Technique", title: "Force Production: Push the Ground", duration: "5 min", summary: "Speed is force into the floor, not leg turnover.",
    tags: ["sprinting", "speed", "triple extension", "power"], views: 12900, saves: 1180,
    body: "Elite sprinters don't move their legs faster — they apply more force per ground contact. Train triple extension (ankle, knee, hip) and ground contact intent for transferable speed gains.",
    quiz: [
      { q: "Speed comes mostly from:", options: ["Faster steps", "More ground force", "Longer strides"], correct: 1 },
      { q: "Triple extension involves:", options: ["Ankle/knee/hip", "Wrist/elbow/shoulder", "Toe/arch/heel"], correct: 0 },
      { q: "Ground contact should feel:", options: ["Soft", "Aggressive/short", "Heavy"], correct: 1 },
    ]},
  { id: "tech-003", category: "Technique", title: "Reaction Time vs Decision Time", duration: "4 min", summary: "Cut milliseconds off your response.",
    tags: ["decision making", "game speed", "anticipation", "reading the game"], views: 9800, saves: 860,
    body: "Reaction is hardwired (~150-200ms). Decision is trainable. Studying patterns, anticipating opponent cues, and rehearsing scenarios shrinks decision time, which is where 90% of game-changing plays come from.",
    quiz: [
      { q: "Pure reaction time is roughly:", options: ["50ms", "150-200ms", "500ms"], correct: 1 },
      { q: "Most game speed comes from:", options: ["Reaction", "Decision/anticipation", "Strength"], correct: 1 },
      { q: "Decision time is:", options: ["Fixed", "Trainable", "Random"], correct: 1 },
    ]},
  { id: "tech-004", category: "Technique", title: "Breathing Under Load", duration: "3 min", summary: "Brace, exhale, re-inhale — the lifters' rhythm applies everywhere.",
    tags: ["breathing", "bracing", "lifting", "core"], views: 7600, saves: 620,
    body: "Diaphragmatic bracing stabilizes the spine for any heavy or explosive effort. Inhale into the belly, brace 360°, then exhale through the hardest part of the movement.",
    quiz: [
      { q: "Brace by inhaling into the:", options: ["Chest", "Belly (360°)", "Shoulders"], correct: 1 },
      { q: "Exhale during:", options: ["Easiest moment", "Hardest moment", "After movement"], correct: 1 },
      { q: "Bracing protects the:", options: ["Hips", "Spine", "Shoulders"], correct: 1 },
    ]},
  { id: "tech-005", category: "Technique", title: "Eyes Lead the Body", duration: "3 min", summary: "Where you look determines where you move.",
    tags: ["vision", "focus", "balance", "gaze"], views: 6900, saves: 540,
    body: "Visual focus drives movement direction in nearly every sport. Quiet, ahead-focused eyes improve balance, agility, and reaction. Train scanning patterns and target fixation drills.",
    quiz: [
      { q: "Eye focus most affects:", options: ["Endurance", "Movement direction", "Strength"], correct: 1 },
      { q: "Best gaze pattern is:", options: ["Down at feet", "Quiet, ahead", "Closed"], correct: 1 },
      { q: "Scanning trains:", options: ["Strength", "Awareness", "Speed only"], correct: 1 },
    ]},

  // ---- Recovery ----
  { id: "rec-001", category: "Recovery", title: "Sleep Is the #1 Recovery Tool", duration: "5 min", summary: "Why 8 hours beats every supplement.",
    tags: ["sleep", "recovery", "injury risk"], views: 16400, saves: 2050, trending: true,
    body: "Growth hormone, glycogen replenishment, and CNS recovery happen in deep sleep. Athletes sleeping <7h have 1.7× the injury rate of those at 8h+. Prioritize sleep before any other intervention.",
    quiz: [
      { q: "Athletes sleeping <7h have:", options: ["Lower injury rate", "Higher injury rate", "No change"], correct: 1 },
      { q: "Growth hormone peaks in:", options: ["REM", "Deep sleep", "Naps"], correct: 1 },
      { q: "Optimal sleep target:", options: ["6h", "7h", "8-9h"], correct: 2 },
    ]},
  { id: "rec-002", category: "Recovery", title: "HRV: Your Daily Readiness Signal", duration: "5 min", summary: "What heart-rate variability tells you that resting HR cannot.",
    tags: ["hrv", "readiness", "recovery", "tracking"], views: 8900, saves: 910,
    body: "HRV reflects autonomic nervous system balance. Drops indicate accumulated stress (training, life, illness). Track 7-day rolling baseline; deviations >7% should adjust training intensity.",
    quiz: [
      { q: "HRV drops indicate:", options: ["Better recovery", "Accumulated stress", "More fitness"], correct: 1 },
      { q: "Useful HRV metric:", options: ["Single day", "7-day rolling", "Yearly avg"], correct: 1 },
      { q: "Adjust training when HRV drops by more than:", options: ["1%", "7%", "20%"], correct: 1 },
    ]},
  { id: "rec-003", category: "Recovery", title: "Active vs Passive Recovery", duration: "4 min", summary: "When to move, when to rest.",
    tags: ["recovery", "rest days", "flush"], views: 8100, saves: 700,
    body: "Light movement (40-60% HR max) flushes metabolites faster than total rest after high-intensity sessions. Use full passive rest only after extreme efforts or when sleep-deprived.",
    quiz: [
      { q: "Active recovery uses:", options: ["Max effort", "40-60% HR", "90% HR"], correct: 1 },
      { q: "Active recovery helps:", options: ["Build muscle", "Flush metabolites", "Increase strength"], correct: 1 },
      { q: "Passive rest is best after:", options: ["Easy day", "Extreme efforts", "Always"], correct: 1 },
    ]},
  { id: "rec-004", category: "Recovery", title: "The Cold Plunge Truth", duration: "4 min", summary: "What ice baths help — and what they hurt.",
    tags: ["ice bath", "cold water", "soreness"], views: 10800, saves: 890,
    body: "Cold immersion reduces inflammation and perceived soreness, but also blunts the muscle-building signal post-resistance training. Use sparingly during strength blocks; freely during competition phases.",
    quiz: [
      { q: "Cold plunges reduce:", options: ["Sleep", "Inflammation", "VO2max"], correct: 1 },
      { q: "Cold post-lifting:", options: ["Helps growth", "Blunts growth", "No effect"], correct: 1 },
      { q: "Best phase to use cold:", options: ["Strength block", "Competition", "Always"], correct: 1 },
    ]},
  { id: "rec-005", category: "Recovery", title: "Soft-Tissue Self-Care", duration: "3 min", summary: "Foam rolling done right.",
    tags: ["foam rolling", "mobility", "soreness"], views: 6400, saves: 580,
    body: "Spend 60-90s per major muscle group, breathing slowly. Roll before training to improve range; after to reduce soreness. Avoid joints and bony landmarks.",
    quiz: [
      { q: "Time per muscle group:", options: ["10s", "60-90s", "10 min"], correct: 1 },
      { q: "Avoid rolling on:", options: ["Quads", "Joints/bones", "Calves"], correct: 1 },
      { q: "Pre-training rolling helps:", options: ["Strength", "Range of motion", "Endurance"], correct: 1 },
    ]},

  // ---- Nutrition ----
  { id: "nut-001", category: "Nutrition", title: "Protein Per Kilogram", duration: "4 min", summary: "Hit your daily target — split across meals.",
    tags: ["protein", "macros", "muscle"], views: 12100, saves: 1320,
    body: "1.6-2.2g protein per kg body weight is the optimal range for athletic adaptation. Split into 4 meals of ~0.4g/kg for maximal muscle protein synthesis.",
    quiz: [
      { q: "Daily protein target (g/kg):", options: ["0.5", "1.6-2.2", "5"], correct: 1 },
      { q: "Best distribution:", options: ["1 big meal", "4 meals", "Snacks only"], correct: 1 },
      { q: "Per-meal target:", options: ["0.1g/kg", "0.4g/kg", "1g/kg"], correct: 1 },
    ]},
  { id: "nut-002", category: "Nutrition", title: "Carbs Around Training", duration: "5 min", summary: "Time fuel for performance, not aesthetics.",
    tags: ["carbs", "fueling", "glycogen"], views: 9700, saves: 980,
    body: "30-60g carbs in the hour before training improves intensity and endurance. Post-training carbs replenish glycogen 50% faster when paired with protein.",
    quiz: [
      { q: "Pre-training carb amount:", options: ["0g", "30-60g", "200g"], correct: 1 },
      { q: "Post-training, carbs + protein:", options: ["No effect", "Faster glycogen", "Slower"], correct: 1 },
      { q: "Carbs around training affect:", options: ["Looks", "Performance", "Mood only"], correct: 1 },
    ]},
  { id: "nut-003", category: "Nutrition", title: "Hydration Math", duration: "4 min", summary: "How much water you actually need.",
    tags: ["hydration", "water", "electrolytes"], views: 8600, saves: 790,
    body: "Baseline ~35ml/kg/day. Add 500-750ml per hour of training. Add electrolytes (sodium 300-700mg/L) when sessions exceed 60min or are in heat.",
    quiz: [
      { q: "Baseline water (ml/kg):", options: ["10", "35", "100"], correct: 1 },
      { q: "Add per training hour:", options: ["50ml", "500-750ml", "3L"], correct: 1 },
      { q: "Electrolytes needed when:", options: ["Always", ">60min/heat", "Never"], correct: 1 },
    ]},
  { id: "nut-004", category: "Nutrition", title: "Caffeine for Performance", duration: "3 min", summary: "Dose, timing, and the one common mistake.",
    tags: ["caffeine", "coffee", "pre-workout"], views: 10400, saves: 860,
    body: "3-6mg/kg, 45-60min pre-event, gives reliable 2-5% performance bump in most efforts. Avoid daily high doses — tolerance kills the effect when you need it most.",
    quiz: [
      { q: "Effective dose:", options: ["1mg/kg", "3-6mg/kg", "20mg/kg"], correct: 1 },
      { q: "Timing pre-event:", options: ["5 min", "45-60 min", "5 hours"], correct: 1 },
      { q: "Tolerance is built by:", options: ["Skipping", "Daily high doses", "Cold weather"], correct: 1 },
    ]},
  { id: "nut-005", category: "Nutrition", title: "Micronutrients That Matter Most", duration: "4 min", summary: "Iron, vitamin D, magnesium — the athlete trio.",
    tags: ["iron", "vitamin d", "magnesium", "deficiency"], views: 5900, saves: 510,
    body: "Iron (oxygen transport), vitamin D (bone, immune, performance), and magnesium (energy, sleep, muscle function) are the three micronutrients most commonly deficient and most impactful on athletic output.",
    quiz: [
      { q: "Iron is critical for:", options: ["Sleep", "Oxygen transport", "Muscle size"], correct: 1 },
      { q: "Vitamin D affects:", options: ["Only bones", "Bone+immune+perf", "Hair only"], correct: 1 },
      { q: "Magnesium helps:", options: ["Energy/sleep/muscle", "Hair color", "Skin tone"], correct: 0 },
    ]},

  // ---- Sport Science (displays as Training) ----
  { id: "sci-001", category: "Sport Science", title: "VO2 Max Explained", duration: "5 min", summary: "The ceiling of your aerobic engine.",
    tags: ["vo2 max", "aerobic", "endurance", "oxygen"], views: 13700, saves: 1290, trending: true,
    body: "VO2 max is the maximum oxygen your body can use per minute. It's part-genetic but improvable 15-20% through training, especially intervals at 90-95% HR max for 3-5min repeats.",
    quiz: [
      { q: "VO2 max measures:", options: ["Strength", "Max O2 use", "Reaction"], correct: 1 },
      { q: "Best interval intensity:", options: ["50% HR", "90-95% HR", "120% HR"], correct: 1 },
      { q: "Improvable by:", options: ["0%", "15-20%", "100%"], correct: 1 },
    ]},
  { id: "sci-002", category: "Sport Science", title: "The Acute:Chronic Ratio", duration: "5 min", summary: "Why ratios above 1.5 spike injury risk.",
    tags: ["load management", "acwr", "injury risk", "overtraining"], views: 7200, saves: 640,
    body: "Compare last 7 days of load to last 28 days. Ratios between 0.8-1.3 are the 'sweet spot.' Above 1.5 doubles injury risk in most sports research.",
    quiz: [
      { q: "Sweet-spot ratio:", options: ["0.2-0.5", "0.8-1.3", "2-3"], correct: 1 },
      { q: "Compare days:", options: ["1 vs 7", "7 vs 28", "30 vs 365"], correct: 1 },
      { q: "Risk doubles above:", options: ["0.5", "1.5", "5.0"], correct: 1 },
    ]},
  { id: "sci-003", category: "Sport Science", title: "Periodization Basics", duration: "5 min", summary: "Why you can't peak year-round.",
    tags: ["periodization", "programming", "peaking"], views: 6800, saves: 610,
    body: "Training cycles alternate volume, intensity, and recovery. Block periodization (focused 3-4 week blocks) outperforms random training for most athletes outside their first year.",
    quiz: [
      { q: "Block length:", options: ["1 day", "3-4 weeks", "1 year"], correct: 1 },
      { q: "Peaking year-round:", options: ["Optimal", "Impossible", "Easy"], correct: 1 },
      { q: "Cycles alternate:", options: ["Vol/int/rest", "Only intensity", "Only volume"], correct: 0 },
    ]},
  { id: "sci-004", category: "Sport Science", title: "Lactate Threshold", duration: "4 min", summary: "Where comfortable becomes uncomfortable.",
    tags: ["lactate threshold", "tempo", "race pace"], views: 7900, saves: 700,
    body: "The point at which lactate accumulation outpaces clearance. Training at threshold (often 85-90% HR max, comfortable-hard) raises this ceiling and improves race-pace endurance.",
    quiz: [
      { q: "Threshold HR zone:", options: ["50%", "85-90%", "100%"], correct: 1 },
      { q: "Threshold work improves:", options: ["Pure speed", "Race endurance", "Strength only"], correct: 1 },
      { q: "Lactate is:", options: ["Toxic waste", "Metabolic fuel/marker", "Useless"], correct: 1 },
    ]},
  { id: "sci-005", category: "Sport Science", title: "Neural vs Metabolic Fatigue", duration: "4 min", summary: "Two different kinds of tired.",
    tags: ["fatigue", "cns", "recovery"], views: 5600, saves: 470,
    body: "Neural fatigue (CNS) shows as slower reactions and weaker max efforts despite normal HR. Metabolic fatigue is breath/burn limited. Recovery strategies differ — neural needs sleep and tapering, metabolic responds to fueling.",
    quiz: [
      { q: "Neural fatigue affects:", options: ["Breath", "Max efforts/reactions", "Hydration"], correct: 1 },
      { q: "Best for neural recovery:", options: ["More carbs", "Sleep + taper", "More HIIT"], correct: 1 },
      { q: "Metabolic fatigue responds to:", options: ["Fueling", "Sleep only", "Foam rolling"], correct: 0 },
    ]},

  // ---- Hybrid Athlete (displays as Strength) ----
  { id: "hyb-001", category: "Hybrid Athlete", title: "The Hybrid Athlete Framework", duration: "5 min",
    summary: "How to chase strength AND endurance without one killing the other.",
    tags: ["hybrid", "cross training", "interference"], views: 9200, saves: 1040,
    body: "Hybrid training works when you isolate stimuli: keep hard endurance and hard strength sessions at least 6h apart, and never stack them on consecutive days at peak intensity. Use a 3-day micro-cycle: heavy strength, hard endurance, easy/skill. The interference effect mostly hits when high-volume aerobic work is layered onto heavy lifting in the same session.",
    sports: ["Hybrid", "CrossFit", "Triathlon", "Rugby", "MMA"], goals: ["Strength", "Endurance", "Power"],
    quiz: [
      { q: "Minimum gap between hard strength and hard endurance sessions?", options: ["1 hour", "6+ hours", "Same hour"], correct: 1 },
      { q: "Interference effect is worst when:", options: ["Sessions far apart", "Aerobic stacked on heavy lifting", "Pure rest"], correct: 1 },
      { q: "A safe 3-day micro-cycle is:", options: ["Heavy/Hard/Easy", "Hard/Hard/Hard", "Rest/Rest/Rest"], correct: 0 },
    ]},
  { id: "hyb-002", category: "Hybrid Athlete", title: "Fueling Two Engines", duration: "5 min",
    summary: "Carbs for endurance, protein for strength — get both right.",
    tags: ["hybrid", "fueling", "nutrition"], views: 6100, saves: 590,
    body: "Hybrid athletes burn more total energy than single-sport peers. Target 5-8g/kg carbs on big endurance days, 2.0-2.4g/kg protein every day, and don't under-eat on rest days — recovery is built on fuel. Time most carbs around the harder session of the day.",
    sports: ["Hybrid", "CrossFit", "Triathlon"], goals: ["Strength", "Endurance", "Muscle Gain"],
    quiz: [
      { q: "Daily protein for hybrid athletes:", options: ["0.8 g/kg", "2.0-2.4 g/kg", "5 g/kg"], correct: 1 },
      { q: "Big endurance day carbs:", options: ["Avoid carbs", "5-8 g/kg", "1 g/kg"], correct: 1 },
      { q: "Rest day fueling:", options: ["Slash calories", "Maintain — recovery needs fuel", "Double carbs"], correct: 1 },
    ]},
  { id: "hyb-003", category: "Hybrid Athlete", title: "Concurrent Training: Avoid the Interference Trap", duration: "5 min",
    summary: "The molecular fight between AMPK and mTOR — and how to win both.",
    tags: ["concurrent training", "interference", "hybrid"], views: 5400, saves: 520,
    body: "Endurance work activates AMPK (mitochondrial growth); strength work activates mTOR (muscle growth). Doing both hard in the same session blunts mTOR. Solution: separate by 6h+, do strength FIRST when same-day is unavoidable, and program one as the priority for each 4-week block.",
    sports: ["Hybrid", "CrossFit", "Rugby", "Football"], goals: ["Strength", "Power", "Endurance"],
    quiz: [
      { q: "If forced into one session, do:", options: ["Endurance first", "Strength first", "Random"], correct: 1 },
      { q: "AMPK is triggered by:", options: ["Heavy lifting", "Endurance work", "Sleep"], correct: 1 },
      { q: "Block prioritization length:", options: ["1 day", "4 weeks", "1 year"], correct: 1 },
    ]},
  { id: "hyb-004", category: "Hybrid Athlete", title: "Hybrid Recovery: Double the Load, Double the Discipline", duration: "4 min",
    summary: "Why HRV monitoring matters 10× more for hybrid athletes.",
    tags: ["hybrid", "hrv", "recovery"], views: 4800, saves: 430,
    body: "Stacking modalities accumulates fatigue faster than single-sport training. Hybrid athletes should target 8.5h+ sleep, monitor HRV daily, and have a hard cutoff: if HRV drops >10% from baseline for 2 days, swap the next hard session for skill or aerobic recovery work.",
    sports: ["Hybrid", "Triathlon", "CrossFit", "Rugby"], goals: ["Endurance", "Power"],
    quiz: [
      { q: "Hybrid sleep target:", options: ["6h", "7h", "8.5h+"], correct: 2 },
      { q: "HRV cutoff for swapping a hard session:", options: ["Any drop", "10%+ for 2 days", "50%"], correct: 1 },
      { q: "Hybrid training fatigue accumulates:", options: ["Slower", "Same", "Faster"], correct: 2 },
    ]},
  { id: "hyb-005", category: "Hybrid Athlete", title: "Picking Your Performance Identity", duration: "4 min",
    summary: "Two sports, one body — how to weight your weekly plan.",
    tags: ["hybrid", "multi sport", "priorities"], views: 4300, saves: 390,
    body: "For multi-sport athletes, set a 70/30 split — 70% of weekly volume on your primary sport, 30% on the secondary. During in-season for your primary, drop the secondary to maintenance (1-2 sessions). Off-season is when you flip the ratio and rebuild the lagging side.",
    sports: ["Hybrid", "Triathlon"], goals: ["Strength", "Endurance", "Speed"],
    quiz: [
      { q: "In-season primary/secondary split:", options: ["50/50", "70/30", "100/0"], correct: 1 },
      { q: "Secondary sport in-season is:", options: ["Maintained at 1-2 sessions", "Dropped entirely", "Doubled"], correct: 0 },
      { q: "Off-season is for:", options: ["Maintenance only", "Rebuilding the lagging side", "Total rest"], correct: 1 },
    ]},

  // ==================== RUNNING / ATHLETICS ====================

  { id: "run-001", category: "Tactics", title: "How to Run the Perfect 800m", duration: "8 min",
    summary: "Positioning, pacing, race rhythm and finishing strategy for the two-lap classic.",
    tags: ["800m", "middle distance", "race tactics", "pacing", "two lap"],
    sports: ["Running", "Athletics"], goals: ["Speed", "Endurance"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["Position through the break matters more than raw speed early.", "A slightly positive split (first lap faster) is normal — don't panic.", "Commit fully from 150–200m out and finish through the line."],
    views: 18400, saves: 2260, trending: true,
    body: "The 800m is a speed-endurance race: fast enough that positioning decides how much energy you waste, long enough that pacing decides the result.\n\nPositioning. The break — where runners leave the inside line — comes after the first bend, around 120m. Get there in contact with the race without fighting for the inside; being boxed on the bend costs more than running one lane wide.\n\nPacing. A slightly positive split is normal at every level: the first lap usually comes out 1.5–3s faster than the second because of the start and the break. The mistake is going out 5s fast and dying. Rehearse your target opening lap in training until it feels automatic.\n\nRhythm. The race is decided at 500–600m, where everyone's rhythm breaks. Holding yours while others decelerate is what moves you through the field.\n\nFinishing. Commit with about 150–200m to go — later than it feels like you should. Sprinters' kicks come from good positioning, not desperation. Finish through the line, not to it.\n\nRace craft is trainable: rehearse scenarios (boxed on the bend, leader goes early, surging at 600m) in sessions so decisions are automatic on race day.",
    quiz: [
      { q: "Where is the 800m break?", options: ["At the gun", "After the first bend, around 120m", "At 400m"], correct: 1 },
      { q: "What split pattern is normal at most levels?", options: ["Second lap faster by 5s", "First lap slightly faster", "Perfectly even"], correct: 1 },
      { q: "The final push should start about:", options: ["50m out", "150–200m out", "400m out"], correct: 1 },
    ]},
  { id: "run-002", category: "Training", title: "800m Training: Speed Endurance That Actually Works", duration: "7 min",
    summary: "The sessions behind a fast second lap — race rhythm, speed endurance and the aerobic base.",
    tags: ["800m", "speed endurance", "training", "sessions", "middle distance"],
    sports: ["Running", "Athletics"], goals: ["Speed", "Endurance"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["300m reps at goal race pace with full recovery train rhythm, not exhaustion.", "The aerobic base is what lets you repeat quality — tempo runs still matter.", "Keep quality sessions to 2–3 per week; easy days stay genuinely easy."],
    views: 9800, saves: 1140,
    body: "800m fitness stacks three qualities: speed, speed endurance, and the aerobic base that lets you use them twice.\n\nRace rhythm: 3–4 × 300m at goal-race pace with full recovery (4–6 minutes). This teaches pace feel — the point is hitting race speed smoothly, not surviving exhaustion.\n\nSpeed endurance: 5 × 400m slightly slower than race pace with 90 seconds to 2 minutes recovery. This is the session that protects your second lap.\n\nAerobic base: 20–25 minute tempo runs (comfortably hard) and one longer run each week. A stronger base means you recover between reps faster and between races faster.\n\nStructure: two to three quality sessions per week is the ceiling for most developing athletes; the rest is easy running, mobility and sleep. If you're under 16, keep race-pace work to one or two sessions weekly and always leave a rep in the tank — growing bodies adapt plenty without being flattened.",
    quiz: [
      { q: "Recovery for 300m race-pace reps is:", options: ["30 seconds", "Full — 4 to 6 minutes", "None"], correct: 1 },
      { q: "Tempo runs mainly build:", options: ["Maximum speed", "The aerobic base", "Flexibility"], correct: 1 },
      { q: "Sensible quality-session ceiling per week:", options: ["6", "2–3", "None — race every day"], correct: 1 },
    ]},
  { id: "run-003", category: "Tactics", title: "5K Pacing: Go Out Controlled, Finish Furious", duration: "6 min",
    summary: "Why even pacing wins — and how to stop the first-kilometre adrenaline tax.",
    tags: ["5k", "pacing", "race strategy", "negative split"],
    sports: ["Running"], goals: ["Endurance"], difficulty: "Beginner", contentType: "Article",
    takeaways: ["Even pacing is physiologically the cheapest way to race.", "Going out 15–20s/km too fast costs far more later than it buys early.", "Practise goal pace in training until it's automatic."],
    views: 15200, saves: 1940, trending: true,
    body: "Physiology is clear: for races of 5K and up, even pacing gets you to the line fastest, and a slight negative split (second half faster) is the realistic ideal. Every second you bank in the first kilometre by going too hard is repaid with interest when your form collapses.\n\nThe pattern to avoid: adrenaline fires the gun, you go through kilometre one 15–20 seconds under goal pace feeling great, and from kilometre three you're negotiating with every step.\n\nThe fix is deliberate: run the first kilometre at goal pace — not faster — even when it feels insultingly easy, settle into rhythm through the middle, and race the final kilometre with whatever you've saved.\n\nMake it automatic in training: run 3 × 1km at goal race pace and check your watch only after each rep. When you can hit pace by feel, the watch becomes confirmation instead of a crutch.",
    quiz: [
      { q: "Physiologically optimal 5K pacing is:", options: ["Even or slight negative split", "Fastest possible first km", "All-out finish from 2km"], correct: 0 },
      { q: "Going out too fast primarily costs:", options: ["Nothing if you feel good", "Far more time later than it saved", "Only morale"], correct: 1 },
      { q: "The first kilometre should be:", options: ["5–10s/km faster than goal pace", "At goal pace, even if it feels easy", "As slow as possible"], correct: 1 },
    ]},
  { id: "run-004", category: "Technique", title: "Sprint Start Mechanics: Drive, Don't Stand Up", duration: "5 min",
    summary: "Block setup, the drive phase, and why great sprinters rise gradually.",
    tags: ["sprint start", "blocks", "drive phase", "acceleration", "100m"],
    sports: ["Athletics", "Running"], goals: ["Speed", "Power"], difficulty: "Intermediate", contentType: "Technique",
    takeaways: ["Rise gradually over the first 15–20 metres — don't stand up early.", "Front-side mechanics: knees up, heel recovery under the hip.", "Push hard and long behind you; the ground contact is the work."],
    views: 8600, saves: 780,
    body: "Acceleration is a skill before it's a gift. The start rewards a specific sequence, and most young sprinters lose time by rushing it.\n\nSet-up: front foot two foot-lengths behind the line, rear foot beside or slightly ahead of the front ankle, hips high enough that the first push is backward, not upward.\n\nDrive phase: the first 15–20 metres are about long, forceful pushes behind your centre of mass with the body leaning forward. Standing up early kills acceleration — elite sprinters rise gradually, one step at a time, until upright speed begins around 20–30m.\n\nFront-side mechanics: once upright, think knees up and heel recovery under the hip rather than reaching forward. Foot contact lands under your centre of mass, and each contact is a punch into the ground — force into the floor, not long floaty strides.\n\nDrill it: short hill sprints and wall drives groove the push pattern with low injury risk.",
    quiz: [
      { q: "During the drive phase the body should:", options: ["Stand upright immediately", "Rise gradually over 15–20m", "Lean backwards"], correct: 1 },
      { q: "In upright sprinting, the foot should land:", options: ["Ahead of the body", "Under the centre of mass", "Behind the body"], correct: 1 },
      { q: "Front-side mechanics emphasise:", options: ["Knees up, heel under hip", "Long reaching strides", "Heels to the sky"], correct: 0 },
    ]},
  { id: "run-005", category: "Training", title: "Hill Sprints: Speed and Power With Less Risk", duration: "4 min",
    summary: "The most underrated speed session — maximum intent, shorter ground contacts, lower impact.",
    tags: ["hills", "sprints", "power", "speed session"],
    sports: ["Running", "Athletics", "Football", "Rugby"], goals: ["Speed", "Power"], difficulty: "Beginner", contentType: "Guide",
    takeaways: ["Hills force good sprint mechanics while reducing impact forces.", "6–10 sprints of 8–12 seconds at full intent is a complete session.", "Full walk-down recovery — quality over exhaustion."],
    views: 7200, saves: 690, trending: true,
    body: "Hill sprints deliver sprint-training benefits — high force output, fast ground contacts, full nervous-system intent — while the slope cuts peak impact forces and caps top speed, which lowers strain risk compared to flat sprinting at full velocity.\n\nThe session is simple: a thorough warm-up, then 6–10 sprints of 8–12 seconds up a moderate 5–8% gradient at genuine full effort, walking down for full recovery (2–3 minutes). Two rules keep it honest: the hill decides the speed, you decide the intent, and the session ends when reps slow down, not when you're flattened.\n\nThe carryover is force production — pushing the ground hard, which transfers to acceleration in almost every field sport. One session a week is plenty; it slots in place of a flat speed day during heavy weeks because it's gentler on hamstrings at top-end speeds.",
    quiz: [
      { q: "Compared to flat sprinting, hill sprints have:", options: ["More impact force", "Less impact force", "No difference"], correct: 1 },
      { q: "A complete hill session is roughly:", options: ["2 sprints", "6–10 short sprints at full intent", "30 minutes continuous"], correct: 1 },
      { q: "Recovery between reps should be:", options: ["Short — 20 seconds", "Full walk-down, 2–3 minutes", "Nonexistent"], correct: 1 },
    ]},

  // ==================== FOOTBALL ====================

  { id: "fb-001", category: "Technique", title: "Finishing Technique: Placement Beats Power", duration: "6 min",
    summary: "Why the calmest finisher usually scores the most — technique, contact and pre-deciding.",
    tags: ["finishing", "shooting", "striking", "goal scoring"],
    sports: ["Football"], goals: ["Technique", "Power"], difficulty: "Intermediate", contentType: "Technique",
    takeaways: ["Decide where you're going before the ball arrives — scanning buys time.", "Side-foot for placement, laces for power when the timing is right.", "Contact middle-top of the ball to keep shots down and on target."],
    views: 16800, saves: 2410, trending: true,
    body: "Most missed chances aren't missed through lack of power — they're rushed decisions on poorly-struck contact.\n\nPre-decide. Great finishers know what they'll do before the ball arrives, because they scanned before receiving. If you're deciding after the bounce, you've already lost half your window.\n\nPlacement first. Inside-foot finishes across the keeper to the far side need less than maximum power and go in far more often. Save the laces-driven strike for moments when the timing genuinely allows it — set feet, strike through the ball's middle-top, hips over the ball, follow through toward the target.\n\nKeep it down. The single biggest fix for wayward shooting: contact slightly on top of centre so the ball stays under the bar. Leaning back sends it over.\n\nTrain scenarios, not just reps: cutbacks, first-time finishes from crosses, 1v1 with the keeper rushing. Finishing under fatigue is its own skill — add a sprint before the chance once the technique is stable.",
    quiz: [
      { q: "The most reliable finish for most chances is:", options: ["Maximum-power laces strike", "Inside-foot placement across the keeper", "Toe poke"], correct: 1 },
      { q: "To keep shots down, contact the ball:", options: ["Middle-top, hips over the ball", "Underneath, leaning back", "On the side"], correct: 0 },
      { q: "Great finishers decide:", options: ["After the bounce", "Before the ball arrives, from scanning", "Never — pure instinct"], correct: 1 },
    ]},
  { id: "fb-002", category: "Technique", title: "First Touch: The Skill That Buys You Time", duration: "5 min",
    summary: "Scan early, open your body, and cushion the ball into space — not at your feet.",
    tags: ["first touch", "receiving", "control", "body shape"],
    sports: ["Football"], goals: ["Technique", "Skill"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["Touch the ball into space, away from pressure — not to a standstill.", "Open your body shape before receiving to see more of the pitch.", "Check your shoulder before every reception; it's a habit, not a talent."],
    views: 12400, saves: 1480,
    body: "First touch decides everything that happens next: a good touch buys time and options, a bad one sells them.\n\nThe mechanics are simple and trainable. Before the ball arrives, look over your shoulder — twice if possible — so you know where pressure is coming from. Open your body: receive on the half-turn with hips angled toward the space you want to play into, not toward your own goal.\n\nThen the touch itself: cushion the ball out of your feet into space, a metre or two in the direction you want to go, rather than killing it dead at your feet. A still ball invites the defender; a moving ball creates the half-second that lets you play forward.\n\nDrill it with a wall: receive, scan (call out what's behind you), take the touch into a marked square, pass. Twenty minutes a week rewrites the habit faster than anything match-based.",
    quiz: [
      { q: "The best first touch usually goes:", options: ["Dead at your feet", "Into space, away from pressure", "Straight backwards"], correct: 1 },
      { q: "Body shape when receiving should be:", options: ["Square to the passer", "Open on the half-turn", "Back to the pitch"], correct: 1 },
      { q: "Scanning before receiving is:", options: ["A trainable habit", "Pure talent", "Only for midfielders"], correct: 0 },
    ]},
  { id: "fb-003", category: "Tactics", title: "Scanning: What Elite Midfielders Actually Do", duration: "5 min",
    summary: "The shoulder-check habit behind 'time on the ball' — and how to train it.",
    tags: ["scanning", "awareness", "vision", "midfield", "decision making"],
    sports: ["Football"], goals: ["Mental", "Skill"], difficulty: "Intermediate", contentType: "Article",
    takeaways: ["Elite players scan 6–10 times in the 10 seconds before receiving.", "Scans before the ball arrives buy decision speed after it.", "You can train scanning with a simple count-and-call drill."],
    views: 9100, saves: 970,
    body: "Watch the best midfielders receive under pressure and they look unhurried — not because they have more time, but because they collected the information earlier. Research on elite players consistently shows high-frequency scanning: shoulder checks six to ten times in the ten seconds before receiving.\n\nThe payoff is compounding. Each scan feeds a mental map: where the press is coming from, which teammate is free, what's behind. When the ball arrives, the decision is already half-made — that's what 'time on the ball' actually is.\n\nTrain it in any possession drill: before receiving, scan, then call out how many defenders are pressing and where the free man is. It feels unnatural for two weeks and automatic after a month. Video review helps too — watch your own touches back and count your scans against the game's actual demands.\n\nThis is decision-making you can measurably improve without touching your fitness or technique.",
    quiz: [
      { q: "Elite midfielders typically scan before receiving:", options: ["Once or twice", "Six to ten times in 10 seconds", "Never — they feel it"], correct: 1 },
      { q: "Scanning's main benefit is:", options: ["Looking professional", "Collecting information early to decide faster", "Intimidating defenders"], correct: 1 },
      { q: "The simplest way to train scanning:", options: ["Count-and-call in possession drills", "Only play matches", "Juggling"], correct: 0 },
    ]},

  // ==================== BASKETBALL ====================

  { id: "bb-001", category: "Strength", title: "Vertical Jump: Build Your Spring", duration: "6 min",
    summary: "Force, rate of force development and ankle stiffness — the real ingredients of a higher jump.",
    tags: ["vertical jump", "jump higher", "plyometrics", "power", "dunk"],
    sports: ["Basketball", "Volleyball"], goals: ["Power", "Strength"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["Jump height = force produced fast — train strength AND rate of force development.", "Deep squats build the engine; jumps, depth drops and bounds build the delivery.", "More plyo volume is not better: 2–3 short sessions a week, fully recovered."],
    views: 14600, saves: 2320, trending: true,
    body: "Jump height comes down to how much force you put into the floor and how quickly you do it. That splits training into two halves.\n\nThe engine: relative strength. Squats, trap-bar deadlifts and split squats in the 3–6 rep range build the force ceiling. If you're young or new to lifting, master bodyweight patterns first — the engine grows fine on goblet squats and lunges at 12–16.\n\nThe delivery: rate of force development. Countermovement jumps, depth jumps from modest heights (30–45cm), bounds and continuous pogo hops train your muscles and tendons to fire fast. Short, sharp, high-quality contacts — stop the set when contacts get sloppy.\n\nStiffness matters too: strong calves and Achilles, trained through pogo work, cut ground-contact time at take-off.\n\nThe trap is volume. Plyometrics don't reward grinding — two or three short, crisp sessions weekly, away from heavy leg days, beats hours of jumping. Progress height and intensity gradually; tendon adaptation lags strength by months.",
    quiz: [
      { q: "Jump height depends primarily on:", options: ["Being tall", "Force produced quickly", "Calf size"], correct: 1 },
      { q: "Depth jumps mainly train:", options: ["Maximal strength", "Rate of force development", "Endurance"], correct: 1 },
      { q: "Sensible plyometric frequency:", options: ["Every day", "2–3 short sessions a week", "Once a month"], correct: 1 },
    ]},
  { id: "bb-002", category: "Technique", title: "Shooting Fundamentals That Hold Under Pressure", duration: "6 min",
    summary: "Base, alignment, release and arc — the four things every consistent shot shares.",
    tags: ["shooting", "jump shot", "form", "arc"],
    sports: ["Basketball"], goals: ["Technique"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["Consistency beats beauty: same base, same release, every time.", "Shoot with legs — late-game misses are usually tired legs, not nerves.", "Practise at game speed, off movement and under fatigue."],
    views: 13800, saves: 1560,
    body: "A repeatable shot has four ingredients, and none of them require perfect 'form' by someone else's standard.\n\nBase: feet shoulder-width, ten toes to the rim, knees bent before the catch — not after. Alignment: shooting hand behind the ball, elbow under it, guide hand on the side, and a straight line from ball to rim through your eyes. Release: smooth extension through the legs, elbow finishing at or above eyebrow height, wrist relaxed into the follow-through with fingers pointing down — that backspin comes from the wrist, not a flick. Arc: a medium-high arc (entry angle around 45–50°) gives you the biggest target; flat shots rattle out.\n\nUnder pressure, mechanics degrade to your training level. Late-game misses are overwhelmingly short — tired legs — so build game-speed practice: shoot off movement, off the dribble, after a sprint, with a count on the clock. Form shooting at a walk fixes mechanics; pressure practice fixes shots.",
    quiz: [
      { q: "Late-game missed shots are usually:", options: ["Long", "Short — from tired legs", "Wide left"], correct: 1 },
      { q: "The follow-through should finish with:", options: ["Wrist flicked sideways", "Fingers pointing down", "Elbow flared"], correct: 1 },
      { q: "Pressure shooting means practising:", options: ["Standing still only", "Off movement and under fatigue", "Only when fresh"], correct: 1 },
    ]},
  { id: "bb-003", category: "Technique", title: "Defensive Slides: Footwork That Stays in Front", duration: "4 min",
    summary: "Wide base, hips low, feet never crossing — the mechanics of staying between man and basket.",
    tags: ["defense", "footwork", "slides", "lateral movement"],
    sports: ["Basketball"], goals: ["Skill", "Speed"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["Never cross your feet in a slide — push off the back foot each step.", "Stay low with hips back; a tall defender gets beaten in one move.", "A wide, active base beats a fast reaction every time."],
    views: 6400, saves: 520,
    body: "Staying in front is footwork before it's speed.\n\nThe base: feet wider than shoulders, knees bent, hips back, chest up. A low defender covers angles; a tall, upright defender covers the same space with slower first steps.\n\nThe slide: push off the trailing foot and step with the lead foot — feet never cross, heels never click. Crossing feet is the moment you lose balance and the drive happens.\n\nThe angle: defend the space between your man and the basket, a step off toward the ball side, and make the handler beat you one way rather than giving both.\n\nTrain it honestly: slides only work at full intensity. Two lengths of defensive slides at game effort, rest, repeat — five sets. Do them fresh; sloppy, tired slides just rehearse bad habits.",
    quiz: [
      { q: "In a defensive slide your feet should:", options: ["Cross over quickly", "Never cross — push and step", "Click heels together"], correct: 1 },
      { q: "Defensive stance height:", options: ["Tall and upright", "Low — hips back, knees bent", "Whatever is comfortable"], correct: 1 },
      { q: "Slide drills work when done:", options: ["At full intensity", "Casually while tired", "Once a season"], correct: 0 },
    ]},

  // ==================== TENNIS ====================

  { id: "tn-001", category: "Technique", title: "The Split Step: Timing Is Everything", duration: "4 min",
    summary: "The hop that turns reaction time into court coverage — and how to time it.",
    tags: ["split step", "footwork", "return", "movement"],
    sports: ["Tennis", "Badminton", "Squash"], goals: ["Skill", "Speed"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["Split step as your opponent hits — not before, not after.", "Land on the balls of your feet, ready to push any direction.", "A late split step is the root of most 'slow' court movement."],
    views: 8900, saves: 740,
    body: "Almost every 'slow' tennis player is actually a late split-stepper.\n\nThe skill: a small hop, landing on the balls of both feet, timed so you're landing just as your opponent contacts the ball. That landing loads your legs — the push in any direction starts from a loaded position, which is why a well-timed split step makes average speed feel fast and why flat-footed waiting makes fast legs feel slow.\n\nThe timing: start the hop as the opponent's swing begins, land as they strike. Early leaves you planted; late leaves you moving before you know where to go.\n\nWhere it matters most: the return of serve — the hardest read in the game — and the first step after every shot you hit. Recover, split, react.\n\nDrill it without a ball: shadow rallies where you split step on a partner's clap. Two minutes at the start of every session rebuilds the habit.",
    quiz: [
      { q: "The split step should land:", options: ["Before the opponent prepares", "Just as the opponent hits", "After you see the ball"], correct: 1 },
      { q: "You land on:", options: ["Your heels", "The balls of your feet", "One foot"], correct: 1 },
      { q: "A 'slow' player often really has:", options: ["Weak legs", "A late or missing split step", "Small lungs"], correct: 1 },
    ]},
  { id: "tn-002", category: "Technique", title: "Serve Fundamentals: Rhythm and the Toss", duration: "6 min",
    summary: "A repeatable toss, one fluid motion, and why the legs own the power.",
    tags: ["serve", "toss", "kinetic chain", "tennis technique"],
    sports: ["Tennis"], goals: ["Technique", "Power"], difficulty: "Intermediate", contentType: "Technique",
    takeaways: ["A consistent toss fixes more service problems than anything else.", "Power comes from legs → hips → shoulders in sequence, not arm speed.", "Practise the toss alone until it's boring."],
    views: 10200, saves: 920,
    body: "The serve is the only shot in tennis you fully control — which makes the toss the highest-leverage detail in the game.\n\nThe toss: same height every time, slightly in front and to the right of your hitting shoulder (for right-handers). Release it from a still hand at eye level and let it rise; a wobbling toss comes from a moving arm, not the ball. If you can toss to the same spot twenty times in a row with no racket, the serve gets easier immediately.\n\nThe motion: think of one continuous action — toss, turn, trophy position, then up through contact with the hitting arm loose. The power is a kinetic chain: legs drive, hips and shoulders rotate, the arm delivers. Arm-wrestling the ball over the net produces double faults.\n\nContact point is high — meet the ball at full reach, not on the way down. And rehearse your routine: bounce, breathe, toss. Same every point. The routine is what holds under pressure.",
    quiz: [
      { q: "The biggest single fix for serve consistency is:", options: ["A stronger arm", "A repeatable toss", "A bigger racket"], correct: 1 },
      { q: "Serve power comes mainly from:", options: ["Wrist speed", "The leg–hip–shoulder chain", "Swinging harder"], correct: 1 },
      { q: "Contact should happen:", options: ["At full reach, at the toss peak", "On the way down", "Behind your head"], correct: 0 },
    ]},

  // ==================== SWIMMING ====================

  { id: "sw-001", category: "Technique", title: "Freestyle Efficiency: Swim Smarter, Not Harder", duration: "6 min",
    summary: "Body position, the early vertical forearm, and why distance per stroke beats stroke rate.",
    tags: ["freestyle", "swimming technique", "catch", "efficiency"],
    sports: ["Swimming", "Triathlon"], goals: ["Technique", "Endurance"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["Swim 'downhill' — head neutral, hips high, kick small from the hips.", "Early vertical forearm turns your arm into a paddle that anchors.", "Count strokes per length: fewer for the same speed means better technique."],
    views: 11500, saves: 1080,
    body: "Water is 800 times denser than air, so swimming fast is mostly about removing drag, not adding power.\n\nBody position first: eyes look down and slightly forward, not at the far wall — a lifted head sinks the hips. Press the chest slightly so the hips ride high, kick small and from the hips (not the knees), and rotate from the shoulders so you're swimming on your side, not flat on your stomach.\n\nThen the catch: extend forward, then bend the elbow early so the forearm points at the pool floor — the 'early vertical forearm.' That anchors your arm in the water and lets you pull your body past it, instead of slipping water backwards.\n\nThe metric that matters: strokes per length. If your count drops at the same speed, your technique improved. Drill 4–6 × 50m focusing on one cue at a time — never all of them at once. Technique work is short, fresh and frequent; tired swimming just rehearses survival strokes.",
    quiz: [
      { q: "Lifting your head to look forward causes:", options: ["Faster swimming", "Hips to sink and drag to rise", "Nothing"], correct: 1 },
      { q: "The 'early vertical forearm' improves:", options: ["Turn speed", "The catch — anchoring water to pull past", "Kick rate"], correct: 1 },
      { q: "A falling stroke count at the same speed means:", options: ["You got lazy", "Your technique improved", "The pool got shorter"], correct: 1 },
    ]},
  { id: "sw-002", category: "Technique", title: "Turns and Push-Offs: The Free Speed Section", duration: "5 min",
    summary: "Approach, tight rotation, and a long streamline — where races are won without swimming faster.",
    tags: ["turns", "tumble turn", "streamline", "push off", "underwater"],
    sports: ["Swimming"], goals: ["Skill", "Speed"], difficulty: "Intermediate", contentType: "Technique",
    takeaways: ["Don't breathe into or out of the wall — maintain speed into the turn.", "Tight tuck, fast rotation, feet planted hip-width.", "Streamline tight and hold the kick until you surface at race depth."],
    views: 7300, saves: 610,
    body: "In short-course racing, turns can be a third of your time — and they cost nothing physiologically to improve.\n\nThe approach: the most common mistake is breathing into the wall, which kills speed exactly when you need it. Take your last breath two strokes out and carry momentum in.\n\nThe turn: one last stroke, head follows the hands down into a tight tuck, fast forward somersault, feet planted on the wall hip-width apart, body on its side facing up.\n\nThe push-off is where the free speed lives: drive off in a tight streamline — hands stacked, head locked between the arms, toes pointed — on your side or back, then hold the dolphin kick until just before you'd start decelerating, and surface into your first stroke. Surfacing late and shallow is worth more than any fitness gain.\n\nPractise turns fresh and in isolation: 8 × from the flags, focusing on one piece each time.",
    quiz: [
      { q: "Into the wall you should:", options: ["Breathe every stroke", "Avoid breathing in the last two strokes", "Slow down to aim"], correct: 1 },
      { q: "Off the wall, your body should be:", options: ["Loose and head up", "In a tight streamline on your side", "Flat and straight away swimming"], correct: 1 },
      { q: "Underwater dolphin kick should be held:", options: ["Until deceleration approaches", "Half a second", "Until the flags"], correct: 0 },
    ]},

  // ==================== CYCLING ====================

  { id: "cy-001", category: "Training", title: "Cadence and Gearing: Finding Your RPM", duration: "5 min",
    summary: "Why 80–95rpm is the efficiency sweet spot — and when low-cadence work earns its place.",
    tags: ["cadence", "gearing", "rpm", "cycling technique", "pedalling"],
    sports: ["Cycling"], goals: ["Endurance", "Training"], difficulty: "Beginner", contentType: "Article",
    takeaways: ["Cruise at 80–95rpm for efficiency; grind less, spin smoother.", "Low-cadence strength work (60–70rpm, seated, steady) has a purpose — in moderation.", "Fix your position before chasing power numbers."],
    views: 6900, saves: 570,
    body: "Cadence is the cheapest performance dial on the bike.\n\nThe sweet spot: most riders are most efficient — and freshest for later — cruising at 80–95rpm. Grinding big gears at 60rpm looks strong but taxes your muscles every pedal stroke; spinning tiny gears at 120+rpm wastes energy just moving your legs. On climbs, shift down before you slow down and let the legs keep their rhythm.\n\nWhere low cadence earns a place: short blocks of seated low-cadence work (60–70rpm, steady effort, 5–10 minutes) build muscular endurance for races and climbs that force low-speed grinding. Think of it as strength work on the bike — a seasoning, not the meal.\n\nPractical habits: count your cadence on flat rides until you know what 90 feels like; keep tyre pressure and gearing sensible so you're never forced to mash; and if one leg feels dead or your knees ache, check saddle height before blaming cadence — position problems masquerade as pedalling problems.",
    quiz: [
      { q: "The general efficiency sweet spot is:", options: ["50–60rpm", "80–95rpm", "110–130rpm"], correct: 1 },
      { q: "Seated low-cadence work is best used:", options: ["Every ride, all ride", "In short blocks as muscular endurance work", "Never"], correct: 1 },
      { q: "If knees ache at a steady cadence, first check:", options: ["Your shoe brand", "Saddle height and position", "The weather"], correct: 1 },
    ]},
  { id: "cy-002", category: "Tactics", title: "Drafting and Group Riding: The Basics", duration: "5 min",
    summary: "The ~30% energy saving, how to hold a wheel, and the calls that keep everyone upright.",
    tags: ["drafting", "group ride", "peloton", "slipstream", "safety"],
    sports: ["Cycling"], goals: ["Endurance"], difficulty: "Beginner", contentType: "Guide",
    takeaways: ["Riding a wheel behind someone saves roughly 20–30% of your energy.", "Smooth, predictable, no sudden braking — that's the whole skill.", "Call out hazards and overlaps loudly; groups survive on communication."],
    views: 5800, saves: 480,
    body: "Riding alone into the wind, roughly a third of your effort is pushing air out of the way. Sit a wheel behind someone and that cost mostly disappears — drafting saves around 20–30% of energy, which is why group riding feels unfairly easy and why solo breaks rarely survive.\n\nHolding the wheel: ride about 30–60cm off the rear of the rider ahead, smooth and steady. Watch one wheel ahead — through their hip, past them — so you see hazards early instead of reacting to their brake. Keep your line predictable, brake with the rear brake lightly and early, and never surge-and-coast, which yo-yos the group.\n\nCommunication keeps everyone upright: call 'car back', 'hole', 'slowing'; point out glass and gravel. If your front wheel overlaps the rider beside you, ease back immediately — an overlap is how crashes start.\n\nPractise in a calm group on quiet roads before you ride anything aggressive. Confidence in a group is a skill built at low speed.",
    quiz: [
      { q: "Drafting behind a rider saves roughly:", options: ["2–3%", "20–30%", "60%"], correct: 1 },
      { q: "In a group you should watch:", options: ["Your front wheel", "One rider ahead — through their hip", "Your computer only"], correct: 1 },
      { q: "The most predictable (safest) riding is:", options: ["Surging and coasting", "Smooth and steady with early calls", "Braking hard and often"], correct: 1 },
    ]},

  // ==================== RUGBY / GOLF / CRICKET / GYMNASTICS / COMBAT ====================

  { id: "rg-001", category: "Strength", title: "Contact Ready: Strength for Rugby", duration: "6 min",
    summary: "Neck strength, hip-hinge power and smart load management for collision sports.",
    tags: ["rugby", "contact", "neck strength", "collision", "conditioning"],
    sports: ["Rugby"], goals: ["Strength", "Power"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["Neck strength training is a real, evidence-backed injury-risk reducer.", "Hip hinges and carries build the tackle-and-ruck engine.", "Rugby fitness is repeat-power, not long-distance jogging."],
    views: 6100, saves: 540,
    body: "Rugby asks your body to produce force, absorb force, and repeat both while tired. Training should mirror that.\n\nNeck first — and seriously. Progressive neck strengthening (isometric holds against a band or partner, extension/flexion work) reduces concussion risk factors and prepares you for contact. It's the most under-done training in amateur rugby.\n\nThe engine: trap-bar deadlifts and hip hinges for tackling power, farmer's carries for grip and trunk strength, split squats for the low positions of the breakdown. Rep ranges of 3–6 build force without bulk that slows you.\n\nConditioning for the actual game: repeated high-intensity efforts — sprint, contest, reset — not steady 5km runs. Shuttle intervals with short rests model the sport far better.\n\nAnd manage load honestly: contact sessions are training stress too. A week with two full-contact sessions shouldn't also include heavy leg days on top. Growing athletes should build contact exposure gradually across a season, not all at once in week one.",
    quiz: [
      { q: "Neck strengthening is:", options: ["A myth", "Evidence-backed for reducing injury risk factors", "Only for props"], correct: 1 },
      { q: "Rugby conditioning should model:", options: ["A 5km jog", "Repeated high-intensity efforts with short rests", "A marathon"], correct: 1 },
      { q: "Contact sessions count as:", options: ["Nothing — only lifting counts", "Real training load to manage", "Free fitness"], correct: 1 },
    ]},
  { id: "gl-001", category: "Technique", title: "Consistent Golf Starts From the Ground Up", duration: "6 min",
    summary: "Balance, weight transfer and sequencing — why the swing is a chain, not an arm action.",
    tags: ["golf swing", "balance", "weight transfer", "sequencing"],
    sports: ["Golf"], goals: ["Technique"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["Balance at finish position is the cheapest consistency check in golf.", "Power is sequenced: ground → hips → torso → arms → club.", "Groove tempo with a 3-count rather than chasing swing speed."],
    views: 5400, saves: 460,
    body: "Golf punishes variance, and the fastest way to reduce it is unglamorous: finish every swing in balance.\n\nThe check: hold your finish position — belt buckle facing the target, back foot up on the toe, weight fully on the lead leg — until the ball lands. If you can't, something upstream (tempo, weight transfer, swing speed) is stealing your balance, and the shot shape tells on you.\n\nThe sequence: good swings transfer weight to the back foot on the backswing, then fire the downswing from the ground up — hips start, torso follows, arms and club last. Swinging 'all arms' produces the weak, inconsistent ball flight that feels like maximum effort for minimum result.\n\nTempo before speed: a three-count rhythm (backswing one-two, through on three) beats swinging out of your shoes. Speed comes from sequence, and sequence holds up on the 18th.\n\nDrill it: feet-together shots and slow-motion finish holds teach transfer and balance faster than any other practice block.",
    quiz: [
      { q: "Holding your finish position checks:", options: ["Your grip", "Balance — and exposes tempo or transfer faults", "Ball spin"], correct: 1 },
      { q: "The downswing should start from:", options: ["The hands", "The ground — hips first", "The shoulders"], correct: 1 },
      { q: "Consistency comes mostly from:", options: ["Maximum swing speed", "Tempo and sequencing", "New equipment"], correct: 1 },
    ]},
  { id: "ck-001", category: "Technique", title: "Cricket: Building a Repeatable Bowling Action", duration: "6 min",
    summary: "Alignment, back-foot contact and front-arm leverage — plus why workloads are monitored, not guessed.",
    tags: ["bowling", "action", "workload", "cricket technique", "fast bowling"],
    sports: ["Cricket"], goals: ["Technique"], difficulty: "Beginner", contentType: "Technique",
    takeaways: ["A repeatable action beats a spectacular one — alignment first.", "The front arm drives the delivery; pull it down toward the hip.", "Bowling workloads are tracked and progressed gradually, especially under 18."],
    views: 4900, saves: 410,
    body: "Fast bowling is a chain of positions, and repeatability — hitting the same positions every ball — is what separates reliable bowlers from streaky ones.\n\nAlignment: run up straight, back-foot contact parallel to the crease, hips and shoulders facing down the pitch. Twisting in or out leaks energy and strains the back.\n\nThe lever: the front arm is the rudder. Reach high and pull it down sharply toward the hip as the bowling arm comes over — that timing creates the whip. Bowling-arm-only efforts look strong and bowl weak.\n\nThen there's workload — the part young bowlers ignore. Lumbar stress injuries in pace bowlers track with sudden bowling spikes: big match weeks, winter-to-summer jumps, bowling tired through nets. The fix is boring and effective: track balls bowled per week, progress gradually (roughly no more than 10% jumps), and treat a red-hot match spell as real load. Growing fast bowlers should get guidance from a coach on limits — this is one sport where 'push through it' has documented costs.",
    quiz: [
      { q: "The front arm's job in the action is:", options: ["Decoration", "Driving down to create the whip", "Balancing only"], correct: 1 },
      { q: "Back-foot contact should be:", options: ["Twisted toward off side", "Aligned parallel to the crease", "Whatever feels natural"], correct: 1 },
      { q: "Bowling workload should be:", options: ["Guessed", "Tracked and progressed gradually", "Unlimited if you feel fine"], correct: 1 },
    ]},
  { id: "gy-001", category: "Strength", title: "Gymnastics Strength: Bodyweight Before Skills", duration: "5 min",
    summary: "Straight-arm strength, hollow holds and wrist prep — the base under every skill.",
    tags: ["gymnastics", "bodyweight", "core", "hollow hold", "strength"],
    sports: ["Gymnastics", "Calisthenics"], goals: ["Strength"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["Hollow-body position is the base of tumbling, bars and rings alike.", "Straight-arm strength (support, planche leans) develops slowly — start early, progress slowly.", "Wrist preparation is non-negotiable for growing gymnasts."],
    views: 4600, saves: 400,
    body: "Gymnastics skills are built on strength positions, and three of them underpin almost everything.\n\nThe hollow: a straight, slightly piked body with lower back pressed to the floor, arms by the ears. Tumbling, swings and handstands all happen in or around hollow. Twenty to sixty seconds of quality hollow holds a day does more for tight, clean shapes than any amount of skill repetition on a loose shape.\n\nStraight-arm strength: support holds on parallel bars or parallettes, rings turned out, planche leans on the floor. These load shoulder and elbow tissue in exactly the way skills demand — and connective tissue adapts slower than muscle, so progressions take months by design. Low, frequent, consistent beats hard, rare and injured.\n\nWrist prep: growing gymnasts load small wrists with big body weights. Warm them every session — circles, rocks, loaded extension stretches — and treat wrist pain as a signal to regress volume, not push through.\n\nStrength first is not the slow path. It's the path that keeps you training.",
    quiz: [
      { q: "The hollow-body position trains:", options: ["Flexibility only", "The base shape for most skills", "Balance beam only"], correct: 1 },
      { q: "Connective tissue adapts:", options: ["Faster than muscle", "Slower than muscle — hence slow progressions", "Instantly"], correct: 1 },
      { q: "Wrist pain during training means:", options: ["Push harder", "Regress volume and prep properly", "Ignore it"], correct: 1 },
    ]},
  { id: "cm-001", category: "Nutrition", title: "Making Weight: What's Actually Safe", duration: "7 min",
    summary: "Gradual fat-loss timelines, hydration status, and the honest line on weight cutting — especially under 18.",
    tags: ["weight cutting", "making weight", "combat sports", "nutrition", "safety", "boxing", "mma"],
    sports: ["Combat Sports", "Boxing", "MMA", "Wrestling"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["Walk-around weight should sit close to your fight weight — big cuts are where harm happens.", "Aggressive dehydration impairs performance, reaction time and brain health — it's a loss, not a tactic.", "Athletes under 18 should not be doing water cuts or sauna cuts, full stop."],
    views: 8200, saves: 720,
    body: "Weight-making in combat sports is where nutrition advice goes to die, so here is the honest version.\n\nThe safe model: compete near your walk-around weight. If your body's healthy fighting weight is 3–5% above the limit, you make weight with normal food discipline in the final weeks — no drama. Repeated large cuts (8–10%+ of body mass in water) are associated with worse performance, slower reaction time, impaired mood, and real long-term health risks, including to the developing brain.\n\nIf you need to lose actual body mass: do it in the off-season, gradually — roughly 0.5% of body weight per week through a modest calorie deficit with protein held high. That preserves training quality and muscle.\n\nWater loading and sauna protocols: these are adult, medically-supervised practices at best, and dangerous when copied from gym talk. For athletes under 18 the guidance is unambiguous — no dehydration cutting, no saunas for weight, no exceptions. Compete at a weight your body already supports.\n\nRecovery after weigh-in matters too: rehydrate with fluid plus electrolytes across the day, not a litre of water in an hour.",
    quiz: [
      { q: "The safest competition model is:", options: ["Repeated 8–10% water cuts", "Competing near your walk-around weight", "Sauna cuts before every weigh-in"], correct: 1 },
      { q: "Aggressive dehydration before competing:", options: ["Improves performance", "Impairs reaction time and carries health risks", "Has no effect"], correct: 1 },
      { q: "For under-18 athletes, weight cutting by dehydration:", options: ["Is fine in moderation", "Should not be done at all", "Is fine with a coach watching"], correct: 1 },
    ]},

  // ==================== TRAINING / STRENGTH / PSYCHOLOGY / INJURY ====================

  { id: "tr-001", category: "Training", title: "Progressive Overload: The Engine of Improvement", duration: "5 min",
    summary: "The one principle every training plan runs on — and the four ways to apply it.",
    tags: ["progressive overload", "training principles", "adaptation", "programming"],
    goals: ["Training"], difficulty: "Beginner", contentType: "Explainer",
    takeaways: ["Adaptation needs a reason: a gradually increasing demand.", "Overload can be load, volume, density, or complexity — not just heavier.", "Bigger jumps ≠ faster gains; ~5–10% steps keep you training, not injured."],
    views: 13100, saves: 1740, trending: true,
    body: "Your body changes when a demand exceeds what it's used to, and repeats. That's progressive overload — the engine behind every plan in every sport.\n\nThere are four dials, and only one of them is weight: intensity (heavier, faster, harder), volume (more reps, more kilometres, more sets), density (same work in less time, shorter rests), and complexity (harder variations, new skills). Beginners improve fastest rotating volume and complexity; advanced athletes live on intensity.\n\nThe mistake is confusion between overload and punishment. A sensible step is roughly 5–10% more load or a small volume increase per week, with down weeks built in every 4–6 weeks — adaptation happens in the recovery after a stress, not during the stress itself.\n\nThe flip side is just as true: doing the same sessions forever stops working, because the demand stopped being new. If your training has felt easy-but-unchanged for a month, something needs a dial — pick one, not four.",
    quiz: [
      { q: "Progressive overload means:", options: ["Training to failure daily", "Gradually increasing training demand over time", "Always lifting heavier"], correct: 1 },
      { q: "A sensible progression step is roughly:", options: ["Double everything", "5–10% at a time", "Whatever hurts"], correct: 1 },
      { q: "Adaptation actually happens:", options: ["During the hard session", "During recovery after the stress", "Only with supplements"], correct: 1 },
    ]},
  { id: "tr-002", category: "Training", title: "How to Structure a Training Week", duration: "7 min",
    summary: "Hard days hard, easy days easy — the simple architecture behind every good plan.",
    tags: ["training week", "programming", "recovery days", "hard easy", "schedule"],
    goals: ["Training", "Endurance"], difficulty: "Intermediate", contentType: "Guide",
    takeaways: ["Alternate hard and easy days instead of drifting to a medium mush.", "2–3 genuinely hard sessions a week is the productive ceiling for most.", "A full rest day is training — it's when the adaptations land."],
    views: 8700, saves: 880,
    body: "Most training weeks fail the same way: not too hard, but the same. Six sessions of medium effort produce fatigue without a strong enough signal to force adaptation. The fix is architecture.\n\nHard days hard, easy days easy. Pick 2–3 days a week for genuinely hard work (intervals, heavy lifting, match intensity) and keep everything else genuinely easy — you should finish an easy day feeling better than you started.\n\nSpace the stress. Hard sessions need 48 hours before the next hard one — typically hard, easy, hard, easy, hard, easy, rest. Put your hardest sessions when you're freshest, not when the schedule happens to allow.\n\nOne full rest day. Not optional, not a weakness: sleep, food and rest are where the last session actually turns into improvement.\n\nAnd keep one variable primary per week — if it's a heavy strength week, don't also peak your intervals. Load spikes (the ACWR lesson covers the maths) come from stacking ambitions, not from single sessions.",
    quiz: [
      { q: "The most common training-week mistake is:", options: ["Too many rest days", "A week of identical medium-effort sessions", "Warming up"], correct: 1 },
      { q: "Hard sessions should be separated by about:", options: ["12 hours", "48 hours", "A week"], correct: 1 },
      { q: "A full rest day each week is:", options: ["Optional for the committed", "Part of the training plan", "A sign of laziness"], correct: 1 },
    ]},
  { id: "st-001", category: "Strength", title: "Why Strength Transfers to Sport (and How to Make It)", duration: "6 min",
    summary: "Force production, rate of force development, and why strength training isn't bodybuilding.",
    tags: ["strength training", "force", "power", "transfer", "gym"],
    goals: ["Strength", "Power"], difficulty: "Intermediate", contentType: "Article",
    takeaways: ["Sport is force against the ground/opponent — strength raises the ceiling.", "Train movements and speed of intent, not muscles in isolation.", "Strength work supports sport skill; it never replaces it."],
    views: 9400, saves: 1010,
    body: "Every sporting action is your muscles producing force against the ground, a ball, or an opponent. Strength training raises how much force you can produce — which is why it helps sprinters, swimmers, gymnasts and footballers alike, even though none of them compete in a gym.\n\nBut transfer isn't automatic. Three rules decide whether gym work improves sport:\n\n1. Movements over muscles. Squats, hinges, presses, pulls and carries train the patterns sport uses. Bicep curls don't appear in any sport's force profile.\n2. Intent over grind. Lifting fast (with moderate loads) trains rate of force development — the quality most sports actually demand. Slow grinding sets build size more than speed.\n3. Strength supports skill, never replaces it. The gym raises the ceiling; sport practice teaches you to reach it. A footballer who only lifts becomes strong and still slow to react.\n\nFor developing athletes (roughly 12–16), bodyweight mastery and technique-first barbell work build the same qualities safely — strength is a decade-long project, not a six-week scramble.",
    quiz: [
      { q: "Strength transfers to sport best when training emphasises:", options: ["Isolation exercises", "Sport-relevant movement patterns with intent", "Maximum soreness"], correct: 1 },
      { q: "'Rate of force development' means:", options: ["How fast you produce force", "How heavy you can lift", "How long you can run"], correct: 0 },
      { q: "Gym work relative to sport practice should be:", options: ["A replacement", "A support that raises the ceiling", "Irrelevant"], correct: 1 },
    ]},
  { id: "ps-001", category: "Psychology", title: "Pre-Performance Routines: Why Yours Actually Works", duration: "5 min",
    summary: "The evidence behind routines — attention, anxiety control and the 'same as practice' effect.",
    tags: ["routine", "pre-performance", "ritual", "focus", "consistency"],
    goals: ["Mental", "Confidence"], difficulty: "Beginner", contentType: "Article",
    takeaways: ["Routines work through attention control, not magic.", "Keep routines short, behavioural and repeatable — 10–30 seconds.", "Build the routine in practice or it won't exist in competition."],
    views: 7800, saves: 830,
    body: "Rituals look superstitious. Routines are not rituals — they're structured sequences with a mechanism, and the mechanism is attention.\n\nPre-performance routines do three measurable things: they narrow attention onto task-relevant cues (the ball, the target) and away from worry; they regulate arousal through steady breathing and pacing; and they make competition feel the same as practice — the 'same as training' effect is why rehearsed routines hold up while improvised focus collapses.\n\nWhat works: short (10–30 seconds), behavioural, and repeatable. A free-throw routine of two dribbles, one breath, rim-focus, shoot. A serve routine of bounce-breathe-toss. A sprinter's block routine of cue words. What doesn't: long visualisation sessions in the moment, superstitions without an action attached, and routines so elaborate that disruption breaks you.\n\nThe building rule matters most: rehearse the routine in every practice rep of the skill. A routine that exists only on competition day is a new skill executed under maximum pressure — the exact definition of a bad idea.",
    quiz: [
      { q: "Pre-performance routines work mainly through:", options: ["Superstition", "Attention control and arousal regulation", "Intimidation"], correct: 1 },
      { q: "A good routine is:", options: ["Long and elaborate", "Short, behavioural and repeatable", "Different every time"], correct: 1 },
      { q: "Routines should be built:", options: ["Only on competition day", "In practice, on every rep", "The night before"], correct: 1 },
    ]},
  { id: "ps-002", category: "Psychology", title: "Handling Nerves Before You Compete", duration: "4 min",
    summary: "Nerves are fuel with bad branding — reframing arousal, breathing and process focus.",
    tags: ["nerves", "anxiety", "arousal", "competition", "pressure", "mental"],
    goals: ["Mental"], difficulty: "Beginner", contentType: "Article",
    takeaways: ["Racing heart and nerves are your body preparing — relabel them as readiness.", "Slow exhales (4 in, 6 out) downshift the nervous system in about a minute.", "Focus on process cues you control, not outcomes you can't."],
    views: 11900, saves: 1420, trending: true,
    body: "The pounding heart before competition isn't malfunction — it's mobilisation. Blood shifts to working muscles, senses sharpen, energy releases. The difference between 'nerves' and 'ready' is largely the label you give the same physical state: research on arousal reappraisal shows athletes told to read their racing heart as readiness perform better than those told to calm down.\n\nThat doesn't mean white-knuckling it. Two tools settle the noise:\n\nBreath: four seconds in, six slow seconds out, for a minute. Long exhales activate the body's braking system — the fastest lever you have, usable in the tunnel, the corridor, the blocks.\n\nAttention: nerves feed on outcomes ('what if I fail'). Process cues starve them: your routine, your first step, your first touch, your pace. Ask 'what does my first minute look like?' instead of 'what will the result be?'\n\nAnd normalise it: nearly every elite performer reports pre-competition nerves. The goal was never to stop feeling — it's to perform while feeling.",
    quiz: [
      { q: "The physiological arousal before competing is:", options: ["A malfunction", "Mobilisation — the same state as readiness", "Always harmful"], correct: 1 },
      { q: "The breathing pattern that settles the nervous system:", options: ["Fast shallow breaths", "Long exhales — e.g. 4 in, 6 out", "Holding your breath"], correct: 1 },
      { q: "Under pressure, focus on:", options: ["The result", "Process cues you control", "The crowd"], correct: 1 },
    ]},
  { id: "in-001", category: "Injury Prevention", title: "A Warm-Up That Actually Prepares You", duration: "5 min",
    summary: "The RAMP protocol — Raise, Activate, Mobilise, Potentiate — in plain language.",
    tags: ["warm up", "ramp", "preparation", "injury prevention", "mobility"],
    goals: ["Training"], difficulty: "Beginner", contentType: "Guide",
    takeaways: ["Replace static-only stretching with progressive, movement-based preparation.", "RAMP: Raise pulse → Activate muscles → Mobilise through range → Potentiate with intensity.", "The last part — ramping to game intensity — is the one everyone skips."],
    views: 9900, saves: 960,
    body: "A warm-up has one job: arrive at the first minute of competition already moving at it. The RAMP structure gets you there in 10–15 minutes.\n\nRaise: 3–5 minutes of easy activity — jog, skip, bike — to lift heart rate, temperature and blood flow.\n\nActivate: wake up the muscles that matter — glute bridges, band walks, calf raises, scap work. Two minutes of targeted activation beats ten minutes of lounging.\n\nMobilise: move through the ranges you'll use — leg swings, lunges with rotation, arm circles, ankle rocks. Dynamic mobility here, not long static holds; deep static stretching immediately before power work slightly blunts performance.\n\nPotentiate: ramp intensity to game speed — short sprints, jumps, hard passes, match-tempo movements, finishing at 90–100% of the day's demands. This is the phase almost everyone skips, and it's the reason the first ten minutes of matches feel like a different sport.\n\nThe test of a good warm-up: your first hard sprint isn't the first hard sprint of your day.",
    quiz: [
      { q: "RAMP stands for:", options: ["Run And Move Promptly", "Raise, Activate, Mobilise, Potentiate", "Rest, Apply, Measure, Perform"], correct: 1 },
      { q: "Long static stretching immediately before power work:", options: ["Boosts performance", "Can slightly blunt power output", "Is essential"], correct: 1 },
      { q: "The most commonly skipped warm-up phase:", options: ["Raising pulse", "Potentiating up to game intensity", "Mobilising"], correct: 1 },
    ]},
  { id: "in-002", category: "Injury Prevention", title: "Training Through Growth Spurts (12–17)", duration: "6 min",
    summary: "Why developing athletes get hurt in growth phases — load spikes, and the signs to respect.",
    tags: ["growth spurt", "youth athletes", "load management", "osgood schlatter", "developing athlete"],
    goals: ["Training"], difficulty: "Beginner", contentType: "Article",
    takeaways: ["Bones grow faster than tendons adapt — that gap is where growth-phase pain lives.", "Sudden load spikes, not training itself, drive most youth overuse injuries.", "Growing-plate pain (knees, heels, hips) means adjust now, not push through."],
    views: 5300, saves: 520,
    body: "For athletes between roughly 12 and 17, injury risk has a shape: it spikes during growth spurts, when bones lengthen faster than tendons and coordination keep up. The knee (Osgood-Schlatter), heel (Sever's) and hip are the classic sites — growing-plate pain, not weakness.\n\nThe driver is almost never 'too much training' in general — it's the spike: a new team mid-season, three sessions replacing two, a camp week, a leap in strength training. Load changes of more than ~10–20% week-to-week during a growth phase are where overuse injuries concentrate.\n\nThe practical playbook:\n\n• Keep weekly load progression gentle during spurts, and let sport skill variety do the developing — multi-sport exposure builds broader, more robust athletes than early specialisation.\n• Respect the signals: knee or heel pain that warms up but returns after, night-time aches after sessions, limping into the next day. Adjust volume for a week, not the season.\n• Maintain strength and mobility through spurts — the skeleton changed, the movement patterns need re-grooving.\n\nNone of this means train soft. It means the developing athlete's superpower is consistency across months — growth phases reward patience disproportionately.",
    quiz: [
      { q: "Growth-phase injury risk spikes because:", options: ["Bones grow faster than tendons adapt", "Young athletes are weak", "Sport is dangerous"], correct: 0 },
      { q: "The strongest driver of youth overuse injury:", options: ["Training at all", "Sudden load spikes week-to-week", "Strength training"], correct: 1 },
      { q: "Growing-plate pain (knee/heel) should:", options: ["Be pushed through", "Trigger immediate load adjustment", "Be stretched harder"], correct: 1 },
    ]},

  // ==================== QUICK LEARN ====================

  { id: "ql-001", category: "Training", title: "What Is Progressive Overload?", duration: "1 min",
    summary: "The 60-second version of the principle every plan runs on.",
    tags: ["progressive overload", "basics", "quick"], goals: ["Training"],
    difficulty: "Beginner", contentType: "Explainer", views: 6200, saves: 540,
    body: "Your body adapts to demands slightly beyond what it's used to. Progressive overload is the practice of nudging that demand up over time — a little more weight, a few more reps, a faster interval, a harder variation.\n\nThe rule of thumb: change one thing by roughly 5–10%, let your body adapt for a week or two, then nudge again. Adaptation happens in recovery, so the nudge-recover-nudge rhythm beats constant escalation.\n\nNo progression, no plateau-breaking: the same sessions forever produce the same athlete.",
    quiz: [
      { q: "Progressive overload is:", options: ["Gradually increasing the training demand", "Training to exhaustion daily", "A warm-up method"], correct: 0 },
      { q: "A sensible nudge is about:", options: ["5–10% at a time", "Double each week", "Never change anything"], correct: 0 },
    ]},
  { id: "ql-002", category: "Training", title: "Aerobic vs Anaerobic: 60 Seconds", duration: "1 min",
    summary: "Two energy systems, one sentence each, and why your sport needs to know both.",
    tags: ["aerobic", "anaerobic", "energy systems", "conditioning"], goals: ["Endurance", "Training"],
    difficulty: "Beginner", contentType: "Explainer", views: 5700, saves: 490,
    body: "Aerobic means with oxygen: sustainable effort your body can fuel for minutes to hours — jogging, long rides, the base that lets you recover between everything.\n\nAnaerobic means without oxygen: short, intense bursts powered by stored fuel — sprints, jumps, the last 100m. It fatigues fast and needs recovery.\n\nEvery sport uses both in a mix: football is aerobic with anaerobic bursts; 800m sits almost exactly between them. Train the mix your sport demands, not the one that feels familiar.",
    quiz: [
      { q: "Aerobic energy:", options: ["Powers short sprints", "Fuels sustainable, oxygen-supported effort", "Only matters for runners"], correct: 1 },
      { q: "A 400m sprint relies heavily on:", options: ["Aerobic only", "Anaerobic systems", "Pure technique"], correct: 1 },
    ]},
  { id: "ql-003", category: "Recovery", title: "Why Sleep Affects Performance", duration: "2 min",
    summary: "The 90-second case for sleep being your best legal performance enhancer.",
    tags: ["sleep", "recovery", "quick", "performance"], goals: ["Recovery"],
    difficulty: "Beginner", contentType: "Explainer", views: 8100, saves: 870,
    body: "During deep sleep your body does its maintenance: growth hormone release for tissue repair, glycogen restocking, and nervous-system recovery. Skimp on it and every other input — training quality, reaction time, mood, injury resilience — runs at a discount.\n\nThe numbers worth knowing: athletes sleeping under 7 hours show around 1.7× the injury risk of those sleeping 8+; reaction time measurably degrades on short sleep; and one bad night doesn't ruin you — chronic short sleep does.\n\nThe fix is boring and free: a consistent bedtime, 8–9 hours as the target, screens down before sleep. Nothing else in your recovery stack comes close.",
    quiz: [
      { q: "Deep sleep is when:", options: ["Nothing happens", "Growth hormone and tissue repair peak", "You burn no energy"], correct: 1 },
      { q: "Chronic short sleep is linked to:", options: ["Higher injury risk and slower reactions", "Better performance", "Nothing measurable"], correct: 0 },
    ]},
  { id: "ql-004", category: "Training", title: "What Is RPE?", duration: "1 min",
    summary: "Rate of Perceived Exertion — the 1–10 scale that makes every session measurable.",
    tags: ["rpe", "intensity", "perceived exertion", "load"], goals: ["Training"],
    difficulty: "Beginner", contentType: "Explainer", views: 6900, saves: 610,
    body: "RPE (Rate of Perceived Exertion) is how hard a session felt, on a 1–10 scale: 1–2 easy, 5–6 comfortably hard, 9–10 all-out. Multiply by session duration and you get a load number you can track across weeks.\n\nWhy it matters: it makes training volume visible across sports and sessions (VAYLO's training load tools use exactly this), and it catches the trap of medium-effort weeks — six sessions at RPE 6 feel productive and adapt you slowly.\n\nThe skill is honesty. Rate what it felt like, not what the plan hoped.",
    quiz: [
      { q: "RPE stands for:", options: ["Rate of Perceived Exertion", "Rapid Power Exercise", "Required Performance Energy"], correct: 0 },
      { q: "RPE × duration gives you:", options: ["A load number you can track", "Your VO2 max", "Nothing useful"], correct: 0 },
    ]},
  { id: "ql-005", category: "Recovery", title: "What Is a Deload Week?", duration: "2 min",
    summary: "The planned easy week that keeps progress running — and why it isn't lost time.",
    tags: ["deload", "recovery week", "fatigue", "programming"], goals: ["Recovery", "Training"],
    difficulty: "Beginner", contentType: "Explainer", views: 4400, saves: 430,
    body: "A deload week is a planned, temporary reduction in training volume or intensity — typically cutting volume by 40–50% while keeping movement quality high — scheduled every 4–6 weeks of hard training.\n\nWhy it works: fatigue accumulates faster than fitness during hard blocks, and performance eventually masks it. A deload lets fatigue dissipate while fitness stays, which is why athletes often set personal bests the week after one.\n\nIt isn't lost time and it isn't laziness — it's periodisation in miniature. Plan it; don't wait for your body to schedule it for you with an injury or a slump.",
    quiz: [
      { q: "A deload week typically cuts volume by:", options: ["10%", "40–50%", "100% — total rest"], correct: 1 },
      { q: "Athletes often perform best:", options: ["Mid hard-block", "The week after a deload", "Never"], correct: 1 },
    ]},
];
