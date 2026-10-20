/**
 * REGIONAL TERMINOLOGY — server-side counterpart of src/i18n/region.ts
 *
 * Prompt 9. AI-generated plans, coaching answers and reviews must use the
 * sports language of where the athlete trains: what "football" names, the
 * spelling style (programme/program), and the units distances and masses are
 * expressed in.
 *
 * Design invariants:
 *  • Only a strict 2-letter ISO country code is accepted. Any other input —
 *    including anything the client authored — yields an empty directive, so
 *    nothing unvalidated ever enters a system prompt.
 *  • Every directive is a fixed string in THIS file. The client sends the
 *    region key only; it never authors prompt text (prompt-injection safety).
 *  • Countries without an entry get no directive at all: default global
 *    terminology is right for most of the world, and unknown means "don't
 *    touch", never "guess".
 */

export interface RegionTerminology {
  /** How the two footballs must be disambiguated. */
  footballRule: string;
  /** Spelling style for generated English prose. */
  spelling?: string;
  /** Units generated plans must express distances/masses/tempos in. */
  units: string;
}

const METRIC = "UNITS: Express all distances in kilometres, masses in kilograms, and paces as minutes per kilometre.";

const IMPERIAL_US =
  "UNITS: Express all distances in miles, masses in pounds, and paces as minutes per mile. Do not use kilometres or kilograms anywhere in the plan.";

const US_FOOTBALL =
  "TERMINOLOGY: Call the global game 'soccer' and reserve 'football' for American football (gridiron). Never use 'football' for association football in this plan.";

const SOCCER_RULE =
  "TERMINOLOGY: Where association football comes up, call it 'soccer' (this region's everyday name).";

const UK_ENGLISH = "SPELLING: Use British English spelling throughout (programme, personalised, metre, litre).";

/**
 * Regions with rules worth stating. US is the richest because it inverts both
 * the football name and every unit; the soccer-naming regions are the others
 * where "football" alone is ambiguous. GB needs no football rule (association
 * football is the default reading) but does get British spellings.
 */
const REGION_TERMINOLOGY: Record<string, RegionTerminology> = {
  US: { footballRule: US_FOOTBALL, spelling: "SPELLING: Use American English spelling throughout (program, personalized, meter, liter).", units: IMPERIAL_US },
  GB: { footballRule: "TERMINOLOGY: 'Football' means association football; say 'American football' for gridiron.", spelling: UK_ENGLISH, units: METRIC },
  CA: { footballRule: US_FOOTBALL, spelling: undefined, units: IMPERIAL_US },
  AU: { footballRule: SOCCER_RULE, spelling: UK_ENGLISH, units: METRIC },
  NZ: { footballRule: SOCCER_RULE, spelling: UK_ENGLISH, units: METRIC },
  IE: { footballRule: SOCCER_RULE, spelling: UK_ENGLISH, units: METRIC },
  ZA: { footballRule: SOCCER_RULE, spelling: UK_ENGLISH, units: METRIC },
};

/** Strict shape check: exactly two uppercase ASCII letters. */
 function isValidRegionCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Z]{2}$/.test(code);
}

/**
 * The terminology directive for an athlete's region, or "" when the region is
 * unknown/unspecified. Composed statically so additions are one-entry changes.
 */
export function terminologyDirective(region?: unknown): string {
  if (!isValidRegionCode(region)) return "";
  const t = REGION_TERMINOLOGY[region];
  if (!t) return "";
  return [t.footballRule, t.spelling, t.units].filter(Boolean).join(" ");
}
