// ============================================================================
// FORM DRILLS — the free technique library behind the Form tab
// ----------------------------------------------------------------------------
// Presentation-free structured data, like src/lib/learningContent.ts: the Form
// screen renders what this module returns and keeps no drill copy of its own.
//
// Every drill names the sport families it is for. The tab itself is available to
// every athlete (see src/lib/personalization/features.ts — form is a universal
// feature), but what is *in* it is personal: a runner gets running drills, a
// lifter gets lifting drills, and neither is shown the other's. `families: ["*"]`
// is the small foundation set that is genuinely every sport's — a landing, a
// hinge, an ankle — and the screen labels it "Foundations" so nobody reads it as
// another sport's work.
//
// Fails open, like the personalisation engine it feeds: an athlete whose sport
// the app cannot classify (no sport stored, or the "Other" bucket, which is the
// app saying it does not know) gets the whole library rather than an empty
// screen — see drillsForFamilies.
// ============================================================================

import type { SportFamily } from "./personalization/sports";

/** A drill's audience: one sport family, or "*" for the shared foundation set. */
export type DrillFamily = SportFamily | "*";

export type FormDrill = {
  id: string;
  title: string;
  /** One line: what the movement is. */
  what: string;
  /** One line: the fault it fixes, or what it buys. */
  why: string;
  /** Ordered how-to. */
  steps: string[];
  /** Short things to say to yourself while doing it. */
  cues: string[];
  families: DrillFamily[];
};

export const FORM_DRILLS: FormDrill[] = [
  /* ── Foundations — every sport ─────────────────────────────────────────── */
  {
    id: "jump-landing",
    title: "Jump Landing & Knee Alignment",
    what: "Landing a two-footed hop quietly, with the knee tracking over the toe.",
    why: "Most non-contact knee injuries happen in the second after a landing. Rehearsing the landing rehearses the injury away.",
    steps: [
      "Stand tall, feet hip-width apart and pointing forward.",
      "Hop forward off two feet and land on both at the same time.",
      "Absorb by bending hips and knees — knees travel over the toes and never cave inward.",
      "Hold the landing still for two seconds, then stand up.",
      "3 sets of 5, checking in a mirror or on video.",
    ],
    cues: ["Quiet landing — if it thuds, it was too stiff", "Knees over toes, never in", "Hips back, chest up", "Stick it for two seconds"],
    families: ["*"],
  },
  {
    id: "hip-hinge",
    title: "Hip Hinge (Broomstick)",
    what: "Hinging from the hips with the spine held long, using a broomstick as a reference.",
    why: "Hinging from the hips instead of the lower back is the difference between a strong pull, a fast sprint and a sore back.",
    steps: [
      "Hold a broomstick down your spine so it touches head, upper back and tailbone.",
      "Set the feet hip-width, knees softly bent and still.",
      "Push the hips straight back until the torso is close to parallel with the floor.",
      "Keep all three contact points touching on the way down and the way up.",
      "3 sets of 8, slowly, with no weight.",
    ],
    cues: ["Hips back, not down", "Shins stay vertical", "Spine stays long", "Squeeze the glutes to stand"],
    families: ["*"],
  },
  {
    id: "pogo-hops",
    title: "Pogo Hops (Ankle Stiffness)",
    what: "Small, fast hops in place that use the ankles only.",
    why: "A stiff ankle returns more of the energy a stride puts into the ground — it shows up as faster, cheaper running and sharper direction changes.",
    steps: [
      "Stand tall with the hands on the hips and the knees almost straight.",
      "Hop in place using only the ankles — the knees barely bend.",
      "Land on the balls of the feet and leave the ground again immediately.",
      "3 sets of 20 hops, keeping the rhythm even.",
    ],
    cues: ["Bounce like a spring, don't squat", "The ankles do the work", "Land and leave — no pause", "Stay tall"],
    families: ["*"],
  },

  /* ── Endurance — running, cycling, swimming, triathlon ─────────────────── */
  {
    id: "a-skips",
    title: "A-Skips",
    what: "A running drill that isolates the knee drive and the foot strike under the hip.",
    why: "It grooms the front of the stride at walking pace, where you can feel the error before it becomes a habit at speed.",
    steps: [
      "Walk tall and relaxed, hands at hip height.",
      "Drive one knee up to waist height with the foot pulled up (toe towards the shin).",
      "Let the leg drop back down, striking under the hip rather than out in front.",
      "Take a small hop off the standing leg, then repeat on the other side.",
      "2–3 × 30m, then repeat as a faster skip.",
    ],
    cues: ["Knee to waist height", "Toe up on the drive", "Land under the hip", "Tall, not leaning back"],
    families: ["endurance"],
  },
  {
    id: "b-skips",
    title: "B-Skips",
    what: "An A-Skip that adds a leg extension and a pawing action through the ground.",
    why: "It trains the pull-back of the foot that puts force into the ground instead of braking in front of the body.",
    steps: [
      "Start as for the A-Skip: tall posture, knee driven to waist height.",
      "Let the knee unfold so the lower leg reaches forward.",
      "Paw the foot back and down so it strikes under the hip.",
      "Hop over the planted leg and repeat on the other side.",
      "2–3 × 30m, smooth rather than fast.",
    ],
    cues: ["Extend, then paw back", "Foot lands under you", "Don't reach forward", "Tall through the trunk"],
    families: ["endurance"],
  },
  {
    id: "high-knees",
    title: "High Knees",
    what: "Running in place with the knees driven to hip height and a quick rhythm.",
    why: "Builds the turnover and hip-flexor drive that separate a heavy shuffle from a light, fast stride.",
    steps: [
      "Run in place with the knees coming up to hip height.",
      "Stay on the balls of the feet with a fast, even cadence.",
      "Keep the torso upright and the arms driving in time.",
      "3 × 20 seconds, with the last 5 seconds the fastest.",
    ],
    cues: ["Knees to hip height", "Quick feet, light contact", "Arms drive the rhythm", "Stand tall"],
    families: ["endurance"],
  },
  {
    id: "butt-kicks",
    title: "Butt Kicks",
    what: "Running in place with the heel snapping up to the glute.",
    why: "Trains the hamstring to recover the leg quickly, so the stride keeps cycling instead of trailing behind you.",
    steps: [
      "Run in place and snap one heel up to the glute.",
      "Keep the knee under the hip instead of letting it swing forward.",
      "Keep the contacts light and quick.",
      "3 × 20 seconds, alternating legs.",
    ],
    cues: ["Heel to glute", "Knee stays under the hip", "Light, fast contacts", "Relaxed shoulders"],
    families: ["endurance"],
  },
  {
    id: "cadence-ladder",
    title: "Cadence Ladder",
    what: "Short runs at a set step rate, counted and repeated.",
    why: "Overstriding — landing with the foot out in front — is the most common cause of heavy, injury-prone running, and cadence is the dial you can hear change.",
    steps: [
      "Run 2 minutes at a comfortable pace and count your steps for 30 seconds.",
      "Double that count to get steps per minute.",
      "Take a metronome or music track 5–8% faster and run 4 × 1 minute to that beat.",
      "Keep the stride short and the feet light — do not lengthen the steps.",
      "Twice a week for a month, then measure the count again.",
    ],
    cues: ["Shorten, don't lengthen", "Light, quick steps", "Feet land under you", "Relaxed shoulders"],
    families: ["endurance"],
  },
  {
    id: "pedal-stroke",
    title: "Pedal Stroke (Single-Leg)",
    what: "Pedalling with one leg to feel the whole circle rather than only the down-stroke.",
    why: "Most riders push down and let the leg go dead; smoothing the top and bottom of the stroke is free speed at the same effort.",
    steps: [
      "Put the bike in a light gear on a trainer or a quiet road.",
      "Unclip one leg and rest it on the frame.",
      "Pedal with the working leg, thinking of scraping back at the bottom and pulling over the top.",
      "30–45 seconds per leg, 3 rounds each.",
      "Finish with 5 minutes of normal riding at the same cadence.",
    ],
    cues: ["Push down, pull back, up, over", "Knee stays over the pedal", "Quiet hips — no rocking", "Light gear, smooth circle"],
    families: ["endurance"],
  },
  {
    id: "freestyle-catch",
    title: "Freestyle Catch (Sculling)",
    what: "Drilling the first phase of the stroke so the forearm catches water instead of slipping through it.",
    why: "An early vertical forearm anchors the arm. Without it, extra effort goes nowhere and the stroke count climbs.",
    steps: [
      "Push off the wall with both arms extended.",
      "Hold one arm out front and sweep the other hand in and out, elbow high.",
      "Feel the water on the forearm, not on the palm alone.",
      "Add six kicks per scull, then take a stroke and repeat on the other side.",
      "4 × 25m, counting strokes per length before and after.",
    ],
    cues: ["Elbow high, forearm down", "Hold water, don't slip it", "Eyes down, hips high", "Finish past the hip"],
    families: ["endurance"],
  },

  /* ── Team — football, rugby, basketball, cricket ──────────────────────── */
  {
    id: "agility-ladder",
    title: "Agility Ladder Patterns",
    what: "Quick-feet patterns through a floor ladder.",
    why: "Trains the foot contacts and coordination that change of direction is built from, at a load low enough to do often.",
    steps: [
      "Lay the ladder out and stand facing it in an athletic stance — hips down, chest up.",
      "Step one foot per square, keeping the contacts light and precise.",
      "Work through 3–4 patterns: one-in, in-in-out, lateral and the icky shuffle.",
      "Each pattern twice, resting fully between.",
    ],
    cues: ["Light, precise contacts", "Stay low, hips down", "Eyes up, not on your feet", "Arms drive the feet"],
    families: ["team"],
  },
  {
    id: "change-of-direction",
    title: "Cutting & Change of Direction",
    what: "Practising the plant, the turn and the exit at speed.",
    why: "A cut is decided in the first two steps of the exit. Training the plant away from the game is how you stop losing that half-second.",
    steps: [
      "Set two cones 5–8m apart at a shallow angle.",
      "Approach at 70% speed, then shorten the last two steps and drop the hips.",
      "Plant the outside foot, turning through the inside of it, and lean into the new line.",
      "Exit with three low, explosive steps, then slow down and repeat 6 times each side.",
    ],
    cues: ["Short last two steps", "Plant outside foot, turn through it", "Hips down, lean into the new line", "Three explosive steps out"],
    families: ["team"],
  },
  {
    id: "sprint-start",
    title: "Sprint Start (Acceleration)",
    what: "The first 5–10 metres of a sprint from a standing start.",
    why: "A low, patient angle with a long first push beats standing up early and spinning the legs.",
    steps: [
      "Stand with one foot half a step ahead and the weight on the front foot.",
      "Fall forward until you have to step, then push the ground away behind you.",
      "Stay low for the first three steps — the torso rises gradually, not all at once.",
      "2–4 × 10m with full recovery, then a 20m version.",
    ],
    cues: ["Push the ground back, don't step out", "Stay low for three steps", "Long first push", "Rise gradually, pump the arms"],
    families: ["team"],
  },
  {
    id: "first-touch",
    title: "First Touch (Wall)",
    what: "Receiving a ball off a wall and taking the touch out of your feet into space.",
    why: "A first touch into space buys the half-second that turns a pass into a chance; killing it dead at your feet invites pressure.",
    steps: [
      "Face a wall 3–5m away with a marked square to your side.",
      "Pass into the wall, then scan — call out what is behind you.",
      "Receive on the half-turn and take the touch into the square.",
      "Play it back and repeat, 10 times on each foot.",
    ],
    cues: ["Scan before the ball arrives", "Open your hips to the space", "Cushion the ball, don't kill it", "Touch into space, then play"],
    families: ["team"],
  },
  {
    id: "passing-accuracy",
    title: "Passing Accuracy (Inside of the Foot)",
    what: "Striking a ball to a target with the inside of the foot.",
    why: "Most misplaced passes come from planting the standing foot in the wrong place, or from striking with a loose ankle.",
    steps: [
      "Place a target or a partner 10–15m away.",
      "Plant the standing foot beside the ball, pointing at the target.",
      "Lock the ankle and strike through the middle of the ball with the inside of the foot.",
      "Follow through towards the target. 20 times on each foot.",
    ],
    cues: ["Standing foot points at the target", "Ankle locked firm", "Strike through the middle of the ball", "Follow through to the target"],
    families: ["team"],
  },

  /* ── Skill — tennis and other racket/technical sports ─────────────────── */
  {
    id: "split-step",
    title: "Split Step Timing",
    what: "The small hop that lands just as your opponent strikes the ball.",
    why: "Landing loaded is why average speed feels fast on court, and why waiting flat-footed makes fast legs look slow.",
    steps: [
      "Start at the middle of the baseline in a ready position.",
      "As your partner (or a ball toss) begins their swing, hop a few centimetres off the ground.",
      "Land on the balls of both feet exactly as they make contact.",
      "Push off towards the ball immediately, reset, and repeat 10 times.",
    ],
    cues: ["Hop as they swing, land as they strike", "Land on the balls of both feet", "Push off immediately", "Reset between reps"],
    families: ["skill"],
  },
  {
    id: "shadow-swings",
    title: "Shadow Swings",
    what: "Full swings without a ball, at match speed.",
    why: "The fastest way to change a stroke is to repeat its shape without a ball to time.",
    steps: [
      "Take the racket to an open space.",
      "Play the stroke slowly three times, feeling the grip and the swing path.",
      "Then play it at match speed for five repetitions.",
      "Film one set and check the first move and the finish rather than the feel.",
    ],
    cues: ["Slow three, fast five", "Same swing path every rep", "Finish balanced", "Trust the video, not the feeling"],
    families: ["skill"],
  },
  {
    id: "serve-toss",
    title: "Serve Toss",
    what: "The release of the ball over the shoulder, trained on its own.",
    why: "A serve faults at the toss far more often than at the swing. A repeatable toss makes the rest of the serve repeatable.",
    steps: [
      "Stand at the service line with the racket down.",
      "Reach up with a straight arm and release the ball just above head height.",
      "Let it land on a target a racket-length in front of the front foot.",
      "20 tosses with no swing; only add the swing once 18 of 20 land on the target.",
    ],
    cues: ["Straight arm, high release", "Same height every time", "Let it drop in front of you", "No swing until the toss repeats"],
    families: ["skill"],
  },
  {
    id: "first-step-quickness",
    title: "First-Step Quickness",
    what: "The first push out of the ready position, in any direction.",
    why: "Points are won in the first step from the ready position, and it is trainable without a court.",
    steps: [
      "Stand in a ready position between two lines 2m apart.",
      "On a clap or a ball toss, push off and take one explosive step towards it.",
      "Recover to the middle and repeat in a random order — 8 reps.",
      "Keep the steps short, low and on the balls of the feet.",
    ],
    cues: ["React to the cue, not to a plan", "One explosive step", "Short and low", "Recover to the middle"],
    families: ["skill"],
  },

  /* ── Strength — weightlifting, climbing ───────────────────────────────── */
  {
    id: "squat-form",
    title: "Squat Form",
    what: "The barbell squat, checked for depth and knee tracking.",
    why: "A missed squat is usually one fault: the knees drift in, the depth disappears, or the bar path wanders forward.",
    steps: [
      "Set the bar on the upper back with the feet shoulder-width and the toes slightly out.",
      "Brace the trunk as if about to be punched.",
      "Sit down and slightly back, letting the knees travel over the toes.",
      "Reach at least parallel at the hip, then drive up through the middle of the foot.",
      "Film one set from the side and one from the front.",
    ],
    cues: ["Feet shoulder-width, toes slightly out", "Brace before you descend", "Knees over toes, not in", "Drive the floor away through mid-foot"],
    families: ["strength"],
  },
  {
    id: "deadlift-setup",
    title: "Deadlift Setup",
    what: "The starting position and bar path of a deadlift from the floor.",
    why: "The setup decides the lift: bar over mid-foot with a long spine turns a back-lift into a leg and hip drive.",
    steps: [
      "Stand with the bar over mid-foot, shins almost touching it.",
      "Hinge to the bar with a neutral spine and take the slack out of it.",
      "Set the shoulders just in front of the bar and squeeze the lats.",
      "Push the floor away, keeping the bar against the legs, and finish tall.",
      "Lower along the same path — 3 × 5, filmed from the side.",
    ],
    cues: ["Bar over mid-foot", "Shoulders just over the bar", "Long spine, lats tight", "Push the floor away", "Finish tall, don't lean back"],
    families: ["strength"],
  },
  {
    id: "overhead-press",
    title: "Overhead Press",
    what: "Pressing a bar from the shoulders to overhead without leaning back.",
    why: "If the bar drifts forward or the ribs flare, the press becomes a standing bench press and the shoulders take the load.",
    steps: [
      "Grip just outside the shoulders with the bar on the front of the shoulders.",
      "Brace the trunk and squeeze the glutes so the hips do not move.",
      "Press the bar in a shallow arc, moving the head slightly back and then through.",
      "Lock out with the bar over the ears and the ribs down, then lower under control.",
      "3 × 5, with one set filmed from the side.",
    ],
    cues: ["Glutes tight, ribs down", "Head back, then through", "Bar over the ears at lockout", "Control the descent"],
    families: ["strength"],
  },
  {
    id: "barbell-row",
    title: "Barbell Row",
    what: "Pulling a bar to the lower ribs from a hinged position.",
    why: "A row that becomes a shrug trains the arms instead of the back; the difference is what the shoulder blades do.",
    steps: [
      "Hinge to about 45° with the bar hanging under the shoulders.",
      "Pull the bar to the lower ribs, leading with the elbows.",
      "Squeeze the shoulder blades together at the top of the pull.",
      "Lower under control without letting the torso rise.",
      "3 × 8, with one set filmed.",
    ],
    cues: ["Hinge and hold the angle", "Elbows lead", "Squeeze the blades, don't shrug", "Same torso angle all set"],
    families: ["strength"],
  },
  {
    id: "push-up",
    title: "Push-Up Mechanics",
    what: "A full-range push-up with the shoulders and trunk stacked.",
    why: "It fails on the same three things every time: hips sagging, elbows flaring, or a head that reaches the floor first.",
    steps: [
      "Hands under the shoulders, body in one line from heels to head.",
      "Brace the trunk and squeeze the glutes so the hips do not sag.",
      "Lower until the chest is a fist from the floor with the elbows at about 45°.",
      "Push the floor away, locking the elbows and letting the shoulder blades spread at the top.",
      "3 sets, stopping two reps short of failure, filmed from the side.",
    ],
    cues: ["One line from heels to head", "Elbows at 45°", "Chest to a fist from the floor", "Push the floor away"],
    families: ["strength"],
  },
  {
    id: "scapular-pull-up",
    title: "Scapular Pull-Ups",
    what: "Hanging from a bar and pulling the shoulder blades down with straight arms.",
    why: "Climbers fail at the top of a move when the shoulders lose position; this is the smallest pull that trains it.",
    steps: [
      "Hang from a bar with straight arms and relaxed shoulders.",
      "Pull the shoulder blades down and back so the body rises a few centimetres.",
      "Hold for two seconds, then relax back into a full hang.",
      "3 × 8, adding a pause at the top of the last set.",
    ],
    cues: ["Arms stay straight", "Shoulders down and back", "Rise a few centimetres, no more", "Two-second hold"],
    families: ["strength"],
  },

  /* ── Combat — MMA and boxing ──────────────────────────────────────────── */
  {
    id: "stance-and-guard",
    title: "Stance & Guard",
    what: "The fighting stance and where the hands sit in it.",
    why: "The jab, the pivot and the exit all start from a stance you can move out of; a flat, square stance cannot.",
    steps: [
      "Stand with the lead foot forward, feet about shoulder-width apart.",
      "Turn the hips and the rear foot slightly out, weight even between the feet.",
      "Bring the hands up so the thumbs touch the cheeks and the elbows stay in.",
      "Shadow the stance for 30 seconds, checking you can step forward, back and sideways without resetting.",
    ],
    cues: ["Feet shoulder-width, staggered", "Chin behind the shoulder", "Elbows in, hands high", "Weight even, ready to move"],
    families: ["combat"],
  },
  {
    id: "pivot-footwork",
    title: "Pivot Footwork",
    what: "Turning around the lead foot to change angle.",
    why: "Pivoting is how you create an angle without giving up your base; dragging the rear foot wide is the beginner's tell.",
    steps: [
      "Take the stance and mark a small circle around the lead foot.",
      "Rotate the lead foot on the ball and swing the rear leg around the circle to a new angle.",
      "Keep the hands up and the head at the same height throughout.",
      "4 × 30 seconds of continuous pivoting, both directions.",
    ],
    cues: ["Turn on the ball of the lead foot", "The rear leg travels the circle", "Head stays level", "Hands never drop"],
    families: ["combat"],
  },
  {
    id: "hip-rotation",
    title: "Hip Rotation on Punches",
    what: "Turning the hips and rear foot through a straight punch.",
    why: "Power comes from the ground and the hips; a punch thrown with the arm alone loses power and balance together.",
    steps: [
      "Take the stance in front of a mirror with the hands up.",
      "Throw the rear straight punch slowly, rotating the rear foot and hip towards the target.",
      "Keep the shoulder relaxed and let the arm follow the hip rather than lead it.",
      "Extend, then snap the hand back to the cheek. 3 × 10 each side.",
    ],
    cues: ["Rear foot turns, hip follows", "Hip leads, arm follows", "Snap back to the cheek", "Chin stays behind the shoulder"],
    families: ["combat"],
  },
  {
    id: "sprawl",
    title: "Sprawl",
    what: "The defensive drop that takes your hips away from a takedown.",
    why: "A sprawl is a reflex built from reps: hips down and back, legs out, weight onto the attacker's shoulders.",
    steps: [
      "Start standing, then drop the hips back and shoot the legs out behind you.",
      "Land on the balls of the feet with the hips low and the chest over the hands.",
      "Recover straight back up into the stance with the hands high.",
      "4 × 10 reps, alternating a lead-foot and a rear-foot sprawl.",
    ],
    cues: ["Hips down and back", "Legs shoot out, feet wide", "Chest over the hands", "Pop straight back up"],
    families: ["combat"],
  },
  {
    id: "level-change",
    title: "Level Change",
    what: "Dropping your height with the legs, without bending at the waist.",
    why: "Bending at the waist puts your head down and your weight forward — the two things a takedown cannot survive.",
    steps: [
      "From the stance, step the lead foot in and lower the hips by bending the knees.",
      "Keep the chest up and the head in line with the spine — no bowing.",
      "Hold the low position for two seconds, then return to the stance.",
      "3 × 8, then repeat with a shot entry at the end of the movement.",
    ],
    cues: ["Bend the knees, not the waist", "Chest up, head up", "Step in as you drop", "Two-second hold at the bottom"],
    families: ["combat"],
  },
];

/** The shared foundation set: the drills marked for every sport. */
export function foundationDrills(): FormDrill[] {
  return FORM_DRILLS.filter((d) => d.families.includes("*"));
}

/**
 * True when the app cannot say which sport this athlete trains, so there is no
 * "your sport" to filter by. `multi` is the "Other" bucket — an explicit "we do
 * not know", not a sport of its own — and it fails open with the rest.
 */
export function isSportUnknown(families: DrillFamily[]): boolean {
  return families.length === 0 || families.includes("*") || families.includes("multi");
}

/** The drills for the athlete's own families — never another sport's. */
export function sportDrillsFor(families: DrillFamily[]): FormDrill[] {
  if (isSportUnknown(families)) return [];
  return FORM_DRILLS.filter(
    (d) => !d.families.includes("*") && d.families.some((f) => families.includes(f)),
  );
}

/**
 * Everything the Form tab should list for these families: the foundations plus
 * the athlete's own sport's drills, or the whole library when the sport is
 * unknown (fail open — an empty screen teaches nobody).
 */
export function drillsForFamilies(families: DrillFamily[]): FormDrill[] {
  if (isSportUnknown(families)) return FORM_DRILLS;
  return [...foundationDrills(), ...sportDrillsFor(families)];
}
