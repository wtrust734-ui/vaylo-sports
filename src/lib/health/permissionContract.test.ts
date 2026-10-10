// ============================================================================
// THE HealthConnectPlugin → sync.ts CONTRACT
// ----------------------------------------------------------------------------
// `syncPull` reports a grant that is missing some reads by rejecting with
//
//     code    = "permission_partial"
//     message = "permission_partial:steps,sleep session"
//
// and `permissionOutcome` turns that back into the reads the screen names. Two
// files, two languages, no compiler between them: the Kotlin message is built
// with a delimiter the TypeScript splits on, and nothing but these tests stops
// one side from being edited alone. That is not hypothetical — the first
// version of this seam put prose in the message ("Missing Health Connect
// permissions: …") while the parser looked for a marker, so a partial grant
// arrived as `sync_failed` and the athlete was told only that a sync did not
// complete.
//
// So this pins both halves: the line the Android plugin emits, and what the
// parser makes of every shape that could plausibly reach it.
// ============================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { permissionOutcome } from "./sync";

const KOTLIN = "android/app/src/main/java/com/vaylosports/app/health/HealthConnectPlugin.kt";

describe("the Android plugin emits what this parser reads", () => {
  const source = readFileSync(KOTLIN, "utf8");

  it("marks the partial case with the code both sides agree on", () => {
    expect(source).toContain('"permission_partial"');
  });

  it("carries the list after the marker, comma-joined", () => {
    // The exact expression, not just the substring: `joinToString(", ")` with a
    // space would produce "steps, sleep session" split into the one name
    // "steps, sleep session" — a wrong name shown to the athlete rather than a
    // crash.
    expect(source).toMatch(/"permission_partial:"\s*\+\s*[\s\S]{0,120}?joinToString\(","\)/);
  });

  it("keeps a real revocation as the bare string the parser special-cases", () => {
    // Two call sites, both of them whole-permission-list emptiness. They must
    // stay `permission_revoked`, which is what clears stored consent.
    expect(source.match(/call\.reject\("permission_revoked"\)/g)?.length).toBe(2);
  });
});

describe("permissionOutcome", () => {
  it("reads the current plugin's message and code together", () => {
    expect(
      permissionOutcome({
        code: "permission_partial",
        message: "permission_partial:steps,sleep session",
      }),
    ).toEqual({ kind: "partial", missing: ["steps", "sleep session"] });
  });

  it("reads a message that carries the marker on its own", () => {
    // The one-argument form this app used before the code argument existed.
    expect(permissionOutcome({ message: "permission_partial:steps" })).toEqual({
      kind: "partial",
      missing: ["steps"],
    });
  });

  it("accepts the JSON list as well as the plain one", () => {
    expect(permissionOutcome({ message: 'permission_partial:["steps","sleep"]' })).toEqual({
      kind: "partial",
      missing: ["steps", "sleep"],
    });
  });

  it("reports a partial grant with no names rather than inventing them", () => {
    // An older build that sends the code and a human sentence: the athlete is
    // told some reads are off, and NOT told "Missing Health Connect
    // permissions: steps" is the name of a permission.
    const outcome = permissionOutcome({
      code: "permission_partial",
      message: "Missing Health Connect permissions: steps, sleep session",
    });
    expect(outcome).toEqual({ kind: "partial", missing: [] });
  });

  it("reports a partial grant when the plugin said nothing else at all", () => {
    expect(permissionOutcome({ code: "permission_partial" })).toEqual({ kind: "partial", missing: [] });
  });

  it("recognises a revocation in either field", () => {
    expect(permissionOutcome({ message: "permission_revoked" })).toEqual({ kind: "revoked", missing: [] });
    expect(permissionOutcome({ code: "permission_revoked" })).toEqual({ kind: "revoked", missing: [] });
  });

  it("leaves every other failure alone, so it is not read as a permissions story", () => {
    expect(permissionOutcome({ message: "sync_failed" })).toEqual({ kind: null, missing: [] });
    expect(permissionOutcome({ message: "unavailable" })).toEqual({ kind: null, missing: [] });
    expect(permissionOutcome({ code: "unavailable", message: "unavailable" })).toEqual({ kind: null, missing: [] });
  });

  it("never throws on anything a bridge can throw", () => {
    for (const value of [undefined, null, "", "permission_partial:steps", 42, {}, { message: 7 }, { code: {} }]) {
      expect(permissionOutcome(value), JSON.stringify(value) ?? String(value)).toEqual({
        kind: null,
        missing: [],
      });
    }
  });
});
