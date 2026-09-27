// ============================================================================
// VAYLO SPORTS — public athlete identity
// ----------------------------------------------------------------------------
// `profiles` is protected by self-only RLS (`auth.uid() = user_id`), so it can
// NEVER resolve another athlete's name. Every social surface that selected
// `profiles.full_name` for a cross-user list therefore rendered "Athlete" for
// everyone (or, worse, hung waiting on a row that can never come back).
//
// `avatars` is the table the schema deliberately makes publicly readable
// ("Avatars are publicly viewable") and it carries `display_name`, so all
// cross-user naming goes through here.
//
// Privacy note: this deliberately exposes nothing new. It reads a column that
// was already granted to every authenticated user — no `profiles` access, no
// RLS loosening, no private column (date_of_birth, credits, coins, weight_kg,
// sex) is touched.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

/** Shown when an athlete has not set a public display name. */
export const UNKNOWN_ATHLETE = "Athlete";

export type DisplayNameMap = Record<string, string>;

interface AvatarNameRow {
  user_id: string;
  display_name: string | null;
}

/**
 * Resolves public display names for a set of user ids.
 * Ids with no public name are simply absent from the map — callers should fall
 * back to `UNKNOWN_ATHLETE`. Never throws: a lookup failure yields `{}` so a
 * missing name can't take down the page around it.
 */
export async function fetchDisplayNames(
  userIds: (string | null | undefined)[],
): Promise<DisplayNameMap> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from("avatars")
    .select("user_id, display_name")
    .in("user_id", ids);

  if (error) {
    console.error("fetchDisplayNames failed:", error.message);
    return {};
  }

  const names: DisplayNameMap = {};
  for (const row of (data ?? []) as AvatarNameRow[]) {
    const name = row.display_name?.trim();
    if (name) names[row.user_id] = name;
  }
  return names;
}

/** Public display name for a single athlete. */
export async function fetchDisplayName(userId: string): Promise<string> {
  const names = await fetchDisplayNames([userId]);
  return names[userId] ?? UNKNOWN_ATHLETE;
}
