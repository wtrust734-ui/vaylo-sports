/**
 * Profile trophy/tier summary helpers.
 *
 * These are deliberately thin on the client-side half: the real trophy counts and
 * recent-earnings list should come from Supabase before rendering the share card.
 * This module gives the UI a safe, typed shape and a sensible "no trophies yet"
 * tier classification so the card never looks empty by accident.
 */

export interface TrophySummary {
  total: number;
  recent: { name: string; earned_at: string }[];
}

export type ClassTier =
  | { tier: "rookie"; label: string; color: string }
  | { tier: "competitor"; label: string; color: string }
  | { tier: "elite"; label: string; color: string }
  | { tier: "legend"; label: string; color: string };

/**
 * Classify the athlete's visible class from trophy counts. A real app would wire
 * this to the same data the share card reads, but the shape here stays independent:
 * thresholds can change and the UI keeps rendering as long as it gets a `total`.
 */
export function tierForTrophies(total: number): ClassTier {
  if (total >= 50) return { tier: "legend", label: "Legend", color: "#f59e0b" };
  if (total >= 20) return { tier: "elite", label: "Elite", color: "#f97316" };
  if (total >= 8) return { tier: "competitor", label: "Competitor", color: "#3b82f6" };
  return { tier: "rookie", label: "Rookie", color: "#9ca3af" };
}

/**
 * Hard-coded “no trophies yet” shape, so the card can render a friendly default
 * without inventing numbers. Replace with real data from the profile/trophy query
 * before showing the share card in production.
 */
export function emptyTrophySummary(): TrophySummary {
  return { total: 0, recent: [] };
}
