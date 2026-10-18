// ============================================================================
// brandDefaults — the single server-side source for Vaylo's brand configuration.
// ----------------------------------------------------------------------------
// Seed values come from _shared/vayloBrandKnowledge.ts (the strategist corpus
// verified in PROMPT 1, which itself quotes the supplied logo artwork, the
// launch posture and the audience rules verbatim). The Ads Studio brand page
// edits a stored copy; these defaults are what a *new* studio user sees and
// what every specialist workflow falls back to when a setting is unset.
// ============================================================================
import { VAYLO_BRAND as VAYLO } from "./vayloBrandKnowledge.ts";

export interface BrandConfig {
  name: string;
  slogan: string;
  description: string;
  positioning: string;
  toneOfVoice: string;
  targetAudience: string;
  colors: { black: string; navy: string; purple: string };
  typography: string;
  approvedCtas: string[];
  prohibitedClaims: string[];
  logoPath: string | null;
}

export const DEFAULT_BRAND: BrandConfig = {
  name: VAYLO.company.name,
  slogan: VAYLO.company.slogan,
  description: VAYLO.company.corePurpose,
  positioning: VAYLO.company.positioning,
  toneOfVoice: "Credible, competitive, premium — never exaggerated, never a generic AI startup.",
  targetAudience: VAYLO.audience.targetNote.split(". ").slice(0, 1).join(". ") + ".",
  colors: {
    black: VAYLO.brand.logo.colours.background,
    navy: "#07090f",
    purple: VAYLO.brand.logo.colours.gradientEndPurple,
  },
  typography: VAYLO.brand.typography,
  approvedCtas: ["Join the waitlist", "Follow Vaylo Sports", "Discover Vaylo"],
  prohibitedClaims: [
    "No price, free trial, discount or subscription cost — there is no checkout yet",
    "No AI-feature claims on app surfaces that fail closed (plan, coach, form analysis)",
    "No guarantees of performance results, injury prevention, prediction or clinical proof",
    "No invented statistics, user counts, reviews, ratings or testimonials",
    "No 'largest / best / most accurate / fastest-growing' without independent evidence",
    "No pre-launch 'Download now' unless the destination actually exists",
    "No fabricated app screens, and no implying an endorsement by depicted athletes or brands",
  ],
  logoPath: "src/assets/logo.jpg",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function clampString(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function clampList(v: unknown, max: number, itemMax = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, itemMax)).slice(0, max);
}

/**
 * Validation used by ads-brand before anything is persisted. Returns problems
 * as strings; an empty list means the payload is safe to merge.
 */
export function validateBrandConfigInput(body: unknown): { ok: boolean; problems: string[]; value?: Record<string, unknown> } {
  if (!body || typeof body !== "object") return { ok: false, problems: ["body must be an object"] };
  const o = body as Record<string, unknown>;
  const problems: string[] = [];
  const value: Record<string, unknown> = {};

  const name = clampString(o.name, 80).trim();
  if (!name) problems.push("name is required");
  if (name) value.name = name;

  value.slogan = clampString(o.slogan, 200);
  value.description = clampString(o.description, 2000);
  value.positioning = clampString(o.positioning, 300);
  value.toneOfVoice = clampString(o.toneOfVoice, 500);
  value.targetAudience = clampString(o.targetAudience, 1000);
  value.typography = clampString(o.typography, 200);

  // Colours arrive as strings; two palettes are allowed: flat hex keys... the
  // shape below is the stored shape (flat), the UI shows it as three swatches.
  if (o.colors !== undefined) {
    if (!o.colors || typeof o.colors !== "object") problems.push("colors must be an object");
    else {
      const c = o.colors as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const key of ["black", "navy", "purple"]) {
        const v = clampString(c[key], 9).toUpperCase();
        if (v && !HEX.test(v)) problems.push(`colors.${key} must be a #RRGGBB hex string`);
        if (v) out[key] = v;
      }
      if (!problems.length) value.colors = out;
    }
  }

  if (o.approvedCtas !== undefined) {
    const list = clampList(o.approvedCtas, 12);
    if (o.approvedCtas !== null && !Array.isArray(o.approvedCtas)) problems.push("approvedCtas must be an array");
    else value.approvedCtas = list;
  }
  if (o.prohibitedClaims !== undefined) {
    const list = clampList(o.prohibitedClaims, 20);
    if (o.prohibitedClaims !== null && !Array.isArray(o.prohibitedClaims)) problems.push("prohibitedClaims must be an array");
    else value.prohibitedClaims = list;
  }
  if (o.logoPath !== undefined) {
    if (o.logoPath === null) value.logoPath = null;
    else if (typeof o.logoPath === "string" && o.logoPath.length <= 300) value.logoPath = o.logoPath;
    else problems.push("logoPath must be null or a string");
  }

  return { ok: problems.length === 0, problems, value };
}

/** Merge stored config over defaults — read path for every consumer. */
export function mergeBrandConfig(stored: unknown): BrandConfig {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_BRAND };
  const o = stored as Record<string, unknown>;
  const d = DEFAULT_BRAND;
  const colors = (o.colors ?? {}) as Record<string, unknown>;
  return {
    name: clampString(o.name, 80) || d.name,
    slogan: clampString(o.slogan, 200) || d.slogan,
    description: clampString(o.description, 2000) || d.description,
    positioning: clampString(o.positioning, 300) || d.positioning,
    toneOfVoice: clampString(o.toneOfVoice, 500) || d.toneOfVoice,
    targetAudience: clampString(o.targetAudience, 1000) || d.targetAudience,
    typography: clampString(o.typography, 200) || d.typography,
    colors: {
      black: clampString(colors.black, 9) || d.colors.black,
      navy: clampString(colors.navy, 9) || d.colors.navy,
      purple: clampString(colors.purple, 9) || d.colors.purple,
    },
    approvedCtas: clampList(o.approvedCtas, 12).length ? clampList(o.approvedCtas, 12) : d.approvedCtas,
    prohibitedClaims: clampList(o.prohibitedClaims, 20).length ? clampList(o.prohibitedClaims, 20) : d.prohibitedClaims,
    logoPath: typeof o.logoPath === "string" ? o.logoPath : d.logoPath,
  };
}
