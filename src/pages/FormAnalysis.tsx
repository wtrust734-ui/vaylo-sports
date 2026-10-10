import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ScanLine, ChevronRight, Dumbbell, Eye, Target, RotateCcw, Footprints, Bike, PersonStanding, ArrowUp, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { creditCost } from "@/lib/credits";
import { DISCLAIMERS } from "@/config/disclaimers";

const drillCategories = [
  {
    category: "Gym & Strength",
    drills: [
      { icon: Dumbbell, title: "Squat Form Check", desc: "Key cues for proper squat depth and alignment", cues: ["Feet shoulder-width apart", "Brace your core", "Sit back into hips", "Knees track over toes", "Break parallel depth", "Drive through heels"] },
      { icon: Target, title: "Deadlift Setup", desc: "Perfect your hip hinge and barbell path", cues: ["Bar over mid-foot", "Shoulders over bar", "Neutral spine", "Engage lats", "Push floor away", "Lockout hips"] },
      { icon: RotateCcw, title: "Push-Up Mechanics", desc: "Full range of motion with shoulder alignment", cues: ["Hands under shoulders", "Elbows at 45°", "Core tight throughout", "Full lockout at top", "Chest to floor", "Scapulae protracted at top"] },
      { icon: Dumbbell, title: "Overhead Press", desc: "Proper pressing mechanics and core bracing", cues: ["Grip just outside shoulders", "Brace core and glutes", "Press in a slight arc", "Full lockout overhead", "Head through at top", "Control the descent"] },
      { icon: Dumbbell, title: "Barbell Row", desc: "Back engagement and pull pattern", cues: ["Hip hinge position", "Bar under shoulders", "Pull to lower chest", "Squeeze shoulder blades", "Control eccentric", "Neutral wrist position"] },
    ],
  },
  {
    category: "Running & Athletics",
    drills: [
      { icon: Eye, title: "Running Gait Analysis", desc: "Foot strike, cadence, and posture", cues: ["Land under hips", "180+ steps/min cadence", "Slight forward lean", "Relaxed shoulders", "Arms at 90°", "Mid-foot strike"] },
      { icon: Footprints, title: "A-Skips", desc: "Improve knee drive and coordination", cues: ["Drive knee to waist height", "Dorsiflexed ankle", "Stay tall through trunk", "Quick ground contact", "Pump arms in sync", "Land under center of mass"] },
      { icon: Footprints, title: "B-Skips", desc: "Extend leg drive for power transfer", cues: ["High knee then extend", "Paw the ground back", "Active ankle dorsiflexion", "Strong arm drive", "Stay tall, don't lean", "Quick cycle time"] },
      { icon: Footprints, title: "High Knees", desc: "Develop fast turnover and knee lift", cues: ["Drive knees to hip height", "Stay on balls of feet", "Quick ground contact", "Pump arms aggressively", "Keep torso upright", "Maintain rhythm"] },
      { icon: Footprints, title: "Butt Kicks", desc: "Develop hamstring recovery speed", cues: ["Heel to glute", "Stay tall", "Quick cadence", "Minimal forward travel", "Arms relaxed", "Light ground contact"] },
    ],
  },
  {
    category: "Football & Team Sports",
    drills: [
      { icon: Target, title: "Agility Ladder Drills", desc: "Quick feet and coordination patterns", cues: ["Light on your feet", "Stay low in athletic stance", "Arms drive movement", "Eyes up, not down", "Quick in-out pattern", "Maintain rhythm"] },
      { icon: RotateCcw, title: "Cutting & Change of Direction", desc: "Sharp cuts and deceleration mechanics", cues: ["Plant outside foot firmly", "Lower centre of gravity", "Lean into new direction", "Explosive push-off", "Keep eyes on target", "Pre-load the cut"] },
      { icon: Target, title: "Sprint Starts", desc: "Explosive acceleration from standstill", cues: ["45° body angle", "Powerful arm drive", "Short choppy steps initially", "Gradually raise torso", "Drive knees forward", "Stay low first 10m"] },
      { icon: Eye, title: "Ball Control & First Touch", desc: "Receiving and controlling the ball", cues: ["Cushion the ball on contact", "Use inside of foot", "Body behind the ball", "Relaxed receiving surface", "Direct touch into space", "Stay balanced"] },
      { icon: Target, title: "Passing Accuracy", desc: "Technique for consistent passing", cues: ["Plant foot beside ball", "Strike with inside of foot", "Follow through to target", "Ankle locked firm", "Weight of pass matters", "Eyes on target"] },
    ],
  },
  {
    category: "Cycling & Swimming",
    drills: [
      { icon: Bike, title: "Pedal Stroke Efficiency", desc: "Smooth circular pedalling technique", cues: ["Push down, pull up", "Scrape foot at bottom", "Knee tracking straight", "Relaxed upper body", "Even power distribution", "High cadence practice"] },
      { icon: RotateCcw, title: "Freestyle Swim Stroke", desc: "Efficient front crawl technique", cues: ["High elbow catch", "Rotate from hips", "Bilateral breathing", "Streamlined body position", "Kick from hips, not knees", "Extend and glide"] },
      { icon: Eye, title: "Open Water Sighting", desc: "Navigation without losing speed", cues: ["Lift eyes only, not head", "Sight every 6-8 strokes", "Use landmarks", "Time sight with breath", "Return to position quickly", "Practice in pool first"] },
    ],
  },
];

const FormAnalysis = () => {
  const navigate = useNavigate();
  // Form analysis is VIDEO-only and strictly per analysis. There is no photo
  // upload and no unlimited unlock on this screen: the analysis itself lives
  // on /form/video, and the card below states the per-analysis price. The
  // price is read from the credit config rather than written into the button,
  // so the two cannot drift the way the old hard-coded copy did.
  const videoCost = creditCost("video_form_analysis");
  const [expandedDrill, setExpandedDrill] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(drillCategories[0].category);
  const drillsRef = useRef(null);
  const drillsInView = useInView(drillsRef, { once: true, margin: "-30px" });

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Form</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Perfect your technique.</motion.p>
      </div>


      {/* AI Form Analysis — video only, per analysis. No photo upload, no
          unlimited unlock: a flat rate on a metered video call loses money, so
          every analysis carries its own price, stated on the button. */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mx-5 mb-5 bg-gradient-card border border-electric-purple/20 rounded-2xl p-4 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <ScanLine size={16} className="text-electric-purple" />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-electric-purple">AI Form Analysis</span>
        </div>
        <h3 className="font-display font-bold text-lg mb-1">Analyse a movement video</h3>
        <p className="text-sm text-muted-foreground mb-3">Upload a running, sprint or general-movement clip and get a full AI coaching report — {videoCost} credits per analysis, no unlock needed.</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground mb-3">
          {DISCLAIMERS.formAnalysis.full}
        </p>
        <motion.button whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/form/video")}
          className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
          <Video size={18} /> Analyse a video · {videoCost} credits
        </motion.button>
      </motion.div>

      {/* Free Form Drills by Category */}
      <div ref={drillsRef} className="px-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Form Drills & Cues (Free)</h3>
        <div className="space-y-3 mb-8">
          {drillCategories.map((cat, ci) => (
            <div key={cat.category}>
              <motion.button
                onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
                className="w-full flex items-center justify-between py-2"
                initial={{ opacity: 0 }} animate={drillsInView ? { opacity: 1 } : {}} transition={{ delay: ci * 0.05 }}
              >
                <span className="text-xs font-bold uppercase tracking-wider text-electric-purple">{cat.category}</span>
                <motion.div animate={{ rotate: expandedCategory === cat.category ? 90 : 0 }}><ChevronRight size={14} className="text-muted-foreground" /></motion.div>
              </motion.button>
              {expandedCategory === cat.category && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-2">
                  {cat.drills.map((drill, i) => {
                    const key = `${cat.category}-${drill.title}`;
                    return (
                      <motion.div key={key}
                        initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                        className="bg-card border border-border rounded-xl overflow-hidden hover:border-electric-purple/20 transition-colors duration-300">
                        <motion.button onClick={() => setExpandedDrill(expandedDrill === key ? null : key)}
                          className="w-full p-3 flex items-center justify-between" whileTap={{ scale: 0.99 }}>
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-electric-purple/10"><drill.icon size={16} className="text-electric-purple" /></div>
                            <div className="text-start"><h4 className="font-semibold text-sm">{drill.title}</h4><p className="text-[12px] text-muted-foreground">{drill.desc}</p></div>
                          </div>
                          <motion.div animate={{ rotate: expandedDrill === key ? 90 : 0 }}><ChevronRight size={14} className="text-muted-foreground" /></motion.div>
                        </motion.button>
                        {expandedDrill === key && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-3 pb-3">
                            <div className="space-y-1.5 border-t border-border pt-2">
                              {drill.cues.map((cue, ci) => (
                                <motion.div key={ci} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ci * 0.04 }}
                                  className="flex items-center gap-2 text-sm">
                                  <div className="w-5 h-5 rounded-full bg-electric-purple/10 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[12px] font-bold text-electric-purple">{ci + 1}</span>
                                  </div>
                                  <span>{cue}</span>
                                </motion.div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FormAnalysis;
