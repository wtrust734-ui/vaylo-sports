// ============================================================================
// STANDING CHALLENGES — the reference catalogue, on the Challenges screen
// ----------------------------------------------------------------------------
// These used to be a tab inside Achievements, which is how an athlete looking at
// their medals ended up reading a list of challenges: two sections that share a
// screen are two sections that get confused for each other. Achievements,
// Badges and Challenges are separate screens now, and this — the fixed list of
// standing challenges — belongs to the one it is named after.
//
// It is a REFERENCE, not a live board. Nothing here can be joined or logged: the
// joinable challenges are the rows the Challenges screen already lists above
// this, with progress and participants behind them. It is folded away for the
// same reason, so it cannot be mistaken for the real thing.
// ============================================================================

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Target } from "lucide-react";

// ─── 100 BUILT-IN CHALLENGES ───
export const STANDING_CHALLENGES = [
  { title: "7-Day Warrior", desc: "Complete a workout every day for 7 days", target: 7, unit: "days", type: "streak" },
  { title: "30-Day Grind", desc: "Work out every day for 30 days straight", target: 30, unit: "days", type: "streak" },
  { title: "100 Workout Club", desc: "Complete 100 total workouts", target: 100, unit: "workouts", type: "total" },
  { title: "Morning Person", desc: "Log 10 morning check-ins", target: 10, unit: "check-ins", type: "total" },
  { title: "Peak Performance", desc: "Score 85+ readiness 5 times", target: 5, unit: "days", type: "green" },
  { title: "Water Week", desc: "Log water every day for 7 days", target: 7, unit: "days", type: "water" },
  { title: "Meal Prep Master", desc: "Log 3 meals per day for a week", target: 21, unit: "meals", type: "meals" },
  { title: "Coach Chat 10", desc: "Have 10 conversations with AI Coach", target: 10, unit: "messages", type: "coach" },
  { title: "Recovery Focus", desc: "Log recovery check-ins for 14 days", target: 14, unit: "check-ins", type: "recovery" },
  { title: "Mental Strength", desc: "Complete 10 mental check-ins", target: 10, unit: "check-ins", type: "mental" },
  { title: "5K Ready", desc: "Complete 20 cardio workouts", target: 20, unit: "workouts", type: "cardio" },
  { title: "Strength Builder", desc: "Complete 15 strength sessions", target: 15, unit: "sessions", type: "strength" },
  { title: "Flexibility Focus", desc: "Complete 10 stretching sessions", target: 10, unit: "sessions", type: "flexibility" },
  { title: "Event Racer", desc: "Create and complete 3 events", target: 3, unit: "events", type: "events" },
  { title: "Rival Hunter", desc: "Add 5 rivals", target: 5, unit: "rivals", type: "rivals" },
  { title: "HRV Tracker", desc: "Log HRV for 7 consecutive days", target: 7, unit: "days", type: "hrv" },
  { title: "Green Zone Week", desc: "Stay in green zone for 5 days", target: 5, unit: "days", type: "green" },
  { title: "No Red Days", desc: "Avoid red zone for 14 days", target: 14, unit: "days", type: "no_red" },
  { title: "Nutrition Ninja", desc: "Hit protein target 10 times", target: 10, unit: "days", type: "nutrition" },
  { title: "Hydration Hero", desc: "Hit water goal 20 times", target: 20, unit: "days", type: "water" },
  { title: "Plan Follower", desc: "Complete 5 planned sessions", target: 5, unit: "sessions", type: "plan" },
  { title: "Early Bird", desc: "Work out before 8am 10 times", target: 10, unit: "sessions", type: "early" },
  { title: "Weekend Warrior", desc: "Work out on 4 weekends", target: 4, unit: "weekends", type: "weekend" },
  { title: "Technique Focus", desc: "Use Form Analysis 5 times", target: 5, unit: "analyses", type: "form" },
  { title: "Mind & Body", desc: "Do mental + physical training same day 5x", target: 5, unit: "days", type: "combined" },
  { title: "Cue Word Master", desc: "Create 5 cue words", target: 5, unit: "words", type: "cue" },
  { title: "Race Prep", desc: "Complete all event planning checklist items", target: 4, unit: "items", type: "prep" },
  { title: "Strategy Master", desc: "Write strategies for 3 events", target: 3, unit: "strategies", type: "strategy" },
  { title: "Consistent Coach", desc: "Use coach 3 days in a row", target: 3, unit: "days", type: "coach_streak" },
  { title: "50 Workout Milestone", desc: "Reach 50 total workouts", target: 50, unit: "workouts", type: "total" },
  { title: "200 Workout Legend", desc: "Reach 200 total workouts", target: 200, unit: "workouts", type: "total" },
  { title: "14-Day Streak", desc: "14 consecutive training days", target: 14, unit: "days", type: "streak" },
  { title: "21-Day Habit", desc: "Train for 21 days straight", target: 21, unit: "days", type: "streak" },
  { title: "60-Day Challenge", desc: "60 consecutive training days", target: 60, unit: "days", type: "streak" },
  { title: "90-Day Transform", desc: "90 consecutive training days", target: 90, unit: "days", type: "streak" },
  { title: "365-Day Legend", desc: "Train every day for a year", target: 365, unit: "days", type: "streak" },
  { title: "Mental Marathon", desc: "25 mental check-ins", target: 25, unit: "check-ins", type: "mental" },
  { title: "Recovery King", desc: "30 recovery logs", target: 30, unit: "logs", type: "recovery" },
  { title: "Recovery Legend", desc: "100 recovery logs", target: 100, unit: "logs", type: "recovery" },
  { title: "Coach Expert", desc: "50 coach conversations", target: 50, unit: "chats", type: "coach" },
  { title: "Coach Legend", desc: "100 coach conversations", target: 100, unit: "chats", type: "coach" },
  { title: "Event Machine", desc: "10 events created", target: 10, unit: "events", type: "events" },
  { title: "Rivalry Master", desc: "Track 10 rivals", target: 10, unit: "rivals", type: "rivals" },
  { title: "Meal Logger", desc: "50 meals logged", target: 50, unit: "meals", type: "meals" },
  { title: "Meal Legend", desc: "200 meals logged", target: 200, unit: "meals", type: "meals" },
  { title: "Water Streak", desc: "Log water 30 days straight", target: 30, unit: "days", type: "water" },
  { title: "Peak Month", desc: "20 green zone days in a month", target: 20, unit: "days", type: "green" },
  { title: "Green Domination", desc: "50 total green zone days", target: 50, unit: "days", type: "green" },
  { title: "HRV Expert", desc: "Log HRV 30 times", target: 30, unit: "logs", type: "hrv" },
  { title: "HRV Legend", desc: "Log HRV 100 times", target: 100, unit: "logs", type: "hrv" },
  { title: "Plan Creator", desc: "Create 5 training plans", target: 5, unit: "plans", type: "plan" },
  { title: "Plan Legend", desc: "Create 10 training plans", target: 10, unit: "plans", type: "plan" },
  { title: "Nutrition Planner", desc: "Create 3 nutrition plans", target: 3, unit: "plans", type: "nutrition_plan" },
  { title: "All Rounder", desc: "Use every feature at least once", target: 1, unit: "features", type: "all_features" },
  { title: "First Challenge", desc: "Complete your first challenge", target: 1, unit: "challenges", type: "challenge" },
  { title: "Challenge Collector", desc: "Complete 5 challenges", target: 5, unit: "challenges", type: "challenge" },
  { title: "Challenge Hunter", desc: "Complete 10 challenges", target: 10, unit: "challenges", type: "challenge" },
  { title: "Challenge Master", desc: "Complete 25 challenges", target: 25, unit: "challenges", type: "challenge" },
  { title: "Sprint Week", desc: "5 high-intensity workouts in a week", target: 5, unit: "workouts", type: "intensity" },
  { title: "Long Distance", desc: "Log 50km total distance", target: 50, unit: "km", type: "distance" },
  { title: "100km Club", desc: "Log 100km total distance", target: 100, unit: "km", type: "distance" },
  { title: "Marathon Distance", desc: "Log 42.2km in workouts", target: 42, unit: "km", type: "distance" },
  { title: "500km Legend", desc: "Log 500km total", target: 500, unit: "km", type: "distance" },
  { title: "Calorie Burner", desc: "Burn 5000 calories total", target: 5000, unit: "cal", type: "calories" },
  { title: "10K Calories", desc: "Burn 10000 calories", target: 10000, unit: "cal", type: "calories" },
  { title: "50K Calories", desc: "Burn 50000 calories", target: 50000, unit: "cal", type: "calories" },
  { title: "Hour Logger", desc: "Log 10 hours of training", target: 600, unit: "min", type: "duration" },
  { title: "25 Hour Athlete", desc: "Log 25 hours of training", target: 1500, unit: "min", type: "duration" },
  { title: "100 Hour Legend", desc: "Log 100 hours of training", target: 6000, unit: "min", type: "duration" },
  { title: "Podium Chaser", desc: "Finish top 3 in an event", target: 1, unit: "podiums", type: "podium" },
  { title: "5 Podiums", desc: "5 top-3 finishes", target: 5, unit: "podiums", type: "podium" },
  { title: "Winner", desc: "Win an event", target: 1, unit: "wins", type: "win" },
  { title: "Comeback King", desc: "Improve your PB 3 times", target: 3, unit: "PBs", type: "pb" },
  { title: "PB Machine", desc: "Set 10 personal bests", target: 10, unit: "PBs", type: "pb" },
  { title: "Breathing Pro", desc: "Complete 10 breathing sessions", target: 10, unit: "sessions", type: "breathing" },
  { title: "Pressure Tested", desc: "Rehearse 5 pressure scenarios", target: 5, unit: "scenarios", type: "pressure" },
  { title: "Reset Master", desc: "Complete 10 cognitive resets", target: 10, unit: "resets", type: "reset" },
  { title: "Review Expert", desc: "Complete 10 post reviews", target: 10, unit: "reviews", type: "review" },
  { title: "Double Workout", desc: "2 workouts in one day", target: 2, unit: "workouts", type: "double" },
  { title: "Cross Trainer", desc: "Train 3 different sports", target: 3, unit: "sports", type: "cross" },
  { title: "Night Owl", desc: "10 evening workouts", target: 10, unit: "workouts", type: "evening" },
  { title: "Perfect Week", desc: "Complete all planned workouts in a week", target: 1, unit: "weeks", type: "perfect" },
  { title: "Monthly Warrior", desc: "20+ workouts in a month", target: 20, unit: "workouts", type: "monthly" },
  { title: "Quarterly Beast", desc: "60+ workouts in 3 months", target: 60, unit: "workouts", type: "quarterly" },
  { title: "Elite Status", desc: "Complete 50 challenges total", target: 50, unit: "challenges", type: "challenge" },
  { title: "Champion", desc: "Earn 50 achievements", target: 50, unit: "achievements", type: "meta" },
  { title: "Legend", desc: "Earn all 100 achievements", target: 100, unit: "achievements", type: "meta" },
  { title: "Team Player", desc: "Join 3 challenges with friends", target: 3, unit: "challenges", type: "team" },
  { title: "Inspiration", desc: "Create a challenge others join", target: 1, unit: "challenge", type: "inspire" },
  { title: "Iron Athlete", desc: "Train 5 days per week for a month", target: 20, unit: "days", type: "weekly" },
  { title: "Rest Day Respect", desc: "Take 4 planned rest days", target: 4, unit: "days", type: "rest" },
  { title: "Balanced Athlete", desc: "Train mind and body equally (10 each)", target: 10, unit: "sessions", type: "balance" },
  { title: "Data Driven", desc: "Log 50 performance metrics", target: 50, unit: "logs", type: "data" },
  { title: "Consistency Crown", desc: "Never miss 2 days in a row for a month", target: 30, unit: "days", type: "consistency" },
  { title: "Season Finisher", desc: "Complete a full training plan", target: 1, unit: "plan", type: "finish_plan" },
  { title: "Multi-Season", desc: "Complete 3 full training plans", target: 3, unit: "plans", type: "finish_plan" },
  { title: "Ultimate Athlete", desc: "500 workouts + 100 achievements + Pro sub", target: 1, unit: "status", type: "ultimate" },
];

export default function StandingChallenges() {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-5 mb-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-start"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Standing challenges ({STANDING_CHALLENGES.length})</span>
          <span className="block text-[12px] text-muted-foreground">
            The reference list. The joinable ones are above, with your progress on them.
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="shrink-0 text-muted-foreground">
          <ChevronDown size={16} aria-hidden />
        </motion.span>
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {STANDING_CHALLENGES.map((challenge, i) => (
            <motion.div
              key={challenge.title}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.01, 0.5) }}
              className="rounded-xl border border-border bg-card p-3 text-center"
            >
              <div className="mx-auto mb-1.5 grid h-10 w-10 place-items-center rounded-full bg-primary/15">
                <Target size={18} className="text-primary" aria-hidden />
              </div>
              <h4 className="text-[12px] font-bold">{challenge.title}</h4>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{challenge.desc}</p>
              <p className="mt-1 text-[10px] font-bold text-primary">
                Target: {challenge.target} {challenge.unit}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
