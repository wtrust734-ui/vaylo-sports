// ============================================================================
// THE ACHIEVEMENT CATALOGUE — one definition, read by two screens
// ----------------------------------------------------------------------------
// Achievements and Badges are separate screens in the Trophy Room, and they must
// not show each other's medals. They are, however, the same table of rules: a
// "badge" is an achievement whose `check` reads `d.purchases`, and nothing else
// distinguishes them. So the catalogue lives here once, with the shelves derived
// from it, rather than being copied into a page and drifting.
//
// `builtInAchievements` is the whole catalogue. `BADGE_IDS` names the purchase
// ids inside it, and the two shelves are `badgeShelf()` and
// `achievementShelf()` — disjoint, and together the catalogue.
// ============================================================================

import type { Tables } from "@/integrations/supabase/types";

export type Achievement = Tables<"achievements">;

/**
 * Every counter an achievement rule can test against. Built from Supabase
 * counts by `useAchievementStats`, so achievement checks stay type-checked end
 * to end.
 */
export interface AchievementStats {
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

export const emptyStats: AchievementStats = {
  workouts: 0, streak: 0, checkins: 0, greenDays: 0, events: 0, results: 0,
  firstPlace: 0, podium: 0, rivals: 0, rivalBeats: 0, plans: 0, friends: 0,
  meals: 0, water: 0, coachMsgs: 0, mentalCheckins: 0, cueWords: 0, reviews: 0,
  hrvLogs: 0, purchases: [], nutritionPlans: 0, completedChallenges: 0, createdChallenges: 0,
};

// ─── 100 BUILT-IN ACHIEVEMENTS ───
export const builtInAchievements = [
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
  // Restored 2026-10-08 with the Friends screen (docs/FRIENDS.md). These four
  // were retired in the morning, when /friends redirected home and nothing in
  // the app could add a friend: an achievement nobody can unlock is a broken
  // promise with a trophy on it. Friending works again, `d.friends` counts the
  // athlete's own friendship rows, so every one of them is earnable.
  { id: "first_friend", title: "Social Athlete", desc: "Add your first friend", icon: "star", check: (d: AchievementStats) => d.friends >= 1 },
  { id: "5_friends", title: "Squad", desc: "Have 5 friends", icon: "star", check: (d: AchievementStats) => d.friends >= 5 },
  { id: "10_friends", title: "Popular", desc: "Have 10 friends", icon: "crown", check: (d: AchievementStats) => d.friends >= 10 },
  { id: "25_friends", title: "Team Captain", desc: "25 friends", icon: "crown", check: (d: AchievementStats) => d.friends >= 25 },
  // Still retired: the "Social Butterfly" and "Friend Network" challenges.
  // They are seeded rows in the challenges table, so bringing them back is a
  // seed migration and a copy review, not a code change.
  { id: "mental_owner", title: "Mental Gym Owner", desc: "Purchase Mental Gym", icon: "brain", check: (d: AchievementStats) => d.purchases.includes("mental_gym") },
  { id: "form_owner", title: "Form Analyst", desc: "Purchase Form Analysis", icon: "target", check: (d: AchievementStats) => d.purchases.includes("form_analysis") },
  // The four achievements below used to name products the app no longer sells
  // — "Coach Pro", "Pro" and "Minimum" tiers — so they could never fire. They
  // now check product ids that actually exist, which is what user_purchases
  // is written with. Coach is per-prompt, not a product, and already has its
  // own message-count achievements, so that one is gone rather than repointed.
  { id: "injury_owner", title: "Injury Manager", desc: "Unlock Injury Management", icon: "shield", check: (d: AchievementStats) => d.purchases.includes("injury_management") },
  { id: "credit_sub", title: "Recurring Athlete", desc: "Subscribe to the credit plan", icon: "crown", check: (d: AchievementStats) => d.purchases.includes("credit_monthly") },
  { id: "unlimited_sub", title: "All In", desc: "Subscribe to Unlimited", icon: "crown", check: (d: AchievementStats) => d.purchases.includes("unlimited_monthly") },
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
  { id: "all_features", title: "Feature Complete", desc: "Own all individual features", icon: "crown", check: (d: AchievementStats) => ["mental_gym", "injury_management", "cross_sport"].every((f) => d.purchases.includes(f)) },
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


/**
 * The achievements earned by buying something from the Market — the Badges
 * screen. These are the only achievement ids whose `check` reads
 * `d.purchases`, so this set is the definition of "badge".
 */
export const BADGE_IDS = new Set([
  "mental_owner",
  "form_owner",
  "injury_owner",
  "credit_sub",
  "unlimited_sub",
  "first_purchase",
  "3_purchases",
  "all_features",
]);

/**
 * The two shelves, derived so they cannot disagree: every badge id is also a row
 * in the catalogue (the badges are achievement rules), so filtering is the only
 * definition that keeps them disjoint and complete at the same time.
 */
export const badgeShelf = () => builtInAchievements.filter((ach) => BADGE_IDS.has(ach.id));

export const achievementShelf = () => builtInAchievements.filter((ach) => !BADGE_IDS.has(ach.id));

/** How many of a shelf the athlete has earned. */
export const earnedIn = (
  shelf: { id: string }[],
  earnedIds: Set<string>,
): number => shelf.filter((ach) => earnedIds.has(ach.id)).length;

/** Shelf completion, as a whole percent. Zero shelf = zero, never NaN. */
export const percentEarned = (earned: number, total: number): number =>
  total > 0 ? Math.round((earned / total) * 100) : 0;
