// ============================================================================
// EQUIPMENT — edge-function mirror of src/config/equipment.ts
// ----------------------------------------------------------------------------
// Why this exists: generate-plan must turn the athlete's equipment into a
// prompt instruction, and it must do that from a value it can trust. The
// ids/labels/cues are duplicated here because the Deno runtime cannot import
// from src/, and the money catalog is mirrored for the same reason.
//
// A mirror is only safe if it is checked, so `src/lib/equipmentMirror.test.ts`
// imports BOTH modules and fails if an id, a label or a planCue disagrees.
// Edit this file and src/config/equipment.ts together.
//
// The `none` id is not decoration: it is the explicit "I have nothing" answer,
// and it must override anything else so a plan can never prescribe a pool
// session to an athlete who said they have no equipment.
// ============================================================================

export type EquipmentId =
  | "full_gym"
  | "home_weights"
  | "resistance_bands"
  | "pullup_bar"
  | "kettlebell"
  | "track"
  | "field_court"
  | "pool_25m"
  | "open_water"
  | "bike"
  | "turbo_trainer"
  | "treadmill"
  | "rowing_erg"
  | "skipping_rope"
  | "mats_floor_space"
  | "none";

export interface EquipmentItem {
  id: EquipmentId;
  label: string;
  group: "Gym" | "Endurance" | "Field" | "Minimal";
  planCue: string;
}

export const EQUIPMENT: EquipmentItem[] = [
  { id: "full_gym", label: "Full gym", group: "Gym", planCue: "Barbells, racks and machines are available — prescribe loaded compound lifts and machine accessories." },
  { id: "home_weights", label: "Home weights", group: "Gym", planCue: "Dumbbells/kettlebells at home — use dumbbell and unilateral loading, avoid barbell-only lifts." },
  { id: "resistance_bands", label: "Resistance bands", group: "Gym", planCue: "Bands are available — use them for activation, accessory volume and rehab-style work." },
  { id: "pullup_bar", label: "Pull-up bar", group: "Gym", planCue: "A pull-up bar is available — vertical pulling and hanging work are permitted." },
  { id: "kettlebell", label: "Kettlebell", group: "Gym", planCue: "A kettlebell is available — swings, cleans, carries and single-leg work are permitted." },
  { id: "track", label: "Track / measured surface", group: "Endurance", planCue: "A measured track is available — prescribe interval sessions with exact distances and paces." },
  { id: "field_court", label: "Field or court", group: "Field", planCue: "A field/court is available — prescribe change-of-direction, agility and sport-specific drills." },
  { id: "pool_25m", label: "25 m+ pool", group: "Endurance", planCue: "A 25 m or longer pool is available — prescribe swim cross-training sessions with distances in metres." },
  { id: "open_water", label: "Open water access", group: "Endurance", planCue: "Open water is available — open-water swim sessions are permitted (never prescribe them alone/unsupervised)." },
  { id: "bike", label: "Bike", group: "Endurance", planCue: "A bike is available — prescribe cycling cross-training, including easy aerobic and interval rides." },
  { id: "turbo_trainer", label: "Turbo trainer / indoor bike", group: "Endurance", planCue: "An indoor trainer is available — prescribe structured indoor rides with duration and effort targets." },
  { id: "treadmill", label: "Treadmill", group: "Endurance", planCue: "A treadmill is available — prescribe treadmill sessions with pace and incline targets." },
  { id: "rowing_erg", label: "Rowing machine", group: "Endurance", planCue: "A rowing erg is available — prescribe rowing intervals and steady-state pieces." },
  { id: "skipping_rope", label: "Skipping rope", group: "Minimal", planCue: "A skipping rope is available — use it for footwork, conditioning and warm-ups." },
  { id: "mats_floor_space", label: "Mat / floor space", group: "Minimal", planCue: "Floor space and a mat are available — bodyweight, mobility and core work are permitted." },
  { id: "none", label: "Nothing yet / bodyweight only", group: "Minimal", planCue: "The athlete has NO equipment — every prescribed exercise must be bodyweight only. Do not prescribe any gym, bike, pool or track session." },
];

const BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

/**
 * Keep only ids this build knows about.
 *
 * Deliberately drops unknown ids rather than passing them through: an id from a
 * newer client that this function does not understand would otherwise reach the
 * prompt as a bare token and be interpreted by the model.
 */
export const normaliseEquipment = (value: unknown): EquipmentId[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<EquipmentId>();
  for (const raw of value) {
    const id = String(raw) as EquipmentId;
    if (BY_ID.has(id)) seen.add(id);
  }
  return [...seen];
};

/** The instruction block handed to the plan model. */
export const equipmentDirective = (ids: readonly EquipmentId[] | null | undefined): string => {
  const given = (ids ?? []).filter((id) => BY_ID.has(id));
  // "Nothing yet" wins over anything alongside it. The picker makes the answer
  // exclusive, but this is the last line of defence: a stored profile that says
  // both "none" and "bike" must produce a bodyweight-only plan, not a bike
  // session. Treating it as "some equipment" is the one failure that puts an
  // athlete in a session they cannot do.
  const usable = given.includes("none") ? [] : given;
  if (usable.length === 0) {
    return [
      "EQUIPMENT: The athlete has no equipment recorded.",
      "Prescribe bodyweight, mobility and space-only work ONLY. Do not prescribe gym, pool, bike or track sessions.",
      "You MAY note in a session description what they could add if they gained access to something (for example a 25 m pool for swim cross-training).",
    ].join("\n");
  }
  return [
    "EQUIPMENT AVAILABLE (this is the complete list — nothing else exists for this athlete):",
    ...usable.map((id) => `- ${BY_ID.get(id)!.label}: ${BY_ID.get(id)!.planCue}`),
    "Use this equipment to build cross-training into the plan where it genuinely helps the goal.",
    "Do NOT prescribe any session requiring equipment that is not on this list. If a session would normally need it, substitute an available option.",
  ].join("\n");
};
