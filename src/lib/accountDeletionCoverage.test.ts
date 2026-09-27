import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Account deletion has two failure modes that are invisible at runtime, and both
// of them shipped:
//
//   1. A table that holds the athlete's rows is missing from the delete list, so
//      their data survives deletion. (`event_pack_ownership`, `fair_usage_events`
//      and `learning_feedback` were all missing, as were the newer sharing tables.)
//   2. A table is deleted by a column it does not have — `challenges` and
//      `marketplace_listings` are keyed by `creator_id`, `team_assignments` by
//      `assigned_to` — so the delete errored, the error was logged and ignored,
//      and the function still answered `success: true`.
//
// This test reads the generated schema types as the source of truth and checks
// both directions, so adding a user-keyed table without updating deletion — or
// renaming a column — fails the build instead of leaking data.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../..");
const TYPES = readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8");
const DELETE_FN = readFileSync(resolve(ROOT, "supabase/functions/delete-account/index.ts"), "utf8");

/** Columns that identify an athlete's ownership of a row. */
const USER_KEY = /^(user_id|owner_id|creator_id|coach_id|assigned_to|assigned_by|from_user_id|to_user_id|friend_id|referrer_id|referee_id|athlete_id|requester_id|recipient_id|player_id)$/;

/**
 * Tables keyed to a user that must NOT be deleted, with the reason. Anything
 * that has a user-identifying column and is not listed here must be handled.
 */
const INTENTIONALLY_EXCLUDED: Record<string, string> = {
  // Anonymous by design: keeps only a salted hash of the user id, no personal
  // data, and is the audit record of the deletion itself.
  account_deletion_events: "anonymous hashed audit trail",
};

/**
 * Parses the generated types into { table: [columns] } for tables only.
 *
 * Anchored on the `public:` schema block: the file also contains a
 * `graphql_public` schema whose Tables/Views blocks are empty, and matching the
 * first `Tables: {` in the file silently yields zero tables.
 */
function parseSchemaTables(src: string): Map<string, string[]> {
  const lines = src.split("\n");
  const publicSchema = lines.findIndex((l) => /^ {2}public: \{$/.test(l));
  expect(publicSchema).toBeGreaterThan(-1);
  const start = lines.findIndex((l, i) => i > publicSchema && /^ {4}Tables: \{$/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^ {4}Views: \{$/.test(l));
  const scope = lines.slice(start, end === -1 ? undefined : end);

  const tables = new Map<string, string[]>();
  let current: string | null = null;
  let inRow = false;

  for (const line of scope) {
    const table = line.match(/^ {6}([a-z0-9_]+): \{$/);
    if (table) { current = table[1]; tables.set(current, []); inRow = false; continue; }

    if (current && /^ {8}Row: \{$/.test(line)) { inRow = true; continue; }
    if (inRow) {
      if (/^ {8}\}$/.test(line)) { inRow = false; continue; }
      const col = line.match(/^ {10}([a-z0-9_]+)(\??):/);
      if (col) tables.get(current)!.push(col[1]);
    }
  }
  return tables;
}

/** Parses the USER_TABLES registry out of the edge function. */
function parseRegistry(src: string): Map<string, string[]> {
  const registry = new Map<string, string[]>();
  const re = /^\s*\["([a-z0-9_]+)",\s*\[([^\]]*)\]\],?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const cols = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean);
    registry.set(m[1], cols);
  }
  return registry;
}

const schemaTables = parseSchemaTables(TYPES);
const registry = parseRegistry(DELETE_FN);

describe("delete-account registry", () => {
  it("points at real tables and real columns", () => {
    // Guards failure mode 2: a delete aimed at a column that does not exist
    // fails silently and the row survives.
    const bad: string[] = [];
    for (const [table, columns] of registry) {
      const schemaCols = schemaTables.get(table);
      if (!schemaCols) { bad.push(`${table} (table does not exist)`); continue; }
      for (const col of columns) {
        if (!schemaCols.includes(col)) bad.push(`${table}.${col} (no such column)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("covers every table that can hold an athlete's row", () => {
    // Guards failure mode 1: a user-keyed table nobody remembered.
    const missing: string[] = [];
    for (const [table, columns] of schemaTables) {
      if (INTENTIONALLY_EXCLUDED[table]) continue;
      const keys = columns.filter((c) => USER_KEY.test(c));
      if (keys.length === 0) continue;

      const handled = registry.get(table);
      if (!handled) { missing.push(`${table} (not in registry)`); continue; }
      for (const key of keys) {
        if (!handled.includes(key)) missing.push(`${table}.${key} (column not handled)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("parsed enough of the schema to be meaningful", () => {
    // A silent parsing failure would make the assertions above vacuously pass.
    expect(schemaTables.size).toBeGreaterThan(60);
    expect(registry.size).toBeGreaterThan(60);
  });

  it("verifies the wipe instead of assuming it", () => {
    // The function must count what is left, and must not report success when
    // something remains.
    expect(DELETE_FN).toContain('count: "exact"');
    expect(DELETE_FN).toContain("residuals");
    expect(DELETE_FN).toMatch(/error: "incomplete"/);
  });
});
