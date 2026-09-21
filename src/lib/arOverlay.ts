import { Brain, Flame, Wind, Target, Shield, Zap } from "lucide-react";

export type ArPersonaId =
  | "coach_pro" | "sprint_coach" | "endurance_sage" | "tactical_mind" | "strength_drill" | "calm_focus";

export interface ArPersona {
  id: ArPersonaId;
  name: string;
  tagline: string;
  sports: string[];
  tone: string;
  icon: typeof Brain;
  accent: string; // hsl token
  voicePromptStyle: string;
}

export const AR_PERSONAS: ArPersona[] = [
  { id: "coach_pro", name: "Coach Pro", tagline: "Balanced all-sport guidance", sports: ["All sports"], tone: "Calm, confident, precise", icon: Brain, accent: "hsl(var(--primary))", voicePromptStyle: "Steady tactical cues every 60s." },
  { id: "sprint_coach", name: "Sprint Coach", tagline: "Explosive · short bursts", sports: ["Sprinting", "Football", "Basketball"], tone: "High-energy, bark-style", icon: Wind, accent: "hsl(var(--electric-purple))", voicePromptStyle: "Punchy 3-word cues. Drive!" },
  { id: "endurance_sage", name: "Endurance Sage", tagline: "Pace · negative splits", sports: ["Running", "Cycling", "Triathlon"], tone: "Steady, rhythmic", icon: Flame, accent: "hsl(var(--energy))", voicePromptStyle: "Pacing reminders + breathing." },
  { id: "tactical_mind", name: "Tactical Mind", tagline: "Read the game", sports: ["Football", "Basketball", "Tennis", "Rugby"], tone: "Analytical, observant", icon: Target, accent: "hsl(var(--success))", voicePromptStyle: "Positional & decision cues." },
  { id: "strength_drill", name: "Strength Drill", tagline: "Lift heavy · own form", sports: ["Strength", "Powerlifting", "CrossFit"], tone: "Drill-sergeant", icon: Shield, accent: "hsl(var(--destructive))", voicePromptStyle: "Tempo + cue per rep." },
  { id: "calm_focus", name: "Calm Focus", tagline: "Mind over body", sports: ["Yoga", "Swimming", "Climbing"], tone: "Whisper-quiet, mindful", icon: Zap, accent: "hsl(var(--info))", voicePromptStyle: "Breath + posture cues." },
];

export interface ArMetric {
  id: string;
  label: string;
  unit: string;
  category: "core" | "advanced" | "ai";
  description: string;
}

export const AR_METRICS: ArMetric[] = [
  { id: "pace", label: "Pace", unit: "min/km", category: "core", description: "Live pace per kilometer." },
  { id: "speed", label: "Speed", unit: "km/h", category: "core", description: "Instant ground speed." },
  { id: "heart_rate", label: "Heart Rate", unit: "bpm", category: "core", description: "Live HR from connected sensor." },
  { id: "hr_zone", label: "HR Zone", unit: "Z1–Z5", category: "core", description: "Color-coded zone." },
  { id: "distance", label: "Distance", unit: "km", category: "core", description: "Total distance covered." },
  { id: "elapsed", label: "Time", unit: "h:m:s", category: "core", description: "Elapsed session time." },
  { id: "cadence", label: "Cadence", unit: "spm/rpm", category: "core", description: "Steps or pedal cadence." },
  { id: "power", label: "Power", unit: "W", category: "advanced", description: "Output watts (run/bike)." },
  { id: "stride", label: "Stride Length", unit: "m", category: "advanced", description: "Average stride per step." },
  { id: "elevation", label: "Elevation", unit: "m", category: "advanced", description: "Live altitude / gain." },
  { id: "calories", label: "Calories", unit: "kcal", category: "advanced", description: "Burned this session." },
  { id: "vo2", label: "VO₂ Estimate", unit: "ml/kg/min", category: "advanced", description: "Aerobic load estimate." },
  { id: "fatigue_predict", label: "Fatigue Forecast", unit: "%", category: "ai", description: "AI predicts fatigue in 10 min." },
  { id: "vpr_live", label: "Live VPR", unit: "/100", category: "ai", description: "Real-time performance rating." },
  { id: "form_score", label: "Form Score", unit: "/100", category: "ai", description: "Biomechanics consistency." },
  { id: "next_cue", label: "Next AI Cue", unit: "text", category: "ai", description: "Persona's next coaching cue." },
];

export const AR_THEMES = [
  { id: "electric", label: "Electric", color: "hsl(var(--electric-purple))" },
  { id: "neon", label: "Neon Lime", color: "hsl(var(--success))" },
  { id: "blaze", label: "Blaze", color: "hsl(var(--energy))" },
  { id: "ice", label: "Ice", color: "hsl(var(--info))" },
  { id: "stealth", label: "Stealth", color: "hsl(var(--muted-foreground))" },
];

export const AR_POSITIONS = [
  { id: "top", label: "Top" },
  { id: "center", label: "Center" },
  { id: "bottom", label: "Bottom" },
];

export const MAX_AR_METRICS = 6;
