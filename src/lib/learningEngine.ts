// VAYLO Learning engine — pure, presentation-free logic over learningContent.
// Search, suggestions, popularity, goal mapping, recommendations, related
// lessons and progress stats. No React, no Supabase: easy to unit-test and to
// port when the app moves to a native/mobile shell.

import { localDateKey } from "./dates";
import {
  GOAL_CATEGORY_FALLBACK,
  LEARNING_CATEGORIES,
  LEARNING_GOALS,
  LESSONS,
  MAIN_SPORTS,
  categoryFor,
  difficultyFor,
  readMinutes,
  typeFor,
  type Lesson,
} from "./learningContent";

export interface ProgressRecord {
  lesson_id: string;
  category: string;
  completed: boolean;
  saved?: boolean;
  viewed_at?: string | null;
  completed_at?: string | null;
  mastery_level?: number;
  quiz_score?: number | null;
}

export interface RecommendationProfileInput {
  sport?: string | null;
  experienceLevel?: string | null;
  goals?: string[] | null;
  age?: number | null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "for", "and", "or", "is", "are", "my", "your", "how", "what", "should", "i", "in", "on", "do", "does", "with", "it", "that", "better", "get", "be", "can"]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9á-úà-ù\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

interface LessonIndex {
  lesson: Lesson;
  tokens: Map<string, number>; // token → weight
  haystack: string;
}

const INDEX: LessonIndex[] = LESSONS.map((lesson) => {
  const tokens = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const token of tokenize(text)) tokens.set(token, (tokens.get(token) ?? 0) + weight);
  };
  add(lesson.title, 6);
  add(lesson.tags?.join(" ") ?? "", 4);
  add((lesson.sports ?? []).join(" "), 4);
  add((lesson.goals ?? []).join(" "), 3);
  add(categoryFor(lesson), 3);
  add(lesson.summary, 2);
  add(lesson.body, 1);
  return { lesson, tokens, haystack: [lesson.title, lesson.summary, lesson.body, categoryFor(lesson), ...(lesson.tags ?? []), ...(lesson.sports ?? []), ...(lesson.goals ?? [])].join(" ").toLowerCase() };
});

/** Relevance-scored search across titles, tags, sports, goals, category and body. */
export function searchLessons(query: string): Lesson[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryTokens = tokenize(trimmed);
  if (!queryTokens.length) return [];
  const scored: Array<{ lesson: Lesson; score: number }> = [];
  for (const entry of INDEX) {
    let score = 0;
    for (const token of queryTokens) {
      const weight = entry.tokens.get(token);
      if (weight) score += weight;
      else if (token.length >= 3) {
        // Prefix matches keep partial queries ("800" → "800m") useful.
        for (const [candidate, candidateWeight] of entry.tokens) {
          if (candidate.startsWith(token) || (candidate.length >= 4 && candidate.includes(token))) {
            score += candidateWeight * 0.4;
            break;
          }
        }
      }
    }
    // Phrase bonus when the full query appears verbatim.
    if (entry.haystack.includes(trimmed.toLowerCase())) score += 4;
    if (score > 0) scored.push({ lesson: entry.lesson, score: score / Math.sqrt(queryTokens.length) });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.lesson.views ?? 0) - (a.lesson.views ?? 0))
    .map((entry) => entry.lesson);
}

/** Natural-language sport mapping (e.g. "Soccer" → "Football") for profile matching. */
const SPORT_ALIASES: Record<string, string> = {
  soccer: "Football",
  "american football": "Football",
  gridiron: "Football",
  "track and field": "Athletics",
  track: "Athletics",
  "road running": "Running",
  boxing: "Combat Sports",
  mma: "Combat Sports",
  wrestling: "Combat Sports",
  "martial arts": "Combat Sports",
  bjj: "Combat Sports",
  volleyball: "Volleyball",
  badminton: "Badminton",
  triathlon: "Triathlon",
  crossfit: "CrossFit",
  "gym/weightlifting": "Gym",
  weightlifting: "Gym",
  "gym / strength training": "Gym",
};

export const resolveSport = (raw?: string | null): string | null => {
  if (!raw) return null;
  const primary = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!primary) return null;
  if (SPORT_ALIASES[primary]) return SPORT_ALIASES[primary];
  const match = ["Running", "Athletics", "Football", "Basketball", "Tennis", "Swimming", "Cycling", "Rugby", "Golf", "Cricket", "Gymnastics", "Combat Sports"].find(
    (sport) => primary.includes(sport.toLowerCase()) || sport.toLowerCase().includes(primary),
  );
  return match ?? null;
};

/** Smart suggestions for the search box: "800m" → pacing, tactics, training… */
export function getSearchSuggestions(query: string, limit = 6): Array<{ label: string; lessonId: string }> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const suggestions: Array<{ label: string; lessonId: string }> = [];
  const push = (label: string, lessonId: string) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ label, lessonId });
  };
  // Titles first, then tag phrases that extend the query ("800m" + " race tactics").
  for (const lesson of searchLessons(trimmed).slice(0, limit)) push(lesson.title, lesson.id);
  for (const lesson of LESSONS) {
    if (suggestions.length >= limit) break;
    for (const tag of lesson.tags ?? []) {
      if (suggestions.length >= limit) break;
      if (tag.includes(trimmed) || trimmed.includes(tag)) push(`${tag.charAt(0).toUpperCase()}${tag.slice(1)}`, lesson.id);
    }
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Popularity (curated editorial metadata, ranked honestly)
// ---------------------------------------------------------------------------

export function getPopularLessons(limit = 8, excludeIds: Set<string> = new Set()): Lesson[] {
  return [...LESSONS]
    .filter((lesson) => !excludeIds.has(lesson.id))
    .sort((a, b) => Number(b.trending ?? false) - Number(a.trending ?? false) || (b.views ?? 0) - (a.views ?? 0) || (b.saves ?? 0) - (a.saves ?? 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const lessonMatchesGoal = (lesson: Lesson, goalId: string): boolean => {
  const goal = LEARNING_GOALS.find((item) => item.id === goalId);
  if (!goal) return false;
  const lessonGoals = (lesson.goals ?? []).map((goal) => goal.toLowerCase());
  if (goal.terms.some((term) => lessonGoals.includes(term.toLowerCase()))) return true;
  const fallback = GOAL_CATEGORY_FALLBACK[goalId] ?? [];
  return fallback.includes(categoryFor(lesson));
};

export function getLessonsByGoal(goalId: string, limit = 6): Lesson[] {
  const matches = LESSONS.filter((lesson) => lessonMatchesGoal(lesson, goalId));
  return matches.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, limit);
}

/** Total matched lessons for a goal (used for the "N pieces matched" label). */
export function countLessonsByGoal(goalId: string): number {
  return LESSONS.filter((lesson) => lessonMatchesGoal(lesson, goalId)).length;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

const EXPERIENCE_WEIGHTS: Record<string, string[]> = {
  beginner: ["Beginner", "Developing"],
  developing: ["Developing", "Beginner", "Intermediate"],
  intermediate: ["Intermediate", "Developing", "Advanced"],
  advanced: ["Advanced", "Intermediate"],
};

export interface Recommendation {
  lesson: Lesson;
  reason: string;
}

/** Scores uncompleted lessons against sport, goals, experience and history. */
export function getRecommendations(
  profile: RecommendationProfileInput,
  progress: ProgressRecord[],
  limit = 3,
): Recommendation[] {
  const sport = resolveSport(profile.sport);
  const goals = (profile.goals ?? []).map((goal) => goal.toLowerCase());
  const levels = EXPERIENCE_WEIGHTS[(profile.experienceLevel ?? "").toLowerCase()] ?? [];
  const byId = new Map(progress.map((record) => [record.lesson_id, record]));
  const recentIds = progress
    .filter((record) => record.viewed_at && !record.completed)
    .sort((a, b) => (b.viewed_at ?? "").localeCompare(a.viewed_at ?? ""))
    .slice(0, 5)
    .map((record) => record.lesson_id);

  const scored: Array<{ lesson: Lesson; score: number; reason: string }> = [];
  for (const lesson of LESSONS) {
    const record = byId.get(lesson.id);
    if (record?.completed) continue;
    let score = 0;
    let reason = "";
    if (sport && (lesson.sports ?? []).includes(sport)) {
      score += 4;
      reason = `For ${sport} athletes`;
    }
    const matchedGoal = goals.find((goal) => (lesson.goals ?? []).some((lessonGoal) => lessonGoal.toLowerCase().includes(goal) || goal.includes(lessonGoal.toLowerCase())));
    if (matchedGoal) {
      score += 3;
      reason = reason || "Based on your goals";
    }
    if (levels.includes(difficultyFor(lesson))) score += 1.5;
    if (recentIds.includes(lesson.id)) {
      score += 2;
      reason = reason || "Picks up where you left off";
    }
    if (record?.saved) {
      score += 2;
      reason = reason || "Saved for later";
    }
    if (profile.age != null && profile.age < 16 && difficultyFor(lesson) === "Advanced") score -= 2;
    if (score <= 0) continue;
    scored.push({ lesson, score, reason: reason || "Popular with athletes like you" });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.lesson.views ?? 0) - (a.lesson.views ?? 0))
    .slice(0, limit)
    .map(({ lesson, reason }) => ({ lesson, reason }));
}

/** Related lessons: same category or shared sport, excluding the current one. */
export function getRelated(lesson: Lesson, limit = 3): Lesson[] {
  const sports = new Set((lesson.sports ?? []).map((sport) => sport.toLowerCase()));
  return LESSONS.filter((candidate) => {
    if (candidate.id === lesson.id) return false;
    const sharedSport = (candidate.sports ?? []).some((sport) => sports.has(sport.toLowerCase()));
    return sharedSport || categoryFor(candidate) === categoryFor(lesson);
  })
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Progress stats
// ---------------------------------------------------------------------------

export interface LearningStats {
  completed: number;
  saved: number;
  topicsExplored: number;
  streak: number;
  totalLessons: number;
  categoryProgress: Array<{ category: string; completed: number; total: number }>;
}

/** Consecutive-day learning streak from activity dates (today or yesterday keeps it alive). */
export function calculateStreak(progress: ProgressRecord[]): number {
  const days = new Set<string>();
  for (const record of progress) {
    for (const field of [record.viewed_at, record.completed_at]) {
      if (field) days.add(field.slice(0, 10));
    }
  }
  if (!days.size) return 0;
  const toKey = (date: Date) => localDateKey(date);
  const cursor = new Date();
  if (!days.has(toKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // yesterday still counts; earlier breaks the streak
    if (!days.has(toKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(toKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function getLearningStats(progress: ProgressRecord[]): LearningStats {
  const byId = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));
  const completedByCategory = new Map<string, Set<string>>();
  let completed = 0;
  let saved = 0;
  for (const record of progress) {
    if (record.saved) saved += 1;
    if (!record.completed || !byId.has(record.lesson_id)) continue;
    completed += 1;
    const category = categoryFor(byId.get(record.lesson_id)!);
    if (!completedByCategory.has(category)) completedByCategory.set(category, new Set());
    completedByCategory.get(category)!.add(record.lesson_id);
  }
  const categoryProgress = LEARNING_CATEGORIES.map((category) => ({
    category: category.label,
    completed: completedByCategory.get(category.id)?.size ?? 0,
    total: LESSONS.filter((lesson) => categoryFor(lesson) === category.id).length,
  })).filter((entry) => entry.total > 0);

  return {
    completed,
    saved,
    topicsExplored: completedByCategory.size,
    streak: calculateStreak(progress),
    totalLessons: LESSONS.length,
    categoryProgress,
  };
}

/** Reading-time bucket for filters: "Quick" ≤3 min, otherwise ≤8 min. */
export const matchesTimeFilter = (lesson: Lesson, filter: string): boolean =>
  filter === "All" || (filter === "Quick" ? readMinutes(lesson) <= 3 : filter === "Under 8 min" ? readMinutes(lesson) <= 8 : false);

// ---------------------------------------------------------------------------
// Visible library (sport × search × filters)
// ---------------------------------------------------------------------------

/** Sport chip semantics: "All Sports" shows everything; "More" shows niche
 * sports only; a named sport shows lessons tagged with it. */
const matchesSportFilter = (lesson: Lesson, sport: string): boolean => {
  if (sport === "All Sports") return true;
  if (!lesson.sports?.length) return true; // general lessons apply to every sport
  if (sport === "More") return lesson.sports.some((s) => !MAIN_SPORTS.includes(s));
  return lesson.sports.some((s) => s.toLowerCase() === sport.toLowerCase());
};

export interface VisibleFilterState {
  category: string;
  difficulty: string;
  time: string;
  type: string;
}

/** The library grid: sport chip × search query × filter sheet, search-ranked. */
export function buildVisibleLessons({
  sport,
  query,
  filters,
  progress = {},
}: {
  sport: string;
  query: string;
  filters: VisibleFilterState;
  progress?: Record<string, ProgressRecord>;
}): Lesson[] {
  let lessons = LESSONS.filter((lesson) => matchesSportFilter(lesson, sport));
  if (filters.category !== "All") lessons = lessons.filter((lesson) => categoryFor(lesson) === filters.category);
  if (filters.difficulty !== "All") lessons = lessons.filter((lesson) => difficultyFor(lesson) === filters.difficulty);
  if (filters.time !== "All") lessons = lessons.filter((lesson) => matchesTimeFilter(lesson, filters.time));
  if (filters.type !== "All") lessons = lessons.filter((lesson) => typeFor(lesson) === filters.type);

  const trimmed = query.trim();
  if (trimmed) {
    const ranked = searchLessons(trimmed);
    const allowed = new Set(lessons.map((lesson) => lesson.id));
    return ranked.filter((lesson) => allowed.has(lesson.id));
  }
  return [...lessons].sort((a, b) => {
    const aDone = progress[a.id]?.completed ? 1 : 0;
    const bDone = progress[b.id]?.completed ? 1 : 0;
    return aDone - bDone || (b.views ?? 0) - (a.views ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Recent searches (device-local; keyed so a future account sync can extend it)
// ---------------------------------------------------------------------------

const RECENT_KEY = "vaylo:learning:recent-searches";

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): void {
  const trimmed = query.trim();
  if (trimmed.length < 3) return;
  const next = [trimmed, ...getRecentSearches().filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* non-fatal */
  }
}
