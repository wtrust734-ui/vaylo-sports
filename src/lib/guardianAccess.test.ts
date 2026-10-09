import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGE_BAND_LABELS,
  ALERT_FLOOR_BANDS,
  GUARDIAN_AGE_BANDS,
  GUARDIAN_INVITE_ALPHABET,
  GUARDIAN_LINK_STATUS_META,
  GUARDIAN_RELATIONSHIPS,
  MINOR_VISIBILITY_FLOOR_BANDS,
  NO_ACCESS,
  PERMISSION_KEYS,
  PERMISSION_META,
  daysUntil,
  formatGuardianCode,
  grantedPermissions,
  guardianAgeBand,
  guardianDefaultPermissions,
  guardianSanitizePermissions,
  isPermissionKey,
  isValidGuardianCodeShape,
  lockedPermissions,
  normalizeGuardianCode,
  overviewIsEmpty,
  parseGuardianLink,
  parseGuardianOverview,
  permissionsAreClamped,
  readPermissions,
  type GuardianPermissions,
} from "@/lib/guardianAccess";

// ---------------------------------------------------------------------------
// SQL ↔ CLIENT PARITY
// ---------------------------------------------------------------------------
// The permission maps are defined in the migration as well as here, because the
// database needs them at the moment a link is created and the client needs them
// to render settings without a round trip. Two definitions of one policy is
// exactly the shape of bug that ends with a guardian seeing something the
// athlete switched off, so the SQL is read back and compared key by key.

const ROOT = resolve(__dirname, "../..");
const SQL = readFileSync(
  resolve(ROOT, "supabase/migrations/20261005210000_goal_roadmap_and_guardians.sql"),
  "utf8",
).replace(/\r\n?/g, "\n");

/** The body of one `create or replace function public.<name>(`. */
function fnBody(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is not in the migration`).toBeGreaterThan(-1);
  const end = SQL.indexOf("\n$$;", start);
  return SQL.slice(start, end === -1 ? undefined : end);
}

/** `'key', true, 'key', false …` → a permission record. */
function parsePairs(body: string): GuardianPermissions {
  const out = {} as GuardianPermissions;
  for (const match of body.matchAll(/'([a-z_]+)',\s*(true|false)/g)) {
    if (isPermissionKey(match[1])) out[match[1]] = match[2] === "true";
  }
  return out;
}

describe("the permission maps match the database", () => {
  const defaults = fnBody("guardian_default_permissions");

  it("declares exactly the ten permission keys the SQL allows", () => {
    const allowed = /v_allowed constant text\[\] := array\[([\s\S]*?)\]/.exec(
      fnBody("guardian_sanitize_permissions"),
    );
    expect(allowed, "v_allowed is not in guardian_sanitize_permissions").toBeTruthy();
    const sqlKeys = [...allowed![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlKeys).toEqual([...PERMISSION_KEYS]);
  });

  it("gives every permission a label and a description", () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_META[key].label.length, `${key} has no label`).toBeGreaterThan(1);
      expect(PERMISSION_META[key].description.length, `${key} has no description`).toBeGreaterThan(20);
      expect(PERMISSION_META[key].key).toBe(key);
    }
  });

  it("mirrors guardian_default_permissions for every band", () => {
    // The SQL `case` has an `else`, so `adult` and anything unrecognised take it.
    for (const band of ["under_13", "age_13_15", "age_16_17"] as const) {
      const block = new RegExp(`when '${band}' then jsonb_build_object\\(([^)]*)\\)`).exec(defaults);
      expect(block, `${band} is not in guardian_default_permissions`).toBeTruthy();
      expect(guardianDefaultPermissions(band)).toEqual(parsePairs(block![1]));
    }
    const fallback = /else jsonb_build_object\(([^)]*)\)/.exec(defaults);
    expect(fallback, "guardian_default_permissions has no else branch").toBeTruthy();
    const expected = parsePairs(fallback![1]);
    expect(guardianDefaultPermissions("adult")).toEqual(expected);
    expect(guardianDefaultPermissions("unknown")).toEqual(expected);
    expect(guardianDefaultPermissions(null)).toEqual(expected);
  });

  it("mirrors the alert floor from guardian_sanitize_permissions", () => {
    const body = fnBody("guardian_sanitize_permissions");
    const floor = /if p_band in \(([^)]*)\)/.exec(body);
    expect(floor, "the alert floor is not in guardian_sanitize_permissions").toBeTruthy();
    const sqlBands = [...floor![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(sqlBands).toEqual([...ALERT_FLOOR_BANDS]);
  });

  it("mirrors the under-13 visibility floor", () => {
    const body = fnBody("guardian_sanitize_permissions");
    const start = body.indexOf("if p_band = 'under_13' then");
    expect(start, "the under-13 floor is not in guardian_sanitize_permissions").toBeGreaterThan(-1);
    const block = body.slice(start, body.indexOf("end if;", start));
    expect([...MINOR_VISIBILITY_FLOOR_BANDS]).toEqual(["under_13"]);
    for (const key of ["consistency", "upcoming", "completed"]) {
      expect(block, `the under-13 floor does not force ${key}`).toContain(`array['${key}'], 'true'`);
    }
    // And nothing else is forced, so a 12-year-old can still hide their
    // recovery band if the guardian agrees.
    expect(block).not.toContain("array['recovery']");
    expect(block).not.toContain("array['workload']");
    expect(block).not.toContain("array['goals']");
  });

  it("keeps the client's sanitizer consistent with the SQL one, case by case", () => {
    const cases: { band: string; requested: Record<string, boolean | string | number> }[] = [
      { band: "under_13", requested: { alerts: false } },
      { band: "under_13", requested: { completed: false, recovery: false } },
      { band: "age_13_15", requested: { alerts: false, upcoming: false } },
      { band: "age_16_17", requested: { upcoming: true, recovery: true, alerts: false } },
      { band: "adult", requested: { goals: false, roadmap: false } },
      { band: "unknown", requested: { alerts: false } },
      { band: "age_13_15", requested: { bogus_key: true } },
    ];
    for (const { band, requested } of cases) {
      const safe = guardianSanitizePermissions(requested, band);
      // Every floor the SQL applies, applied here too — asserted by rule rather
      // than by a second copy of the expected output.
      if (ALERT_FLOOR_BANDS.includes(band as never)) {
        expect(safe.alerts, `${band} must keep alerts on`).toBe(true);
      }
      if (band === "under_13") {
        expect(safe.consistency).toBe(true);
        expect(safe.upcoming).toBe(true);
        expect(safe.completed).toBe(true);
      }
      for (const key of PERMISSION_KEYS) {
        expect(typeof safe[key], `${band}.${key} is not a boolean`).toBe("boolean");
      }
      expect(Object.keys(safe).sort()).toEqual([...PERMISSION_KEYS].sort());
    }
  });
});

// ---------------------------------------------------------------------------
// Spec case 6 — age-based defaults and permissions
// ---------------------------------------------------------------------------

describe("guardian permissions", () => {
  it("gives wider defaults to a younger athlete and narrower to a teenager", () => {
    const young = guardianDefaultPermissions("under_13");
    const mid = guardianDefaultPermissions("age_13_15");
    const teen = guardianDefaultPermissions("age_16_17");
    const adult = guardianDefaultPermissions("adult");

    expect(young).toEqual(mid);
    expect(teen.upcoming).toBe(false);
    expect(teen.completed).toBe(false);
    expect(teen.recovery).toBe(false);
    // The alert floor is the one thing that never narrows by age.
    expect(teen.alerts).toBe(true);

    const count = (p: GuardianPermissions) => grantedPermissions(p).length;
    expect(count(young)).toBeGreaterThan(count(teen));
    expect(count(teen)).toBeGreaterThan(count(adult));
    // An adult's guardian gets goals and the roadmap, and nothing personal.
    expect(grantedPermissions(adult)).toEqual(["goals", "roadmap"]);
  });

  it("bands an athlete by date of birth, and treats an unknown one as unknown", () => {
    const at = new Date("2026-10-06T12:00:00");
    expect(guardianAgeBand("2015-01-01", at)).toBe("under_13");
    expect(guardianAgeBand("2012-06-01", at)).toBe("age_13_15");
    expect(guardianAgeBand("2009-06-01", at)).toBe("age_16_17");
    expect(guardianAgeBand("2000-06-01", at)).toBe("adult");
    expect(guardianAgeBand(null, at)).toBe("unknown");
    expect(guardianAgeBand("not-a-date", at)).toBe("unknown");
    // A 12-year-old who turns 13 tomorrow is 12 today, not 13.
    expect(guardianAgeBand("2013-10-07", at)).toBe("under_13");
    expect(guardianAgeBand("2013-10-06", at)).toBe("age_13_15");
  });

  it("cannot be talked out of the alert floor", () => {
    for (const band of GUARDIAN_AGE_BANDS.filter((b) => b !== "adult")) {
      expect(guardianSanitizePermissions({ alerts: false }, band).alerts).toBe(true);
      expect(lockedPermissions(band).has("alerts")).toBe(true);
    }
    // An adult's guardian may hold alerts off — there is no minor to protect.
    expect(guardianSanitizePermissions({ alerts: false }, "adult").alerts).toBe(false);
    expect(lockedPermissions("adult").size).toBe(0);
  });

  it("keeps the under-13 visibility floor and reports that it did", () => {
    const requested = { consistency: false, upcoming: false, completed: false, recovery: false };
    const safe = guardianSanitizePermissions(requested, "under_13");
    expect([safe.consistency, safe.upcoming, safe.completed]).toEqual([true, true, true]);
    // Recovery may be hidden — the floor is about training, not wellbeing.
    expect(safe.recovery).toBe(false);
    expect(permissionsAreClamped(requested, "under_13")).toBe(true);
    // A request that survives untouched is not reported as clamped.
    expect(permissionsAreClamped({ recovery: false }, "under_13")).toBe(false);
  });

  it("keeps every label written down for every band and status", () => {
    for (const band of GUARDIAN_AGE_BANDS) expect(AGE_BAND_LABELS[band].length).toBeGreaterThan(2);
    for (const status of ["pending", "active", "revoked"] as const) {
      expect(GUARDIAN_LINK_STATUS_META[status].label.length).toBeGreaterThan(2);
      expect(GUARDIAN_LINK_STATUS_META[status].description.length).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Spec case 7 — clamping is a floor, not a suggestion
// ---------------------------------------------------------------------------

describe("requested permissions", () => {
  it("starts from the band's defaults, so an omitted key keeps its default", () => {
    expect(guardianSanitizePermissions({}, "age_13_15")).toEqual(guardianDefaultPermissions("age_13_15"));
    expect(guardianSanitizePermissions(null, "age_13_15")).toEqual(guardianDefaultPermissions("age_13_15"));
  });

  it("drops unknown keys and non-boolean values", () => {
    const safe = guardianSanitizePermissions(
      { teleportation: true, goals: "yes", roadmap: 1, recovery: true },
      "age_13_15",
    );
    expect(Object.keys(safe).sort()).toEqual([...PERMISSION_KEYS].sort());
    // "yes" is not consent.
    expect(safe.goals).toBe(true); // the age_13_15 default, not the string
    expect(safe.roadmap).toBe(true);
    expect(safe.recovery).toBe(true);
  });

  it("treats anything that is not literally true as not granted when reading storage", () => {
    expect(readPermissions({ recovery: "true", workload: 1, goals: true })).toEqual({
      goals: true,
      roadmap: false,
      consistency: false,
      upcoming: false,
      completed: false,
      recovery: false,
      workload: false,
      competitions: false,
      alerts: false,
      coach: false,
    });
    expect(grantedPermissions(readPermissions(null))).toEqual([]);
    expect(grantedPermissions(readPermissions("nope"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Spec case 8 — the sanitized read shows only what was granted
// ---------------------------------------------------------------------------

const athlete = { name: "Sam", sports: "Running", ageBand: "age_13_15", isMinor: true };

const fullPayload = {
  ok: true,
  athlete,
  permissions: guardianDefaultPermissions("age_13_15"),
  consistency: { completed: 9, planned: 12, percent: 75, windowDays: 28 },
  upcoming: [{ date: "2026-10-08", title: "Tempo run", status: "planned" }],
  completedRecent: [{ date: "2026-10-05", title: "Easy run", status: "completed" }],
  recovery: { band: "low", hasRecentLogs: true },
  workload: { band: "high" },
  goals: [
    { title: "Sub-18 5K", category: "performance", targetDate: "2026-12-31", phase: "build", progressStatus: "on_track", status: "active", description: "private words" },
  ],
  roadmap: [
    { title: "Sub-18 5K", phase: "build", progressStatus: "on_track", milestonesTotal: 4, milestonesAchieved: 2, nextMilestone: "Reach 1110 sec" },
  ],
  competitions: [{ title: "County Champs", date: "2026-10-15", sport: "Running" }],
  alerts: [{ kind: "medical_break", eventType: "illness", endedOn: "2026-10-04", text: "A break was recorded." }],
  coach: { linked: false, name: null },
};

describe("the guardian overview is sanitized on the way in", () => {
  it("reads a fully permitted payload", () => {
    const parsed = parseGuardianOverview(fullPayload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok !== true) throw new Error("expected ok");
    expect(parsed.athlete.name).toBe("Sam");
    expect(parsed.athlete.isMinor).toBe(true);
    expect(parsed.consistency).toEqual({ completed: 9, planned: 12, percent: 75, windowDays: 28 });
    expect(parsed.upcoming?.length).toBe(1);
    expect(parsed.recovery).toEqual({ band: "low", hasRecentLogs: true });
    expect(parsed.workload).toEqual({ band: "high" });
    expect(parsed.goals?.[0].title).toBe("Sub-18 5K");
    expect(parsed.roadmap?.[0].nextMilestone).toBe("Reach 1110 sec");
    expect(parsed.competitions?.[0].title).toBe("County Champs");
    expect(parsed.competitions?.[0].date).toBe("2026-10-15");
    expect(parsed.alerts?.[0].kind).toBe("medical_break");
    expect(parsed.coach).toEqual({ linked: false, name: null });
    expect(overviewIsEmpty(parsed)).toBe(false);
  });

  it("drops any section the permissions do not cover, even when it was sent", () => {
    const parsed = parseGuardianOverview({
      ...fullPayload,
      permissions: { goals: true, roadmap: true, alerts: true },
    });
    if (parsed.ok !== true) throw new Error("expected ok");
    expect(parsed.consistency).toBeUndefined();
    expect(parsed.upcoming).toBeUndefined();
    expect(parsed.completedRecent).toBeUndefined();
    expect(parsed.recovery).toBeUndefined();
    expect(parsed.workload).toBeUndefined();
    expect(parsed.competitions).toBeUndefined();
    expect(parsed.coach).toBeUndefined();
    expect(parsed.goals?.length).toBe(1);
    expect(parsed.alerts?.length).toBe(1);
  });

  it("never carries an athlete's own words about a goal", () => {
    const parsed = parseGuardianOverview(fullPayload);
    if (parsed.ok !== true) throw new Error("expected ok");
    expect(JSON.stringify(parsed)).not.toContain("private words");
    expect(JSON.stringify(parsed)).not.toContain("description");
  });

  it("reports no access as a fact rather than an error", () => {
    expect(parseGuardianOverview({ ok: false, reason: "no_access" })).toEqual(NO_ACCESS);
    expect(parseGuardianOverview(null)).toEqual(NO_ACCESS);
    expect(parseGuardianOverview(undefined)).toEqual(NO_ACCESS);
    expect(parseGuardianOverview({ ok: false, reason: "something_else" })).toEqual({
      ok: false,
      reason: "something_else",
    });
    expect(permissionsAreClamped({}, "adult")).toBe(false);
  });

  it("survives a payload whose numbers arrived as strings, and never invents a zero", () => {
    const parsed = parseGuardianOverview({
      ...fullPayload,
      consistency: { completed: "9", planned: "12", percent: null, windowDays: "28" },
      athlete: { ...athlete, ageBand: "bogus", isMinor: "yes" },
    });
    if (parsed.ok !== true) throw new Error("expected ok");
    expect(parsed.consistency).toEqual({ completed: 9, planned: 12, percent: null, windowDays: 28 });
    // An unrecognised band degrades to `unknown` rather than rendering nothing.
    expect(parsed.athlete.ageBand).toBe("unknown");
    // `"yes"` is not `true`.
    expect(parsed.athlete.isMinor).toBe(false);
  });

  it("reduces a competition timestamp to its calendar day", () => {
    // `events.event_date` is a timestamptz, so the raw value is a full ISO
    // timestamp — which must never reach the screen as one.
    const parsed = parseGuardianOverview({
      ...fullPayload,
      competitions: [{ title: "County Champs", date: "2026-10-15T00:00:00+00:00", sport: "Running" }],
    });
    if (parsed.ok !== true) throw new Error("expected ok");
    expect(parsed.competitions?.[0].date).toBe("2026-10-15");
    expect(JSON.stringify(parsed)).not.toContain("T00:00:00");
  });

  it("ignores malformed rows inside a section instead of rendering them", () => {
    const parsed = parseGuardianOverview({
      ...fullPayload,
      upcoming: [{ title: "no date" }, null, "nope", { date: "2026-10-08", title: "Tempo run" }],
    });
    if (parsed.ok !== true) throw new Error("expected ok");
    expect(parsed.upcoming?.length).toBe(1);
    expect(parsed.upcoming?.[0].status).toBe("planned");
  });
});

describe("guardian links and invite codes", () => {
  it("parses a link row defensively", () => {
    const link = parseGuardianLink({
      id: "l1",
      guardian_user_id: "g1",
      athlete_user_id: "a1",
      relationship: "parent",
      status: "active",
      permissions: { goals: true },
      defaults_band: "age_13_15",
    });
    expect(link?.status).toBe("active");
    expect(link?.relationship).toBe("parent");
    expect(link?.permissions.goals).toBe(true);
    expect(link?.permissions.recovery).toBe(false);

    // Unknown status/relationship degrade rather than propagating a word the UI
    // has no copy for.
    const odd = parseGuardianLink({
      id: "l2",
      guardian_user_id: "g1",
      athlete_user_id: "a1",
      relationship: "second-cousin",
      status: "maybe",
    });
    expect(odd?.status).toBe("pending");
    expect(odd?.relationship).toBe("other");
    for (const r of GUARDIAN_RELATIONSHIPS) expect(typeof r).toBe("string");

    expect(parseGuardianLink(null)).toBeNull();
    expect(parseGuardianLink({ id: "l3" })).toBeNull();
  });

  it("normalizes and validates a typed invite code", () => {
    expect(normalizeGuardianCode("abcd 2345")).toBe("ABCD2345");
    expect(normalizeGuardianCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeGuardianCode("  abcd2345  ")).toBe("ABCD2345");
    // Look-alike characters are not in the alphabet, so they are dropped.
    expect(normalizeGuardianCode("ABCD234I")).toBe("ABCD234");
    expect(isValidGuardianCodeShape("ABCD2345")).toBe(true);
    expect(isValidGuardianCodeShape("ABCD234")).toBe(false);
    expect(normalizeGuardianCode("I").length).toBe(0);
    expect(normalizeGuardianCode(null)).toBe("");
    expect(formatGuardianCode("ABCD2345")).toBe("ABCD 2345");
    // Nothing in the generated alphabet is a character people misread.
    for (const bad of ["I", "L", "O", "0", "1"]) {
      expect(GUARDIAN_INVITE_ALPHABET.includes(bad), `${bad} is ambiguous`).toBe(false);
    }
    expect(daysUntil(new Date(Date.now() + 2 * 86_400_000).toISOString())).toBe(2);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("nonsense")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec case 9 — the coach half has nothing to link
// ---------------------------------------------------------------------------

describe("the overview is honest about what does not exist", () => {
  it("reports no coach rather than inventing one", () => {
    const body = fnBody("guardian_athlete_overview");
    expect(body).toContain("jsonb_build_object('linked', false, 'name', null)");
    // And the section is only returned when its permission is granted.
    expect(body).toContain("coalesce((v_perms ->> 'coach')::boolean, false)");
  });

  it("filters life events to illness and injury so a private break is never named", () => {
    const body = fnBody("guardian_athlete_overview");
    expect(body).toContain("e.event_type in ('illness', 'injury')");
    // The other nine types must not appear in the alerts read at all.
    for (const type of ["wellbeing", "private", "exams", "holiday", "travel", "busy", "family", "other"]) {
      expect(body, `${type} is named in the alert query`).not.toContain(`'${type}'`);
    }
  });

  it("returns no_access instead of an error when there is no active link", () => {
    const body = fnBody("guardian_athlete_overview");
    expect(body).toContain("jsonb_build_object('ok', false, 'reason', 'no_access')");
    expect(body).toContain("and l.status = 'active'");
  });
});
