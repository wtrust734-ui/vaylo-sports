// ============================================================================
// REGIONAL SPORTS TERMINOLOGY — one registry, one hook, no per-component maps
// ----------------------------------------------------------------------------
// Prompt 9. Sport names are the hard case in localisation: "Football" means
// association football to almost everyone and American football to an American,
// and several languages have a genuinely different local name (calcio, fútbol,
// soccer in North America and Australasia). The one rule that keeps data
// honest is: **the stored value is canonical, display is regional.**
//
//   • `profiles.sport`, plans, logs, AI payloads always carry the canonical
//     name ("Football", "American Football" are DIFFERENT sports and never
//     collapse into each other).
//   • Rendering maps canonical → regional display through `sportDisplayName`.
//   • Free-text intake (search, onboarding input) maps regional aliases back
//     through `canonicaliseSportName`, so "Soccer" typed in the US and
//     "Football" typed in the UK resolve to the same stored sport — no
//     duplicate sports created because of a translated name.
//
// The registry only carries terms that genuinely differ by region. Everything
// else renders the canonical name untouched, and an unknown country simply
// falls through to the defaults: unsupported countries are safe by design.
//
// NOTE: module-level region state is deliberately plain (no React), and this
// file does NOT import the i18n core — the language tag is attached to AI
// payloads by aiService (getAiLocale), so nothing here needs it. That keeps
// format.ts → region.ts a one-way edge with no import cycle.
// ============================================================================

/** The canonical sport names the app stores. Adding one = add it here. */
export type CanonicalSport =
  | "Running" | "Cycling" | "Swimming" | "Triathlon" | "Cricket"
  | "Football"                       // association football
  | "American Football"              // gridiron — a separate sport, permanently
  | "Gaelic Football"
  | "Basketball" | "Rugby" | "Tennis" | "Weightlifting" | "Climbing"
  | "MMA / Boxing" | "Other";

/**
 * One region's terminology. Entries are optional; absence = the canonical
 * name renders as-is, which is also the fall-through for unmapped countries.
 */
export type RegionTerms = Partial<Record<CanonicalSport, string>>;

/** Defaults — what most of the world's English (and every language's direct mapping) expects. */
const DEFAULT_TERMS: Partial<Record<string, string>> = {};

/**
 * Regional overrides. Keys are ISO 3166-1 alpha-2 codes (the same codes
 * `user_region.country` stores — one source of truth with lib/geo.ts).
 *
 * Associations: the US/Canada/Australasia convention is "Soccer" for the
 * global game; Ireland distinguishes both from Gaelic football; the UK,
 * most of Europe, South America and most other countries read "Football"
 * as association football by default, so there is nothing to override.
 */
const REGION_OVERRIDES: Record<string, Partial<Record<CanonicalSport, string>>> = {
  US: { Football: "Soccer" },
  CA: { Football: "Soccer" },
  AU: { Football: "Soccer" },
  NZ: { Football: "Soccer" },
  IE: { Football: "Soccer" }, // disambiguates against Gaelic Football
  ZA: { Football: "Soccer" },
};

/** Regional spellings the AI + UI use for the selected region. Static, validated. */
export interface RegionSpelling {
  /** -ise/-ize style words appear inside generated plans. */
  style: "uk" | "us";
  /** Small set shown in UI where the two spellings differ. */
  programme: string; // "Programme" | "Program"
  metre: string;     // "Metre" | "Meter"
}

const UK_SPELLING: RegionSpelling = { style: "uk", programme: "Programme", metre: "Metre" };
const US_SPELLING: RegionSpelling = { style: "us", programme: "Program", metre: "Meter" };

/**
 * Countries whose English conventions are worth naming. Everything else:
 * metric + UK-style English, which is the safe global default. Each entry
 * also states the units the region actually uses (see src/i18n/units.ts for
 * the conversions; one source of truth for the mapping here).
 */
export const REGION_CONVENTIONS: Record<
  string,
  { spelling: RegionSpelling; distance: "km" | "mi"; weight: "kg" | "lb" }
> = {
  US: { spelling: US_SPELLING, distance: "mi", weight: "lb" },
  GB: { spelling: UK_SPELLING, distance: "km", weight: "kg" },
  IE: { spelling: UK_SPELLING, distance: "km", weight: "kg" },
  AU: { spelling: UK_SPELLING, distance: "km", weight: "kg" },
  NZ: { spelling: UK_SPELLING, distance: "km", weight: "kg" },
};

/* ------------------------------ region state ---------------------------- */

let regionCountry: string | null = null;

/**
 * The module-level region hint, set by the profile load (Profile.tsx) once the
 * athlete's stored country is known, and cleared on sign-out. Purely client
 * state: like the language preference, it exists so renderers and AI payloads
 * do not each have to re-read `user_region` from Supabase.
 *
 * A null region means "no confirmed preference" — callers must treat the
 * device language / canonical defaults as the fallback, never invent a region.
 */
export function setRegionCountry(code: string | null | undefined): void {
  const normalised = (code ?? "").trim().toUpperCase();
  regionCountry = /^[A-Z]{2}$/.test(normalised) ? normalised : null;
}

export function getRegionCountry(): string | null {
  return regionCountry;
}

/** True when a country has been confirmed this session. */
export function hasConfirmedRegion(): boolean {
  return regionCountry !== null;
}

/* ------------------------------ naming --------------------------------- */

/** Regional display name for one canonical sport. Unknown sports pass through. */
export function sportDisplayName(sport: string | null | undefined, country?: string | null): string {
  const canonical = sport?.trim();
  if (!canonical) return "";
  const code = (country ?? regionCountry ?? "").toUpperCase();
  const merged = { ...DEFAULT_TERMS, ...REGION_OVERRIDES[code] } as Partial<Record<string, string>>;
  return merged[canonical] ?? canonical;
}

/**
 * Map an arbitrary (possibly regional) sport label back to its canonical
 * stored name. The alias table is the inverse of the registry, plus the
 * names people actually type. Returns null for unmapped input — never
 * invents a sport, so an unknown term cannot create a duplicate row.
 */
const ALIASES: Record<string, CanonicalSport> = {
  soccer: "Football",
  football: "Football",
  "american football": "American Football",
  gridiron: "American Football",
  nfl: "American Football",
  "gaelic football": "Gaelic Football",
  gaelic: "Gaelic Football",
  "mma / boxing": "MMA / Boxing",
  mma: "MMA / Boxing",
  boxing: "MMA / Boxing",
};

export function canonicaliseSportName(input: string | null | undefined): CanonicalSport | null {
  const key = input?.trim().toLowerCase();
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  // Fall through to the canonical list (includes sports with no display entry).
  const all: CanonicalSport[] = [
    "Running", "Cycling", "Swimming", "Triathlon", "Cricket", "Football",
    "American Football", "Gaelic Football", "Basketball", "Rugby", "Tennis",
    "Weightlifting", "Climbing", "MMA / Boxing", "Other",
  ];
  return all.find((s) => s.toLowerCase() === key) ?? null;
}

/** Spelling bundle for the active region (UK English by default). */
export function regionSpelling(country?: string | null): RegionSpelling {
  const key = (country ?? regionCountry ?? "").toUpperCase();
  return REGION_CONVENTIONS[key]?.spelling ?? UK_SPELLING;
}

/* ------------------------------ AI briefs ------------------------------ */

/**
 * A short, static terminology brief the client attaches to AI requests.
 * Only the region key rides along; the server (terminology.ts) expands it —
 * no client-authored prose ever enters a prompt, so this cannot inject.
 */
export function regionAiKey(): string | null {
  const code = regionCountry;
  if (!code) return null;
  if (code in REGION_CONVENTIONS || code in REGION_OVERRIDES) return code;
  return null;
}

/** Convenience for AI payloads: the regional brief key (null = no confirmed region). */
export function regionAiContext(): { userRegion: string | null } {
  return { userRegion: regionAiKey() }; 
}
