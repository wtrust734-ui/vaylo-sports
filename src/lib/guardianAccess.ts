// ============================================================================
// GUARDIAN ACCESS — permission keys, age bands and the sanitized read
// ----------------------------------------------------------------------------
// A guardian's access to an athlete's training is a POLICY question, not a UI
// question, and the policy lives in Postgres:
// `supabase/migrations/20261005210000_goal_roadmap_and_guardians.sql`.
//
// Two facts about that migration drive everything here:
//
//   1. GUARDIANS HAVE NO ROW ACCESS TO ATHLETE TABLES. Postgres RLS filters
//      rows, not columns, so a policy that let a guardian read `recovery_logs`
//      would also hand over `hrv`, `sleep_quality`, `rest_hours` and `notes`.
//      Instead there is one SECURITY DEFINER function,
//      `guardian_athlete_overview(athlete)`, which returns only permitted
//      sections and only ever returns already-reduced values — a recovery
//      *band*, never a recovery log.
//
//   2. THE DEFAULT AND CLAMPING RULES ARE DEFINED TWICE, ON PURPOSE. The
//      database needs them at the moment a link is created, when no client is
//      involved; the client needs them to render the settings screen without a
//      round trip. `guardianAccess.test.ts` reads the SQL out of the migration
//      and asserts the two are equal, so they cannot drift.
//
// This module is deliberately pure — no Supabase import — so the parity test
// cannot accidentally depend on a network client.
// ============================================================================

import { ageFromDob } from "./age";

// ---------------------------------------------------------------------------
// Age bands
// ---------------------------------------------------------------------------

export const GUARDIAN_AGE_BANDS = [
  "under_13",
  "age_13_15",
  "age_16_17",
  "adult",
  "unknown",
] as const;

export type GuardianAgeBand = (typeof GUARDIAN_AGE_BANDS)[number];

export const isGuardianAgeBand = (value: unknown): value is GuardianAgeBand =>
  typeof value === "string" && (GUARDIAN_AGE_BANDS as readonly string[]).includes(value);

export const AGE_BAND_LABELS: Record<GuardianAgeBand, string> = {
  under_13: "Under 13",
  age_13_15: "13–15",
  age_16_17: "16–17",
  adult: "18 or over",
  unknown: "Age not recorded",
};

/**
 * The band an athlete falls in.
 *
 * Mirrors the `case` in `redeem_guardian_invite` and `set_guardian_permissions`
 * exactly: an unknown date of birth is `unknown`, and `unknown` is treated the
 * same as a minor for the alert floor.
 */
export function guardianAgeBand(dob: string | null | undefined, at: Date = new Date()): GuardianAgeBand {
  const age = ageFromDob(dob, at);
  if (age === null) return "unknown";
  if (age < 13) return "under_13";
  if (age < 16) return "age_13_15";
  if (age < 18) return "age_16_17";
  return "adult";
}

// ---------------------------------------------------------------------------
// Permission keys
// ---------------------------------------------------------------------------

/**
 * The ten things a guardian can be shown, in the order the settings screen
 * lists them. A key that is absent from a stored map is a key that is FALSE:
 * a permission added in a later phase is off until somebody grants it.
 */
export const PERMISSION_KEYS = [
  "goals",
  "roadmap",
  "consistency",
  "upcoming",
  "completed",
  "recovery",
  "workload",
  "competitions",
  "alerts",
  "coach",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type GuardianPermissions = Record<PermissionKey, boolean>;

export const isPermissionKey = (value: unknown): value is PermissionKey =>
  typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  /** What granting this actually shows. Written so it cannot oversell itself. */
  description: string;
  group: "progress" | "training" | "wellbeing";
}

export const PERMISSION_META: Record<PermissionKey, PermissionMeta> = {
  goals: {
    key: "goals",
    label: "Goals",
    // These descriptions are read by the athlete, who is the person choosing
    // what to share, so they are written in the second person. A guardian's
    // screen does not use them at all.
    description: "The title, category, target date and phase of each goal. Not your own notes about why it matters.",
    group: "progress",
  },
  roadmap: {
    key: "roadmap",
    label: "Development roadmap",
    description: "How many milestones each goal has, how many are done, and the next one coming up.",
    group: "progress",
  },
  consistency: {
    key: "consistency",
    label: "Training consistency",
    description: "Sessions completed against sessions planned over the last four weeks, as a count and a percentage.",
    group: "training",
  },
  upcoming: {
    key: "upcoming",
    label: "Upcoming training",
    description: "What is planned over the next two weeks: the date, the session title and its status.",
    group: "training",
  },
  completed: {
    key: "completed",
    label: "Completed training",
    description: "A summary of the sessions you logged recently. No heart rate, effort rating or personal notes.",
    group: "training",
  },
  recovery: {
    key: "recovery",
    label: "Recovery status",
    description: "A single band — good, moderate or low — from recent check-ins. Never your individual scores.",
    group: "wellbeing",
  },
  workload: {
    key: "workload",
    label: "Workload status",
    description: "Whether the last week's training load is high, moderate or low against your own monthly average.",
    group: "wellbeing",
  },
  competitions: {
    key: "competitions",
    label: "Competition schedule",
    description: "Upcoming and recent competitions: the name, date and sport.",
    group: "training",
  },
  alerts: {
    key: "alerts",
    label: "Safety and recovery alerts",
    description: "Illness, injury, an unusually high workload or a drop in sessions. Cannot be switched off while you are under 18.",
    group: "wellbeing",
  },
  coach: {
    key: "coach",
    label: "Coach",
    description: "Whether a coach is linked to the account. No coach linking exists yet, so this shows nothing today.",
    group: "training",
  },
};

// ---------------------------------------------------------------------------
// Defaults and clamping — the SQL, mirrored
// ---------------------------------------------------------------------------

/**
 * `public.guardian_default_permissions(band)`.
 *
 * Younger athletes start with wider guardian visibility, older teenagers start
 * narrower, and an adult's guardian starts with almost nothing. Note that
 * `unknown` falls through to the adult map in the SQL `case` — and is then
 * given the alert floor by the sanitizer, which is what makes it safe.
 */
export function guardianDefaultPermissions(band: GuardianAgeBand | string | null | undefined): GuardianPermissions {
  switch (band) {
    case "under_13":
    case "age_13_15":
      return {
        goals: true,
        roadmap: true,
        consistency: true,
        upcoming: true,
        completed: true,
        recovery: true,
        workload: true,
        competitions: true,
        alerts: true,
        coach: true,
      };
    case "age_16_17":
      return {
        goals: true,
        roadmap: true,
        consistency: true,
        upcoming: false,
        completed: false,
        recovery: false,
        workload: true,
        competitions: true,
        alerts: true,
        coach: true,
      };
    default:
      // `adult` and anything unrecognised: the narrowest sensible starting
      // point. An adult's data is not a guardian's by default.
      return {
        goals: true,
        roadmap: true,
        consistency: false,
        upcoming: false,
        completed: false,
        recovery: false,
        workload: false,
        competitions: false,
        alerts: false,
        coach: false,
      };
  }
}

/** Bands whose alerts cannot be switched off by anybody. */
export const ALERT_FLOOR_BANDS: readonly GuardianAgeBand[] = [
  "under_13",
  "age_13_15",
  "age_16_17",
  "unknown",
];

/** The band whose guardian must always be able to see whether training happened. */
export const MINOR_VISIBILITY_FLOOR_BANDS: readonly GuardianAgeBand[] = ["under_13"];

/**
 * `public.guardian_sanitize_permissions(requested, band)`.
 *
 * Starts from the band's defaults — so an omitted key keeps its default rather
 * than silently becoming false — applies any known boolean the caller asked
 * for, drops unknown keys, and then re-applies two floors:
 *
 *   • `alerts` is forced on for every minor band. A guardian of a 14-year-old
 *     is entitled to know the load is high.
 *   • a guardian of an under-13 cannot lose `consistency`, `upcoming` or
 *     `completed`. That guardian is answerable for whether the child is
 *     training sensibly.
 */
export function guardianSanitizePermissions(
  requested: unknown,
  band: GuardianAgeBand | string | null | undefined,
): GuardianPermissions {
  const result = guardianDefaultPermissions(band);

  if (requested && typeof requested === "object" && !Array.isArray(requested)) {
    for (const [key, value] of Object.entries(requested as Record<string, unknown>)) {
      if (!isPermissionKey(key)) continue; // unknown key: dropped, stays off
      if (typeof value !== "boolean") continue;
      result[key] = value;
    }
  }

  const normalized: GuardianAgeBand = isGuardianAgeBand(band) ? band : "unknown";
  if (ALERT_FLOOR_BANDS.includes(normalized)) result.alerts = true;
  if (MINOR_VISIBILITY_FLOOR_BANDS.includes(normalized)) {
    result.consistency = true;
    result.upcoming = true;
    result.completed = true;
  }
  return result;
}

/** The permissions that a given band cannot switch off, for the settings UI. */
export function lockedPermissions(band: GuardianAgeBand | string | null | undefined): Set<PermissionKey> {
  const normalized: GuardianAgeBand = isGuardianAgeBand(band) ? band : "unknown";
  const locked = new Set<PermissionKey>();
  if (ALERT_FLOOR_BANDS.includes(normalized)) locked.add("alerts");
  if (MINOR_VISIBILITY_FLOOR_BANDS.includes(normalized)) {
    locked.add("consistency");
    locked.add("upcoming");
    locked.add("completed");
  }
  return locked;
}

/** True when the caller's request survives the clamp untouched. */
export function permissionsAreClamped(
  requested: unknown,
  band: GuardianAgeBand | string | null | undefined,
): boolean {
  const safe = guardianSanitizePermissions(requested, band);
  if (!requested || typeof requested !== "object") return false;
  for (const [key, value] of Object.entries(requested as Record<string, unknown>)) {
    if (!isPermissionKey(key) || typeof value !== "boolean") return true; // dropped
    if (safe[key] !== value) return true; // forced back
  }
  return false;
}

/** Every granted key, in listing order. */
export function grantedPermissions(permissions: Partial<GuardianPermissions> | null | undefined): PermissionKey[] {
  if (!permissions) return [];
  return PERMISSION_KEYS.filter((key) => permissions[key] === true);
}

/**
 * Read a stored `permissions` map defensively.
 *
 * An absent key is false, and anything that is not a boolean is false: the map
 * comes out of a JSONB column and a hand-edited `"true"` string must not read as
 * consent.
 */
export function readPermissions(value: unknown): GuardianPermissions {
  const out = {} as GuardianPermissions;
  for (const key of PERMISSION_KEYS) out[key] = false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of PERMISSION_KEYS) {
    if ((value as Record<string, unknown>)[key] === true) out[key] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links and invites
// ---------------------------------------------------------------------------

export const GUARDIAN_LINK_STATUSES = ["pending", "active", "revoked"] as const;
export type GuardianLinkStatus = (typeof GUARDIAN_LINK_STATUSES)[number];

export interface GuardianLinkStatusMeta {
  label: string;
  description: string;
  tone: "info" | "positive" | "watch";
}

export const GUARDIAN_LINK_STATUS_META: Record<GuardianLinkStatus, GuardianLinkStatusMeta> = {
  pending: {
    label: "Awaiting approval",
    description: "This guardian has the code but cannot see anything until it is approved.",
    tone: "info",
  },
  active: {
    label: "Active",
    description: "This guardian can see the sections ticked below, and nothing else.",
    tone: "positive",
  },
  revoked: {
    label: "Switched off",
    description: "Access has been removed. The link is kept on record rather than deleted.",
    tone: "watch",
  },
};

export const GUARDIAN_RELATIONSHIPS = ["parent", "guardian", "carer", "sibling", "other"] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  parent: "Parent",
  guardian: "Legal guardian",
  carer: "Carer",
  sibling: "Sibling",
  other: "Other",
};

export interface GuardianLink {
  id: string;
  guardian_user_id: string;
  athlete_user_id: string;
  relationship: string;
  status: string;
  permissions: GuardianPermissions;
  defaults_band: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  approved_at?: string | null;
  revoked_at?: string | null;
}

/**
 * Coerce a `guardian_links` row, whether it came from PostgREST or a cache.
 * Anything unrecognised in `status`/`relationship` degrades to the safe value
 * rather than propagating a string the UI has no words for.
 */
export function parseGuardianLink(row: unknown): GuardianLink | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const guardian = typeof r.guardian_user_id === "string" ? r.guardian_user_id : null;
  const athlete = typeof r.athlete_user_id === "string" ? r.athlete_user_id : null;
  if (!id || !guardian || !athlete) return null;
  const status = (GUARDIAN_LINK_STATUSES as readonly string[]).includes(r.status as string)
    ? (r.status as GuardianLinkStatus)
    : "pending";
  const relationship = (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(r.relationship as string)
    ? (r.relationship as GuardianRelationship)
    : "other";
  return {
    id,
    guardian_user_id: guardian,
    athlete_user_id: athlete,
    relationship,
    status,
    permissions: readPermissions(r.permissions),
    defaults_band: typeof r.defaults_band === "string" ? r.defaults_band : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
    approved_at: typeof r.approved_at === "string" ? r.approved_at : null,
    revoked_at: typeof r.revoked_at === "string" ? r.revoked_at : null,
  };
}

/** The alphabet `create_guardian_invite()` generates from, with no look-alikes. */
export const GUARDIAN_INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GUARDIAN_INVITE_LENGTH = 8;

/**
 * Normalize a typed code.
 *
 * People read these out loud and type them with spaces, hyphens and lowercase,
 * and none of that changes which code they meant. Characters that are not in
 * the alphabet are dropped rather than rejected, so a stray `I` typed for a `1`
 * does not become a mystery failure — the code simply will not match, which is
 * the same outcome, reached politely.
 */
export function normalizeGuardianCode(input: string | null | undefined): string {
  if (typeof input !== "string") return "";
  return [...input.toUpperCase()]
    .filter((c) => GUARDIAN_INVITE_ALPHABET.includes(c))
    .join("")
    .slice(0, GUARDIAN_INVITE_LENGTH);
}

export const isValidGuardianCodeShape = (code: string): boolean =>
  code.length === GUARDIAN_INVITE_LENGTH && [...code].every((c) => GUARDIAN_INVITE_ALPHABET.includes(c));

/** Group a code for display: `ABCD2345` → `ABCD 2345`. */
export const formatGuardianCode = (code: string): string =>
  code.length === GUARDIAN_INVITE_LENGTH ? `${code.slice(0, 4)} ${code.slice(4)}` : code;

/** Invites last seven days in the SQL; the client says the same thing. */
export const GUARDIAN_INVITE_TTL_DAYS = 7;

/** Days until an ISO expiry, or null when the value cannot be read. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof iso !== "string" || !iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - now.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// The sanitized overview
// ---------------------------------------------------------------------------

export interface GuardianConsistencySection {
  completed: number;
  planned: number;
  percent: number | null;
  windowDays: number;
}

export interface GuardianSessionSummary {
  date: string;
  title: string;
  status: string;
}

export interface GuardianRecoverySection {
  band: "good" | "moderate" | "low" | "unknown";
  hasRecentLogs: boolean;
}

export interface GuardianWorkloadSection {
  band: "high" | "moderate" | "low" | "unknown";
}

export interface GuardianGoalSummary {
  title: string;
  category: string | null;
  targetDate: string | null;
  phase: string | null;
  progressStatus: string | null;
  status: string | null;
}

export interface GuardianRoadmapSummary {
  title: string;
  phase: string | null;
  progressStatus: string | null;
  milestonesTotal: number;
  milestonesAchieved: number;
  nextMilestone: string | null;
}

export interface GuardianCompetitionSummary {
  title: string;
  date: string;
  sport: string | null;
}

export interface GuardianAlert {
  kind: "medical_break" | "consistency";
  eventType?: string;
  endedOn?: string;
  text: string;
}

export interface GuardianCoachSection {
  linked: boolean;
  name: string | null;
}

export interface GuardianAthlete {
  name: string;
  sports: string;
  ageBand: GuardianAgeBand;
  isMinor: boolean;
}

export interface GuardianAthleteOverview {
  ok: true;
  athlete: GuardianAthlete;
  permissions: GuardianPermissions;
  consistency?: GuardianConsistencySection;
  upcoming?: GuardianSessionSummary[];
  completedRecent?: GuardianSessionSummary[];
  recovery?: GuardianRecoverySection;
  workload?: GuardianWorkloadSection;
  goals?: GuardianGoalSummary[];
  roadmap?: GuardianRoadmapSummary[];
  competitions?: GuardianCompetitionSummary[];
  alerts?: GuardianAlert[];
  coach?: GuardianCoachSection;
}

export type GuardianOverviewResult =
  | GuardianAthleteOverview
  /** No active link. Deliberately not an error: see `guardian_athlete_overview`. */
  | { ok: false; reason: string };

export const NO_ACCESS: GuardianOverviewResult = { ok: false, reason: "no_access" };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asText = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/**
 * A calendar day from a date or a timestamp.
 *
 * `events.event_date` is a timestamptz, so it arrives as
 * `2026-10-16T00:00:00+00:00`. Slicing the day off is correct for a stored-at-
 * midnight date, and this is where that happens exactly once.
 */
const asDay = (value: unknown): string => {
  const text = asText(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
};

const asNullableNumber = (value: unknown): number | null => {
  // `Number(null)` is 0 and `Number("")` is 0, and both would turn "no data"
  // into a confident zero — the same trap the recovery read had to avoid.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asCount = (value: unknown): number => asNullableNumber(value) ?? 0;

/**
 * Parse whatever `guardian_athlete_overview()` returned.
 *
 * This runs on every render, so it is total: it never throws, and any section
 * that is absent, of the wrong type or not permitted is simply not there. A
 * guardian's screen must not break because a numeric column came back as a
 * string, and it must never render a section it was not granted.
 */
export function parseGuardianOverview(raw: unknown): GuardianOverviewResult {
  const root = asRecord(raw);
  if (!root) return { ok: false, reason: "no_access" };
  if (root.ok !== true) return { ok: false, reason: asText(root.reason, "no_access") };

  const athleteRecord = asRecord(root.athlete) ?? {};
  const band = isGuardianAgeBand(athleteRecord.ageBand) ? athleteRecord.ageBand : "unknown";
  const permissions = readPermissions(root.permissions);

  const result: GuardianAthleteOverview = {
    ok: true,
    athlete: {
      name: asText(athleteRecord.name, "Your athlete"),
      sports: asText(athleteRecord.sports, ""),
      ageBand: band,
      isMinor: athleteRecord.isMinor === true,
    },
    permissions,
  };

  const consistency = asRecord(root.consistency);
  if (consistency && permissions.consistency) {
    result.consistency = {
      completed: asCount(consistency.completed),
      planned: asCount(consistency.planned),
      percent: asNullableNumber(consistency.percent),
      windowDays: asCount(consistency.windowDays) || 28,
    };
  }

  const sessions = (value: unknown): GuardianSessionSummary[] =>
    asArray(value)
      .map((entry) => {
        const row = asRecord(entry);
        if (!row) return null;
        const date = asText(row.date);
        if (!date) return null;
        return { date, title: asText(row.title, "Session"), status: asText(row.status, "planned") };
      })
      .filter(Boolean) as GuardianSessionSummary[];

  if (permissions.upcoming) result.upcoming = sessions(root.upcoming);
  if (permissions.completed) result.completedRecent = sessions(root.completedRecent);

  const recovery = asRecord(root.recovery);
  if (recovery && permissions.recovery) {
    const value = asText(recovery.band, "unknown");
    result.recovery = {
      band: value === "good" || value === "moderate" || value === "low" ? value : "unknown",
      hasRecentLogs: recovery.hasRecentLogs === true,
    };
  }

  const workload = asRecord(root.workload);
  if (workload && permissions.workload) {
    const value = asText(workload.band, "unknown");
    result.workload = {
      band: value === "high" || value === "moderate" || value === "low" ? value : "unknown",
    };
  }

  if (permissions.goals) {
    result.goals = asArray(root.goals)
      .map((entry) => {
        const row = asRecord(entry);
        if (!row) return null;
        const title = asText(row.title);
        if (!title) return null;
        return {
          title,
          category: asText(row.category) || null,
          targetDate: asText(row.targetDate) || null,
          phase: asText(row.phase) || null,
          progressStatus: asText(row.progressStatus) || null,
          status: asText(row.status) || null,
        };
      })
      .filter(Boolean) as GuardianGoalSummary[];
  }

  if (permissions.roadmap) {
    result.roadmap = asArray(root.roadmap)
      .map((entry) => {
        const row = asRecord(entry);
        if (!row) return null;
        const title = asText(row.title);
        if (!title) return null;
        return {
          title,
          phase: asText(row.phase) || null,
          progressStatus: asText(row.progressStatus) || null,
          milestonesTotal: asCount(row.milestonesTotal),
          milestonesAchieved: asCount(row.milestonesAchieved),
          nextMilestone: asText(row.nextMilestone) || null,
        };
      })
      .filter(Boolean) as GuardianRoadmapSummary[];
  }

  if (permissions.competitions) {
    result.competitions = asArray(root.competitions)
      .map((entry) => {
        const row = asRecord(entry);
        if (!row) return null;
        // `events.event_date` is a timestamptz, so the raw value is a full ISO
        // timestamp. A guardian gets the calendar day, which is the only part
        // that means anything given the value is stored at midnight UTC.
        const date = asDay(row.date);
        if (!date) return null;
        return { title: asText(row.title, "Competition"), date, sport: asText(row.sport) || null };
      })
      .filter(Boolean) as GuardianCompetitionSummary[];
  }

  if (permissions.alerts) {
    result.alerts = asArray(root.alerts)
      .map((entry) => {
        const row = asRecord(entry);
        if (!row) return null;
        const text = asText(row.text);
        if (!text) return null;
        const kind = row.kind === "medical_break" ? "medical_break" : "consistency";
        const alert: GuardianAlert = { kind, text };
        if (asText(row.eventType)) alert.eventType = asText(row.eventType);
        if (asText(row.endedOn)) alert.endedOn = asText(row.endedOn);
        return alert;
      })
      .filter(Boolean) as GuardianAlert[];
  }

  const coach = asRecord(root.coach);
  if (coach && permissions.coach) {
    result.coach = { linked: coach.linked === true, name: asText(coach.name) || null };
  }

  return result;
}

/** True when there is nothing at all to show beyond the athlete's name. */
export function overviewIsEmpty(overview: GuardianAthleteOverview): boolean {
  const keys: (keyof GuardianAthleteOverview)[] = [
    "consistency",
    "upcoming",
    "completedRecent",
    "recovery",
    "workload",
    "goals",
    "roadmap",
    "competitions",
    "alerts",
    "coach",
  ];
  return keys.every((key) => {
    const value = overview[key];
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  });
}

export const RECOVERY_BAND_LABELS: Record<GuardianRecoverySection["band"], string> = {
  good: "Good",
  moderate: "Moderate",
  low: "Low",
  unknown: "Not enough data",
};

export const WORKLOAD_BAND_LABELS: Record<GuardianWorkloadSection["band"], string> = {
  high: "Higher than usual",
  moderate: "About usual",
  low: "Lower than usual",
  unknown: "Not enough data",
};

/**
 * The sentence a guardian sees under the overview. It is deliberately about the
 * app's limits rather than the athlete's performance: a guardian cannot read
 * raw logs, and saying so is more useful than pretending the summary is whole.
 */
export const GUARDIAN_SUMMARY_NOTE =
  "This is a summary, not a training log. You can see general status and the shape of the plan, not individual session data, recovery scores or personal notes.";
