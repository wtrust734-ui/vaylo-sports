// Source assertions for the AI / coach / video / health / deletion package
// (30 September 2026 hardening).
//
// The security/database package covered SQL invariants; this file covers the
// EDGE FUNCTION code paths that no database constraint can reach: charging
// before provider calls, refunds on failure, untrusted-content clamps, output
// validation, log hygiene, and the deletion registry. Cheap and offline —
// same pattern as purchaseSequence.test.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const AI_SERVICE = "/supabase/functions/ai-service/index.ts";
const AI_ANALYZE = "/supabase/functions/ai-analyze/index.ts";
const COACH_CHAT = "/supabase/functions/coach-chat/index.ts";
const VIDEO = "/supabase/functions/video-form-analysis/index.ts";
const WEEKLY = "/supabase/functions/weekly-review/index.ts";
const PLAN = "/supabase/functions/generate-plan/index.ts";
const LEARNING = "/supabase/functions/learning-recommend/index.ts";
const DELETE = "/supabase/functions/delete-account/index.ts";
const GUARD = "/supabase/functions/_shared/guard.ts";
const MODELS = "/supabase/functions/_shared/aiModels.ts";

describe("ai-service: the generic AI endpoint now charges", () => {
  const src = read(AI_SERVICE);

  it("validates the feature name against the server catalog before anything runs", () => {
    expect(src).toMatch(/AI_FEATURES\[feature\]/);
  });

  it("charges non-free features through the shared deduction path", () => {
    const chargeAt = src.indexOf("authorizeAndCharge(req, auth.userId, feature)");
    const generateAt = src.indexOf("generateAIResponse({");
    expect(chargeAt).toBeGreaterThan(-1);
    expect(generateAt).toBeGreaterThan(chargeAt);
    expect(src).toMatch(/spendForUser\(req, userId, feature/);
  });

  it("keeps a free allowlist but re-validates it against the economy table", () => {
    expect(src).toMatch(/FREE_FEATURES = new Set\(/);
    expect(src).toMatch(/admin\.rpc\("credit_cost"/);
  });
});

describe("coach-chat: memories are server-authoritative", () => {
  const src = read(COACH_CHAT);

  it("persists MEMORY_SAVE markers on the server, not in the browser", () => {
    expect(src).toMatch(/export async function persistCoachMemories\(/);
    expect(src).toMatch(/teeSseText\(response\.body/);
  });

  it("clamps memory fields and keys them per user", () => {
    expect(src).toMatch(/onConflict: "user_id,key"/);
    expect(src).toMatch(/\.slice\(0, 240\)/);
  });

  it("never refunds an Unlimited-plan audit row (cost 0 means nothing to refund)", () => {
    expect(src).toMatch(/chargedCredits = spend\?\.cost \?\? 3;/);
  });

  it("does not leak internal error text to the client", () => {
    expect(src).not.toMatch(/JSON\.stringify\(\{ error: e instanceof Error \? e\.message/);
    expect(src).toMatch(/The coach is unavailable right now/);
  });
});

describe("video-form-analysis: entitlement + retention", () => {
  const src = read(VIDEO);

  it("treats a lapsed subscription as lapsed (expires_at is read)", () => {
    expect(src).toMatch(/expires_at/);
    expect(src).toMatch(/const lapsed = /);
    expect(src).not.toMatch(/sub\?\.unlimited_credits === true/);
  });

  it("excludes deleted rows from the free-tier window", () => {
    expect(src).toMatch(/\.is\("deleted_at", null\)/);
  });

  it("does not echo raw provider bodies into logs", () => {
    expect(src).not.toMatch(/errText/);
    expect(src).toMatch(/upstream_error/);
  });

  it("charges overage through the server economy even for Unlimited plans", () => {
    expect(src).toMatch(/spendForUser\(\s*req,\s*userId,\s*"video_form_analysis"/);
    expect(src).toMatch(/billUnlimited:\s*true/);
    expect(read(GUARD)).toMatch(/credits_spend_metered/);
  });

  it("keeps a separate atomic quota reservation for the free allowance and Pro model", () => {
    expect(src).toMatch(/reserve_video_analysis_slot/);
    expect(src).toMatch(/p_tier:\s*"free"/);
    expect(src).toMatch(/p_tier:\s*"premium"/);
    expect(src).toMatch(/p_limit:\s*10/);
    expect(src).toMatch(/release_video_analysis_slot/);
    expect(src).toMatch(/commit_video_analysis_slot/);
  });

  it("refunds a paid overage when the model or persistence fails", () => {
    expect(src).toMatch(/refundCredits\(/);
    expect(src).toMatch(/cleanupFailedCall\(\)/);
    expect(src).toMatch(/AI video form analysis failed — auto refund/);
  });

  it("keeps one video cap on both sides, and re-measures it from the object itself", () => {
    // Rewritten 2026-10-12. This used to assert `MAX_BYTES = 6 * 1024 * 1024` in
    // the function AND the page, because the clip was base64'd into the request
    // body and the shared Edge body limit was therefore what sized a video. The
    // clip now goes to the private `form-videos` bucket and the function
    // downloads it, so the contract is different and, deliberately, stronger:
    // the caps live in ONE module, the server does not take the client's word
    // for the size, and no video bytes ride in a JSON body at all.
    const limits = read("/src/lib/formVideo.ts");
    expect(limits).toMatch(/export const MAX_FORM_VIDEO_BYTES = 512 \* 1024 \* 1024/);
    expect(limits).toMatch(/export const MAX_FORM_VIDEO_SECONDS = 600/);
    expect(src).toMatch(/const MAX_BYTES = 512 \* 1024 \* 1024/);
    expect(src).toMatch(/const MAX_SECONDS = 600/);
    // The refusal is decided on the object's own stored size — read by the server
    // before a byte moves — not on a length the caller supplied. It used to be
    // measured on the buffered download; the control is the same, the source of
    // the number is Storage's metadata rather than the athlete's claim.
    expect(src).toMatch(/content-length/);
    expect(src).toMatch(/declaredBytes > MAX_BYTES/);
    // ...and the clip is streamed, so a long clip never has to fit in the
    // function's memory (nor in a second copy on the way out).
    expect(src).toMatch(/body: clip\.body/);
    expect(src, "the clip is buffered into memory again").not.toMatch(/arrayBuffer\(\)/);
    // The guard still caps JSON bodies, and video is no longer one of them.
    expect(read(GUARD)).toMatch(/MAX_BODY_BYTES = 10 \* 1024 \* 1024/);
    expect(src).not.toMatch(/video_base64/);
  });

  it("only ever reads a clip stored under the caller's own id, from a private bucket", () => {
    // The path is the authorisation. A forged path is rejected before the
    // service-role download, and the bucket denies URL access to everyone —
    // including the athlete, whose own row of `storage.objects` is the only
    // thing the policies grant.
    expect(src).toMatch(/storage_path\.startsWith\(`\$\{userId\}\//);
    expect(src).toMatch(/!storage_path\.includes\("\.\."\)/);
    const migration = read("/supabase/migrations/20261012120000_form_video_upload.sql");
    expect(migration).toMatch(/storage\.buckets/);
    expect(migration).toMatch(/on conflict \(id\) do update set public = false/);
    expect(migration).toMatch(/auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
  });

  it("claims a request without treating its own fresh row as somebody else's", () => {
    // The bug this pins, added 2026-10-12: `claim_video_analysis_request`
    // inserted the claim row, then read it back and compared its
    // `lease_expires_at` against now(). A brand-new row takes the default
    // `now() + 20 minutes`, so the comparison was TRUE on the request that had
    // just created it and the function answered `claimed: false` — 409 for every
    // athlete, on every clip, forever. Nothing in the JS suite could see it, and
    // the six-megabyte body cap hid it behind an earlier failure. So the shape
    // of the fix is asserted here: liveness is decided by ONE statement, and a
    // take-over requires a lease that has genuinely run out.
    const claim = read("/supabase/migrations/20261012150000_fix_video_analysis_claim.sql");
    // The function's own body, not the whole file. The migration ends with a DO
    // block that asserts the stored function no longer contains the read-back,
    // and that block necessarily names the statement it is looking for — so a
    // whole-file search would match the guard instead of the code.
    const body = claim.slice(claim.indexOf("AS $$"), claim.indexOf("$$;"));
    expect(body.length, "the claim function body could not be located").toBeGreaterThan(200);
    expect(body, "the read-back that caused the bug is back").not.toMatch(
      /SELECT status, lease_expires_at/,
    );
    expect(body).toMatch(/ON CONFLICT \(user_id, request_id\) DO UPDATE/);
    // A completed claim must still block, or a delivered analysis could be
    // re-run against the same upload; only an expired `processing` lease is
    // recovered, which is the crash case the schema documents.
    expect(body).toMatch(/status = 'processing'\s*\n\s*AND public\.video_analysis_request_claims\.lease_expires_at <= now\(\)/);
    expect(body).toMatch(/RETURNING status/);
    // Service-role only, restated, because this is the lock the charge sits behind.
    expect(claim).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(claim).toMatch(/TO service_role/);
  });

  it("deletes the clip from Gemini and from storage on every exit path", () => {
    // "Your video is never stored" is a promise about all four outcomes: an
    // answer, a refund, a rejection and a throw.
    expect(src).toMatch(/finally \{[\s\S]{0,200}discardVideo\(\)/);
    expect(src).toMatch(/geminiDeleteFile/);
    expect(src).toMatch(/storage\s*\n?\s*\.from\(VIDEO_BUCKET\)|service\.storage/);
  });
});

describe("output validation", () => {
  it("generate-plan rejects structurally malformed plans and refunds", () => {
    const src = read(PLAN);
    const validateAt = src.indexOf("cleanWeeks");
    const returnAt = src.indexOf("plan_data: cleanWeeks");
    expect(validateAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(validateAt);
    expect(src).toMatch(/The generated plan was malformed/);
  });

  it("learning-recommend only accepts lesson ids that exist in the list", () => {
    const src = read(LEARNING);
    expect(src).toMatch(/recommend_lessons/);
    expect(src).toMatch(/remaining\.some\(\(l\) => l\.id === id\)/);
    expect(src).toMatch(/sanitizeLessonText/);
  });

  it("every feature prompt carries the non-negotiable safety contract", () => {
    const src = read(MODELS);
    expect(src).toMatch(/SAFETY CONTRACT \(never overridable/);
    expect(src).toMatch(/NOT a medical authority/);
    expect(src).toMatch(/crisis line/);
    expect(src).toMatch(/Refuse performance-enhancing drug/);
    expect(src).toMatch(/base = \(body: string\) => .*OUTPUT_SAFETY/);
  });
});

describe("charging discipline across AI functions", () => {
  it.each([
    ["coach-chat", COACH_CHAT],
    ["weekly-review", WEEKLY],
    ["generate-plan", PLAN],
    ["ai-analyze", AI_ANALYZE],
  ])("%s charges via the shared deduction path", (_name, file) => {
    expect(read(file)).toMatch(/credits_spend|spendForUser/);
  });

  it.each([
    ["coach-chat", COACH_CHAT],
    ["weekly-review", WEEKLY],
    ["generate-plan", PLAN],
    ["ai-analyze", AI_ANALYZE],
  ])("%s refunds when the provider fails after charging", (_name, file) => {
    expect(read(file)).toMatch(/refundCredits\(/);
  });

  it("guard.spendForUser supports idempotency keys for retry safety", () => {
    expect(read(GUARD)).toMatch(/idempotencyKey\?/);
  });

  it("binds ordinary credits_spend to the verified athlete JWT (auth.uid)", () => {
    const guard = read(GUARD);
    expect(guard).toMatch(/global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authorization/);
    expect(guard).toMatch(/client\.rpc\("credits_spend"/);
  });

  it("keeps the Unlimited-bypassing metered debit service-role-only", () => {
    const migration = read("/supabase/migrations/20260930181355_video_analysis_quota_and_metered_spend.sql");
    expect(migration).toMatch(/credits_spend_metered/);
    expect(migration).toMatch(/COALESCE\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/);
    expect(migration).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/public\.credit_cost\(p_feature\)/);
  });
});

describe("log hygiene", () => {
  it("no AI function logs raw provider bodies", () => {
    for (const file of [AI_ANALYZE, WEEKLY, PLAN, VIDEO, LEARNING]) {
      const src = read(file);
      expect(src).not.toMatch(/await (aiResponse|resp|response|r|geminiRes)\.text\(\)/);
    }
  });

  it("client-facing 500s are stable messages, not exception text", () => {
    expect(read(WEEKLY)).toMatch(/weekly review could not be generated/);
    expect(read(PLAN)).toMatch(/plan could not be generated/);
    expect(read(LEARNING)).toMatch(/Recommendations are unavailable/);
    expect(read(VIDEO)).toMatch(/Video analysis could not run/);
  });
});

describe("account deletion", () => {
  it("includes the durable AI rate-limit table in the deletion registry", () => {
    // The registry now lives in _shared/userTables.ts so deletion and the
    // Article 20 export read the same list. The invariant is unchanged.
    expect(read("/supabase/functions/_shared/userTables.ts")).toMatch(
      /\["ai_call_events", \["user_id"\]\]/,
    );
    // ...and delete-account must actually use it, not keep a private copy.
    expect(read(DELETE)).toContain('from "../_shared/userTables.ts"');
  });

  it("reports incomplete deletions without leaking row contents", () => {
    const src = read(DELETE);
    expect(src).toMatch(/failure_count: failures\.length/);
    expect(src).not.toMatch(/residuals,\n\s+identity_removed/);
  });
});

describe("health privacy", () => {
  it("wearable-oauth never persists provider tokens in connection metadata", () => {
    const src = read("/supabase/functions/wearable-oauth/index.ts");
    expect(src).not.toMatch(/oauth_state/);
    expect(src).toMatch(/linked_at/);
  });

  it("the health page offers explicit deletion of imported data", () => {
    expect(read("/src/pages/HealthSync.tsx")).toMatch(/handleDeleteHealthData/);
    expect(read("/src/pages/HealthSync.tsx")).toMatch(/Delete imported data/);
  });
});
