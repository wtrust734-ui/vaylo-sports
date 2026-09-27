import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Star, Shield, Crown, Zap, Target, Flame, Brain, ShoppingBag, Dumbbell, Droplets, Medal, Award, Check, Plus, X, Users, Calendar, TrendingUp, Heart, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

type Achievement = Tables<"achievements">;
type Challenge = Tables<"challenges">;

/**
 * Every counter an achievement rule can test against. Built by fetchAll from
 * Supabase counts, so achievement checks stay type-checked end to end.
 */
interface AchievementStats {
  workouts: number;
  streak: number;
  checkins: number;
  greenDays: number;
  events: number;
  results: number;
  firstPlace: number;
  podium: number;
  rivals: number;
  rivalBeats: number;
  plans: number;
  friends: number;
  meals: number;
  water: number;
  coachMsgs: number;
  mentalCheckins: number;
  cueWords: number;
  reviews: number;
  hrvLogs: number;
  purchases: string[];
  nutritionPlans: number;
  completedChallenges: number;
  createdChallenges: number;
}

const emptyStats: AchievementStats = {
  workouts: 0, streak: 0, checkins: 0, greenDays: 0, events: 0, results: 0,
  firstPlace: 0, podium: 0, rivals: 0, rivalBeats: 0, plans: 0, friends: 0,
  meals: 0, water: 0, coachMsgs: 0, mentalCheckins: 0, cueWords: 0, reviews: 0,
  hrvLogs: 0, purchases: [], nutritionPlans: 0, completedChallenges: 0, createdChallenges: 0,
};

const iconMap: Record<string, LucideIcon> = { star: Star, shield: Shield, crown: Crown, zap: Zap, target: Target, flame: Flame, trophy: Trophy, brain: Brain, shopping: ShoppingBag, dumbbell: Dumbbell, droplets: Droplets, medal: Medal, award: Award, heart: Heart, trending: TrendingUp };

// ─── 100 BUILT-IN ACHIEVEMENTS ───
const builtInAchievements = [
  { id: "first_workout", title: "First Steps", desc: "Complete your first workout", icon: "dumbbell", check: (d: AchievementStats) => d.workouts >= 1 },
  { id: "10_workouts", title: "Getting Started", desc: "Complete 10 workouts", icon: "flame", check: (d: AchievementStats) => d.workouts >= 10 },
  { id: "25_workouts", title: "Quarter Century", desc: "Complete 25 workouts", icon: "flame", check: (d: AchievementStats) => d.workouts >= 25 },
  { id: "50_workouts", title: "Half Century", desc: "Complete 50 workouts", icon: "star", check: (d: AchievementStats) => d.workouts >= 50 },
  { id: "100_workouts", title: "Centurion", desc: "Complete 100 workouts", icon: "crown", check: (d: AchievementStats) => d.workouts >= 100 },
  { id: "200_workouts", title: "Double Century", desc: "Complete 200 workouts", icon: "crown", check: (d: AchievementStats) => d.workouts >= 200 },
  { id: "500_workouts", title: "Iron Will", desc: "Complete 500 workouts", icon: "trophy", check: (d: AchievementStats) => d.workouts >= 500 },
  { id: "3_day_streak", title: "Consistency", desc: "3-day workout streak", icon: "flame", check: (d: AchievementStats) => d.streak >= 3 },
  { id: "7_day_streak", title: "Full Week", desc: "7-day workout streak", icon: "flame", check: (d: AchievementStats) => d.streak >= 7 },
  { id: "14_day_streak", title: "Two Weeks Strong", desc: "14-day workout streak", icon: "zap", check: (d: AchievementStats) => d.streak >= 14 },
  { id: "30_day_streak", title: "Monthly Machine", desc: "30-day workout streak", icon: "crown", check: (d: AchievementStats) => d.streak >= 30 },
  { id: "60_day_streak", title: "Unbreakable", desc: "60-day workout streak", icon: "trophy", check: (d: AchievementStats) => d.streak >= 60 },
  { id: "100_day_streak", title: "Century Streak", desc: "100-day streak", icon: "trophy", check: (d: AchievementStats) => d.streak >= 100 },
  { id: "first_checkin", title: "Body Check", desc: "Log your first recovery check-in", icon: "heart", check: (d: AchievementStats) => d.checkins >= 1 },
  { id: "10_checkins", title: "Recovery Pro", desc: "Log 10 recovery check-ins", icon: "heart", check: (d: AchievementStats) => d.checkins >= 10 },
  { id: "30_checkins", title: "Recovery Master", desc: "30 recovery check-ins", icon: "shield", check: (d: AchievementStats) => d.checkins >= 30 },
  { id: "green_zone", title: "Green Light", desc: "Score 85+ readiness", icon: "zap", check: (d: AchievementStats) => d.greenDays >= 1 },
  { id: "5_green", title: "Peak Week", desc: "5 green zone days", icon: "star", check: (d: AchievementStats) => d.greenDays >= 5 },
  { id: "20_green", title: "Peak Machine", desc: "20 green zone days", icon: "crown", check: (d: AchievementStats) => d.greenDays >= 20 },
  { id: "first_event", title: "Race Day", desc: "Create your first event", icon: "target", check: (d: AchievementStats) => d.events >= 1 },
  { id: "5_events", title: "Competitor", desc: "Create 5 events", icon: "target", check: (d: AchievementStats) => d.events >= 5 },
  { id: "10_events", title: "Serial Racer", desc: "Create 10 events", icon: "medal", check: (d: AchievementStats) => d.events >= 10 },
  { id: "first_rival", title: "Rivalry Begins", desc: "Add your first rival", icon: "target", check: (d: AchievementStats) => d.rivals >= 1 },
  { id: "5_rivals", title: "Known Enemies", desc: "Track 5 rivals", icon: "target", check: (d: AchievementStats) => d.rivals >= 5 },
  { id: "first_plan", title: "Planned Athlete", desc: "Create a training plan", icon: "dumbbell", check: (d: AchievementStats) => d.plans >= 1 },
  { id: "3_plans", title: "Plan Builder", desc: "Create 3 training plans", icon: "dumbbell", check: (d: AchievementStats) => d.plans >= 3 },
  { id: "first_friend", title: "Social Athlete", desc: "Add your first friend", icon: "star", check: (d: AchievementStats) => d.friends >= 1 },
  { id: "5_friends", title: "Squad", desc: "Have 5 friends", icon: "star", check: (d: AchievementStats) => d.friends >= 5 },
  { id: "10_friends", title: "Popular", desc: "Have 10 friends", icon: "crown", check: (d: AchievementStats) => d.friends >= 10 },
  { id: "mental_owner", title: "Mental Gym Owner", desc: "Purchase Mental Gym", icon: "brain", check: (d: AchievementStats) => d.purchases.includes("mental_gym") },
  { id: "form_owner", title: "Form Analyst", desc: "Purchase Form Analysis", icon: "target", check: (d: AchievementStats) => d.purchases.includes("form_analysis") },
  { id: "coach_owner", title: "Coach Pro", desc: "Purchase Coach Pro", icon: "star", check: (d: AchievementStats) => d.purchases.includes("coach_pro") },
  { id: "pro_sub", title: "Pro Athlete", desc: "Subscribe to Pro", icon: "crown", check: (d: AchievementStats) => d.purchases.includes("pro") },
  { id: "min_sub", title: "Minimum Athlete", desc: "Subscribe to Minimum", icon: "shield", check: (d: AchievementStats) => d.purchases.includes("minimum") },
  { id: "first_meal", title: "Fuel Up", desc: "Log your first meal", icon: "flame", check: (d: AchievementStats) => d.meals >= 1 },
  { id: "25_meals", title: "Nutrition Tracker", desc: "Log 25 meals", icon: "flame", check: (d: AchievementStats) => d.meals >= 25 },
  { id: "100_meals", title: "Diet Master", desc: "Log 100 meals", icon: "crown", check: (d: AchievementStats) => d.meals >= 100 },
  { id: "first_water", title: "Hydrated", desc: "Log water intake", icon: "droplets", check: (d: AchievementStats) => d.water >= 1 },
  { id: "30_water", title: "Water Champion", desc: "Log water 30 times", icon: "droplets", check: (d: AchievementStats) => d.water >= 30 },
  { id: "coach_chat", title: "First Advice", desc: "Send first coach message", icon: "brain", check: (d: AchievementStats) => d.coachMsgs >= 1 },
  { id: "25_coach", title: "Coach Regular", desc: "25 coach messages", icon: "brain", check: (d: AchievementStats) => d.coachMsgs >= 25 },
  { id: "100_coach", title: "Coach Devotee", desc: "100 coach messages", icon: "crown", check: (d: AchievementStats) => d.coachMsgs >= 100 },
  { id: "first_result", title: "Result Logged", desc: "Log your first event result", icon: "trophy", check: (d: AchievementStats) => d.results >= 1 },
  { id: "5_results", title: "Results Tracker", desc: "Log 5 event results", icon: "medal", check: (d: AchievementStats) => d.results >= 5 },
  { id: "10_results", title: "Veteran Racer", desc: "Log 10 results", icon: "trophy", check: (d: AchievementStats) => d.results >= 10 },
  { id: "mental_checkin", title: "Mind Check", desc: "Complete a mental check-in", icon: "brain", check: (d: AchievementStats) => d.mentalCheckins >= 1 },
  { id: "10_mental", title: "Mental Regular", desc: "10 mental check-ins", icon: "brain", check: (d: AchievementStats) => d.mentalCheckins >= 10 },
  { id: "50_mental", title: "Mental Warrior", desc: "50 mental check-ins", icon: "crown", check: (d: AchievementStats) => d.mentalCheckins >= 50 },
  { id: "cue_words", title: "Cue Creator", desc: "Create cue words", icon: "target", check: (d: AchievementStats) => d.cueWords >= 1 },
  { id: "5_cue", title: "Cue Master", desc: "Create 5 cue words", icon: "target", check: (d: AchievementStats) => d.cueWords >= 5 },
  // Additional milestones
  { id: "150_workouts", title: "Beast Mode", desc: "Complete 150 workouts", icon: "flame", check: (d: AchievementStats) => d.workouts >= 150 },
  { id: "250_workouts", title: "Relentless", desc: "Complete 250 workouts", icon: "star", check: (d: AchievementStats) => d.workouts >= 250 },
  { id: "300_workouts", title: "Machine", desc: "Complete 300 workouts", icon: "crown", check: (d: AchievementStats) => d.workouts >= 300 },
  { id: "400_workouts", title: "Unstoppable", desc: "Complete 400 workouts", icon: "trophy", check: (d: AchievementStats) => d.workouts >= 400 },
  { id: "21_streak", title: "3 Weeks Fire", desc: "21-day streak", icon: "flame", check: (d: AchievementStats) => d.streak >= 21 },
  { id: "45_streak", title: "45 Day Warrior", desc: "45-day streak", icon: "zap", check: (d: AchievementStats) => d.streak >= 45 },
  { id: "90_streak", title: "Quarter Year", desc: "90-day streak", icon: "crown", check: (d: AchievementStats) => d.streak >= 90 },
  { id: "180_streak", title: "Half Year", desc: "180-day streak", icon: "trophy", check: (d: AchievementStats) => d.streak >= 180 },
  { id: "365_streak", title: "Full Year", desc: "365-day streak", icon: "trophy", check: (d: AchievementStats) => d.streak >= 365 },
  { id: "50_checkins", title: "Recovery Expert", desc: "50 check-ins", icon: "heart", check: (d: AchievementStats) => d.checkins >= 50 },
  { id: "100_checkins", title: "Recovery Legend", desc: "100 check-ins", icon: "trophy", check: (d: AchievementStats) => d.checkins >= 100 },
  { id: "10_green", title: "Green Streak", desc: "10 green zone days", icon: "zap", check: (d: AchievementStats) => d.greenDays >= 10 },
  { id: "50_green", title: "Elite Recovery", desc: "50 green zone days", icon: "trophy", check: (d: AchievementStats) => d.greenDays >= 50 },
  { id: "20_events", title: "Event Machine", desc: "20 events created", icon: "medal", check: (d: AchievementStats) => d.events >= 20 },
  { id: "10_rivals", title: "Rival Tracker", desc: "Track 10 rivals", icon: "target", check: (d: AchievementStats) => d.rivals >= 10 },
  { id: "5_plans", title: "Plan Master", desc: "5 training plans", icon: "dumbbell", check: (d: AchievementStats) => d.plans >= 5 },
  { id: "10_plans", title: "Plan Legend", desc: "10 training plans", icon: "crown", check: (d: AchievementStats) => d.plans >= 10 },
  { id: "25_friends", title: "Team Captain", desc: "25 friends", icon: "crown", check: (d: AchievementStats) => d.friends >= 25 },
  { id: "50_meals", title: "Meal Prep Pro", desc: "50 meals logged", icon: "flame", check: (d: AchievementStats) => d.meals >= 50 },
  { id: "200_meals", title: "Nutrition Legend", desc: "200 meals logged", icon: "trophy", check: (d: AchievementStats) => d.meals >= 200 },
  { id: "100_water", title: "Hydration Master", desc: "100 water logs", icon: "droplets", check: (d: AchievementStats) => d.water >= 100 },
  { id: "50_coach", title: "Coach Veteran", desc: "50 coach messages", icon: "brain", check: (d: AchievementStats) => d.coachMsgs >= 50 },
  { id: "200_coach", title: "Coach Legend", desc: "200 coach messages", icon: "trophy", check: (d: AchievementStats) => d.coachMsgs >= 200 },
  { id: "20_results", title: "Results Legend", desc: "20 event results", icon: "trophy", check: (d: AchievementStats) => d.results >= 20 },
  { id: "25_mental", title: "Mental Athlete", desc: "25 mental check-ins", icon: "brain", check: (d: AchievementStats) => d.mentalCheckins >= 25 },
  { id: "100_mental", title: "Mental Legend", desc: "100 mental check-ins", icon: "trophy", check: (d: AchievementStats) => d.mentalCheckins >= 100 },
  { id: "10_cue", title: "Cue Legend", desc: "10 cue words", icon: "target", check: (d: AchievementStats) => d.cueWords >= 10 },
  { id: "75_workouts", title: "Three Quarters", desc: "75 workouts", icon: "flame", check: (d: AchievementStats) => d.workouts >= 75 },
  { id: "5_streak", title: "Working Week", desc: "5-day streak", icon: "flame", check: (d: AchievementStats) => d.streak >= 5 },
  { id: "10_streak", title: "10 Day Fire", desc: "10-day streak", icon: "flame", check: (d: AchievementStats) => d.streak >= 10 },
  { id: "first_purchase", title: "First Purchase", desc: "Buy something from the Market", icon: "shopping", check: (d: AchievementStats) => d.purchases.length >= 1 },
  { id: "3_purchases", title: "Collector", desc: "Make 3 purchases", icon: "shopping", check: (d: AchievementStats) => d.purchases.length >= 3 },
  { id: "all_features", title: "Feature Complete", desc: "Own all individual features", icon: "crown", check: (d: AchievementStats) => ["form_analysis", "coach_pro", "mental_gym"].every((f) => d.purchases.includes(f)) },
  { id: "first_review", title: "Self Reflector", desc: "Complete a post-event review", icon: "award", check: (d: AchievementStats) => d.reviews >= 1 },
  { id: "10_reviews", title: "Review Expert", desc: "10 post-event reviews", icon: "award", check: (d: AchievementStats) => d.reviews >= 10 },
  { id: "hrv_tracker", title: "HRV Tracker", desc: "Log HRV 5 times", icon: "heart", check: (d: AchievementStats) => d.hrvLogs >= 5 },
  { id: "hrv_master", title: "HRV Master", desc: "Log HRV 30 times", icon: "heart", check: (d: AchievementStats) => d.hrvLogs >= 30 },
  { id: "challenge_complete", title: "Challenger", desc: "Complete a challenge", icon: "trophy", check: (d: AchievementStats) => d.completedChallenges >= 1 },
  { id: "5_challenges", title: "Challenge Champ", desc: "Complete 5 challenges", icon: "medal", check: (d: AchievementStats) => d.completedChallenges >= 5 },
  { id: "10_challenges", title: "Challenge Legend", desc: "Complete 10 challenges", icon: "trophy", check: (d: AchievementStats) => d.completedChallenges >= 10 },
  { id: "create_challenge", title: "Challenge Creator", desc: "Create a custom challenge", icon: "star", check: (d: AchievementStats) => d.createdChallenges >= 1 },
  { id: "5_created", title: "Challenge Designer", desc: "Create 5 challenges", icon: "star", check: (d: AchievementStats) => d.createdChallenges >= 5 },
  { id: "event_winner", title: "Winner", desc: "Finish 1st in an event", icon: "trophy", check: (d: AchievementStats) => d.firstPlace >= 1 },
  { id: "podium", title: "Podium Finish", desc: "Finish top 3", icon: "medal", check: (d: AchievementStats) => d.podium >= 1 },
  { id: "5_podium", title: "Podium Regular", desc: "5 podium finishes", icon: "trophy", check: (d: AchievementStats) => d.podium >= 5 },
  { id: "beat_rival", title: "Rival Beaten", desc: "Finish ahead of a rival", icon: "target", check: (d: AchievementStats) => d.rivalBeats >= 1 },
  { id: "nutrition_plan", title: "Diet Planner", desc: "Create a nutrition plan", icon: "flame", check: (d: AchievementStats) => d.nutritionPlans >= 1 },
  { id: "3_nutrition", title: "Nutrition Pro", desc: "3 nutrition plans", icon: "crown", check: (d: AchievementStats) => d.nutritionPlans >= 3 },
];

// ─── 100 BUILT-IN CHALLENGES ───
const builtInChallenges = [
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
  { title: "Social Butterfly", desc: "Add 3 friends", target: 3, unit: "friends", type: "social" },
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
  { title: "Friend Network", desc: "10 friends added", target: 10, unit: "friends", type: "social" },
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

type TabType = "achievements" | "challenges" | "create";

const Achievements = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabType>("achievements");
  const [earnedAchievements, setEarnedAchievements] = useState<Achievement[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [purchases, setPurchases] = useState<string[]>([]);
  const [stats, setStats] = useState<AchievementStats>(emptyStats);
  const [showCreate, setShowCreate] = useState(false);
  const [newChTitle, setNewChTitle] = useState("");
  const [newChDesc, setNewChDesc] = useState("");
  const [newChTarget, setNewChTarget] = useState("7");
  const [newChUnit, setNewChUnit] = useState("days");

  useEffect(() => { if (user) fetchAll(); }, [user]);

  const fetchAll = async () => {
    if (!user) return;
    const [achRes, chRes, purchRes, workRes, recRes, eventRes, rivalRes, planRes, friendRes, mealRes, waterRes, coachRes, mentalRes, cueRes, reviewRes, hrvRes] = await Promise.all([
      supabase.from("achievements").select("*").eq("user_id", user.id),
      supabase.from("challenges").select("*").order("created_at", { ascending: false }),
      supabase.from("user_purchases").select("product_id").eq("user_id", user.id),
      supabase.from("workouts").select("id", { count: "exact" }).eq("user_id", user.id).eq("completed", true),
      supabase.from("recovery_logs").select("id, readiness_score", { count: "exact" }).eq("user_id", user.id),
      supabase.from("events").select("id, actual_position", { count: "exact" }).eq("user_id", user.id),
      supabase.from("event_rivals").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("training_plans").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("friendships").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("meal_logs").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("water_logs").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("coach_messages").select("id", { count: "exact" }).eq("user_id", user.id).eq("role", "user"),
      supabase.from("mental_checkins").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("cue_words").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("mental_reviews").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("recovery_logs").select("id", { count: "exact" }).eq("user_id", user.id).not("hrv", "is", null),
    ]);

    setEarnedAchievements(achRes.data || []);
    setChallenges(chRes.data || []);
    const pIds = (purchRes.data || []).map(p => p.product_id);
    setPurchases(pIds);

    const greenDays = (recRes.data || []).filter((r) => r.readiness_score != null && r.readiness_score >= 85).length;
    const events = eventRes.data || [];
    const results = events.filter((e) => e.actual_position != null);
    const firstPlace = results.filter((e) => e.actual_position === 1).length;
    const podium = results.filter((e) => e.actual_position != null && e.actual_position <= 3).length;

    const createdChallenges = (chRes.data || []).filter((c) => c.creator_id === user.id).length;
    const baseStats: AchievementStats = {
      workouts: workRes.count || 0,
      checkins: recRes.count || 0,
      greenDays,
      events: eventRes.count || 0,
      rivals: rivalRes.count || 0,
      plans: planRes.count || 0,
      friends: friendRes.count || 0,
      meals: mealRes.count || 0,
      water: waterRes.count || 0,
      coachMsgs: coachRes.count || 0,
      mentalCheckins: mentalRes.count || 0,
      cueWords: cueRes.count || 0,
      reviews: reviewRes.count || 0,
      hrvLogs: hrvRes.count || 0,
      purchases: pIds,
      results: results.length,
      firstPlace,
      podium,
      rivalBeats: 0,
      nutritionPlans: 0,
      completedChallenges: 0,
      createdChallenges,
      streak: 0,
    };

    setStats(baseStats);

    // Auto-award new achievements
    const earnedIds = new Set((achRes.data || []).map((a) => a.type));
    const statsData = baseStats;

    for (const ach of builtInAchievements) {
      if (!earnedIds.has(ach.id) && ach.check(statsData)) {
        const { error } = await supabase.from("achievements").insert({
          user_id: user.id, title: ach.title, description: ach.desc, type: ach.id, icon: ach.icon,
        });
        // 23505 = already earned (raced by another tab); anything else is a real failure.
        if (error && error.code !== "23505") {
          toast({ title: "Couldn't save an achievement", description: error.message, variant: "destructive" });
          break;
        }
      }
    }
    // Re-fetch achievements after awarding
    const { data: refreshed } = await supabase.from("achievements").select("*").eq("user_id", user.id).order("earned_at", { ascending: false });
    setEarnedAchievements(refreshed || []);
  };

  const createChallenge = async () => {
    if (!user || !newChTitle.trim()) return;
    const { error } = await supabase.from("challenges").insert({
      creator_id: user.id,
      title: newChTitle.trim(),
      description: newChDesc.trim() || null,
      target_value: parseInt(newChTarget) || 7,
      target_unit: newChUnit,
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setNewChTitle(""); setNewChDesc(""); setNewChTarget("7"); setShowCreate(false);
    fetchAll();
    toast({ title: "Challenge created! 🏆" });
  };

  const earnedIds = new Set(earnedAchievements.map(a => a.type));
  const earnedCount = earnedAchievements.length;
  const totalAch = builtInAchievements.length;

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Achievements</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Earn medals for consistency, milestones and mastery.</motion.p>
      </div>

      {/* Stats */}
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-5 shadow-card">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3, type: "spring" }}
              className="text-2xl font-display font-bold text-primary block">{earnedCount}</motion.span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Earned</p>
          </div>
          <div className="border-x border-border">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4, type: "spring" }}
              className="text-2xl font-display font-bold text-energy block">{totalAch}</motion.span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total</p>
          </div>
          <div>
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring" }}
              className="text-2xl font-display font-bold text-electric-purple block">{Math.round((earnedCount / totalAch) * 100)}%</motion.span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Complete</p>
          </div>
        </div>
      </motion.div>


      {/* Achievements Grid */}
      <div className="px-5">
        <div className="grid grid-cols-2 gap-3 mb-8">
          {builtInAchievements.map((ach, i) => {
            const earned = earnedIds.has(ach.id);
            const Icon = iconMap[ach.icon] || Trophy;
            return (
              <motion.div key={ach.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i * 0.02, 1), type: "spring", stiffness: 300, damping: 25 }}
                className={`rounded-xl p-3 text-center border transition-all duration-300 ${earned
                  ? "bg-gradient-card border-primary/30 shadow-card"
                  : "bg-card/50 border-border/50 opacity-50"
                }`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-1.5 ${earned ? "bg-primary/15" : "bg-muted/30"}`}>
                  <Icon size={18} className={earned ? "text-primary" : "text-muted-foreground/40"} />
                </div>
                <h4 className="text-[10px] font-bold">{ach.title}</h4>
                <p className="text-[8px] text-muted-foreground mt-0.5">{ach.desc}</p>
                {earned && <span className="text-[8px] text-primary font-bold">✓ Earned</span>}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};


export default Achievements;
