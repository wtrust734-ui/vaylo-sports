import vayloBrandKnowledge from "@/config/vaylo-brand-knowledge.json";

/**
 * The editable Vaylo Sports brand, product, business and advertising knowledge
 * base, loaded from `src/config/vaylo-brand-knowledge.json`.
 *
 * The JSON file is the single source of truth — edit it there, not here. This
 * module only gives the rest of the app a typed handle on it.
 *
 * `as const` cannot be applied here: it is only legal on a literal or an enum
 * member, and this is an imported binding, so TypeScript rejects it (TS1355).
 * JSON module imports already infer a precise object type, which is what
 * `VayloBrandKnowledge` exposes.
 */
export type VayloBrandKnowledge = typeof vayloBrandKnowledge;

export const brandKnowledge: VayloBrandKnowledge = vayloBrandKnowledge;

export default brandKnowledge;
