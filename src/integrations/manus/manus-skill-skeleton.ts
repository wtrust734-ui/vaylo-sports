// ============================================================================
// manus-skill-skeleton — how Manus 2.0 drives Vaylo Sports
// ----------------------------------------------------------------------------
// Manus is a standalone agent platform (desktop app / cloud computer). It does
// not run inside the Vaylo web app and it does not expose an SDK that gets
// "added" to a React build. The integration is an HTTP handshake:
//
//   Manus agent  ──(POST /functions/v1/manus-invoke)──▶ Vaylo edge function
//   (shared secret in vault)                        (deny-by-default, read-only
//                                                    + explicit write-through)
//
// This file is the skill skeleton the agent loads to decide which Vaylo action
// to call, in what shape, and how to turn the result (a form-analysis report),
// into a TikTok hook or a caption. It is meant to be read and mirrored by the
// agent, not bundled into the app.
// ============================================================================

import type { Page, RequestInit } from "type-fest";

// The only secret. Never hardcode; read from the vault / env at run time.
export const MANUS_SHARED_SECRET = process.env.MANUS_SHARED_SECRET ?? "";

const MANUS_INVOKE = "/functions/v1/manus-invoke";

export interface ManusInvokeRequest {
  action: ManusAction;
  // free-form fields depend on action; the reference file maps each one
}

export type ManusAction =
  | "form-analysis-summary"
  | "leadeboard-summary"
  | "coach-catalog"
  | "form-analysis-run"
  | "plan-edit-request"
  | "plan-delivery-write"
  | "buy-coaching-plan"
  | "leaderboard-bump";

export interface ManusInvokeResult {
  ok: boolean;
  error?: string;
  code?: string;
  data?: unknown;
}

/** Single HTTP POST, with the shared secret as the only credential. */
async function callManusAction(
  action: ManusAction,
  payload: Record<string, unknown>,
  options?: RequestInit,
): Promise<ManusInvokeResult> {
  const res = await fetch(MANUS_INVOKE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-secret": MANUS_SHARED_SECRET,
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify({ action, ...payload }),
    ...options,
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON (network or server crash). Report the raw text so the agent
    // knows this is a server problem, not a missing permission.
    return { ok: false, error: `server returned non-JSON: ${text.slice(0, 200)}` };
  }
  return { ok: res.ok, ...parsed, status: res.status };
}

/** 1. Read the latest form-analysis report for an athlete.
 *  Call with action: form-analysis-summary. */
export async function readFormAnalysis(
  userId: string,
): Promise<ManusInvokeResult> {
  return callManusAction("form-analysis-summary", { userId });
}

/** 2. Read the top PBs the agent references when it writes a hook. */
export async function readLeaderboard(
  sport: string,
  tier?: string,
): Promise<ManusInvokeResult> {
  return callManusAction("leadeboard-summary", { sport, tier });
}

/** 3. Read the coach catalogue (plans the agent can mention as "edits"). */
export async function readCoachCatalog(): Promise<ManusInvokeResult> {
  return callManusAction("coach-catalog", {});
}

/** 4. Run a clip through video-form-analysis (the honest video-editing step).
 *  The agent does not hold the bytes; it hands the clip a URL and the existing
 *  function uploads + analyses, and returns a report id we can fetch with
 *  readFormAnalysis. */
export async function runFormAnalysis(
  clipUrl: string,
  note?: string,
): Promise<ManusInvokeResult> {
  return callManusAction("form-analysis-run", { source: { clip_url: clipUrl, note } });
}

/** 5. Ask a coach to edit an existing plan — write-only enqueue. */
export async function requestPlanEdit(
  planId: string,
  changeNote: string,
): Promise<ManusInvokeResult> {
  return callManusAction("plan-edit-request", { plan_id: planId, change_note: changeNote });
}

/** 6. Mark a delivered plan — server checks order + coach + buyer. */
export async function writePlanDelivery(
  orderId: string,
  coachId: string,
  buyerId: string,
  title: string,
  body: string,
): Promise<ManusInvokeResult> {
  return callManusAction("plan-delivery-write", {
    order_id: orderId,
    coach_id: coachId,
    buyer_id: buyerId,
    title,
    body,
  });
}

/** 7. Buy a coaching plan — server quotes and charges. */
export async function buyCoachingPlan(
  listingId: string,
  idempotencyKey: string,
): Promise<ManusInvokeResult> {
  return callManusAction("buy-coaching-plan", { listing_id: listingId, idempotency_key: idempotency_key });
}

export async function bumpLeaderboard(): Promise<ManusInvokeResult> {
  return callManusAction("leaderboard-bump", {});
}

// -------------------------------------------------------------------------
// How the agent turns a form-analysis report into a TikTok caption.
// ================================================================ */
interface FormAnalysisReport {
  id: string;
  movement_type: string;
  score: number;
  summary: string;
  created_at: string;
}

/** Turn a Vaylo form-analysis report into a 6-second captioning hook. The agent
 *  is not the editor — it is the orchestrator. It does the research (step 1),
 *  then calls the existing video-analysis + ai-service functions for the copy. */
export async function turnFormAnalysisIntoTikTokHook(userId: string): Promise<{
  hook: string;
  caption: string;
  analysisReportId: string;
}> {
  // 1. Research the form. The agent calls the read-only agent surface; it never
  //    holds secrets or user data past this call.
  const analysis = (await readFormAnalysis(userId)) as
    | { ok: true; data?: { summary?: string; score?: number; movement_type?: string } }
    | undefined;

  if (!analysis?.ok || !analysis.data?.summary) {
    throw new Error("No form-analysis report for this athlete yet — run form-analysis-run first.");
  }

  const { summary, score, movement_type } = analysis.data;

  // 2. Translate to hook language: a concrete number the athlete can feel, a
  //    "contrast that hurts", and the specific fix. The copy engine is an
  //    existing Vaylo function (ai-service / ai-analyze); the agent only
  //    dispatches and folds the result.
  const hook = `[${movement_type || "Move"}] score ${score ?? "—"} · ${summary || "review"}`;
  const caption = `Coach's note on ${movement_type || "your form"}: ${summary || "nothing to change"}. ${score !== undefined ? "Score " + score + "/" : ""} keep the baseline.`;

  return {
    hook,
    caption,
    analysisReportId: analysis.data.id ?? "",
  };
}

// -------------------------------------------------------------------------
// Skill manifest the agent loads at startup.
// -------------------------------------------------------------------------
export const MANUS_SKILL_MANIFEST: Record<string, unknown> = {
  name: "vaylo-sports-drive",
  version: "1.0.0",
  description:
    "Turns Vaylo Sports into a workflow for Manus: run form analysis on a clip, read the PBs the athlete just beat, write a TikTok hook from the report, and order a coaching-plan edit through the coach's queue.",
  tools: [
    {
      name: "vaylo_read_form_analysis",
      description: "Read the latest form-analysis report for an athlete. Deny-only: cannot change anything.",
      parameters: { userId: "string" },
    },
    {
      name: "vaylo_read_leaderboard",
      description: "Read the top PBs the athlete can beat in a hook.",
      parameters: { sport: "string", tier?: "string" },
    },
    {
      name: "vaylo_read_coach_catalog",
      description: "Read the published coaching plans the agent can mention as edits.",
      parameters: {},
    },
    {
      name: "vaylo_run_form_analysis",
      description: "Upload a clip URL and run video-form-analysis. Returns a report id.",
      parameters: { clip_url: "string", note?: "string" },
    },
    {
      name: "vaylo_request_plan_edit",
      description: "Enqueue a coach edit request against a plan id.",
      parameters: { plan_id: "string", change_note: "string" },
    },
    {
      name: "vaylo_write_plan_delivery",
      description: "Mark a plan as delivered for a paid order. Server checks order + coach + buyer.",
      parameters: { order_id: "string", coach_id: "string", buyer_id: "string", title: "string", body: "string" },
    },
    {
      name: "vaylo_buy_coaching_plan",
      description: "Spend coaching credits. Server quotes and charges; the agent never computes money.",
      parameters: { listing_id: "string", idempotency_key: "string" },
    },
    {
      name: "vaylo_bump_leaderboard",
      description: "No-op now. Leaderboard writes are server-side only.",
      parameters: {},
    },
  ],
  workflow: `
    1. research: read form analysis + leaderboard (deny-only)
    2. write: ask the copy engine to turn the report into a 6s hook
    3. publish: post the hook + caption to the TikTok feed (a content-publish action the agent owns)
    4. followup: if the athlete wants an edit, enqueue plan-edit-request; the coach reacts
  `,
};
