// ============================================================================
// EQUIPMENT & FACILITIES
// ----------------------------------------------------------------------------
// What an athlete can actually train with changes the plan more than their
// experience level does. A swimmer with access to a 25 m pool gets real
// cross-training; a swimmer without one cannot be prescribed pool sessions at
// all, and prescribing them is not a small error — it is a session they cannot
// do.
//
// This list is the single source of truth for the question asked at signup and
// again at plan creation, and for the `equipment` array sent to the plan model.
// The ids are stable and stored on the profile; the labels are display-only and
// may change. Never store a label.
//
// The `planCue` is what the model is told the item enables. It exists so the
// cross-training instruction is concrete ("25 m+ pool → swim cross-training
// sessions") rather than a bare token the model has to interpret, which is how
// a plan ends up prescribing a bike to somebody who has a treadmill.
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

export type EquipmentItem = {
  id: EquipmentId;
  label: string;
  /** Grouping for the picker. */
  group: "Gym" | "Endurance" | "Field" | "Minimal";
  /**
   * One line telling the plan model what this unlocks. Written as an
   * instruction, not a noun phrase, because that is what the prompt uses.
   */
  planCue: string;
};

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

export const EQUIPMENT_IDS = EQUIPMENT.map((e) => e.id) as EquipmentId[];

const BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export const equipmentLabel = (id: EquipmentId): string => BY_ID.get(id)?.label ?? id;

/**
 * Human-readable list for a plan description or a prompt line.
 * Returns "bodyweight only" rather than an empty string, because an empty
 * string in a prompt reads as "unstated" and the model fills the gap with a
 * guess.
 */
export const describeEquipment = (ids: readonly EquipmentId[] | null | undefined): string => {
  const usable = (ids ?? []).filter((id) => BY_ID.has(id));
  if (usable.length === 0) return "not stated — assume bodyweight and general space only";
  if (usable.includes("none")) return "bodyweight only, no equipment";
  return usable.map(equipmentLabel).join(", ");
};

/**
 * The instruction block handed to the plan model. Deliberately imperative and
 * ends with the prohibition, because the failure mode being prevented is a plan
 * that quietly prescribes a pool session to somebody who has no pool.
 */
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
    ...usable.map((id) => `- ${equipmentLabel(id)}: ${BY_ID.get(id)!.planCue}`),
    "Use this equipment to build cross-training into the plan where it genuinely helps the goal.",
    "Do NOT prescribe any session requiring equipment that is not on this list. If a session would normally need it, substitute an available option.",
  ].join("\n");
};

/** Normalise anything read back from storage or the client into known ids. */
export const normaliseEquipment = (value: unknown): EquipmentId[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<EquipmentId>();
  for (const raw of value) {
    const id = String(raw) as EquipmentId;
    if (BY_ID.has(id)) seen.add(id);
  }
  return [...seen];
};
