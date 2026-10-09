// ============================================================================
// PLAN EDIT — the client half of the AI coach edit
// ----------------------------------------------------------------------------
// The server (`edit-plan`) does the charging and the model call. What lives
// here is everything that has to be true BEFORE that call is worth making, and
// everything that has to be true about the answer afterwards:
//
//   * an instruction that is empty or absurd is rejected here, so it never
//     becomes a charge and a provider call,
//   * the weeks that get sent are exactly the weeks the price buys — one week
//     for `plan_edit`, the whole plan for `plan_edit_full` — because sending
//     more than the athlete paid for is how the two prices would stop being
//     true,
//   * and the answer is spliced back by WEEK NUMBER, never by position. A model
//     that returns its weeks in a different order (or in an order that happens
//     to look right) must not be able to put week 5's sessions into week 3's
//     slot — that is a plan that looks fine and trains the wrong block.
//
// Free edits are deliberately not in this module: marking a holiday, editing a
// session by hand and skipping a session are local writes in Training.tsx with
// no provider call behind them, and they stay free.
// ============================================================================

import { creditCost, type FeatureCostKey } from "@/lib/credits";

export type PlanEditScope = "week" | "plan";

/** The shape this module needs from a week row. */
export type PlanWeekLike = {
  week: number;
  [key: string]: unknown;
};

export const MIN_EDIT_INSTRUCTION = 4;
export const MAX_EDIT_INSTRUCTION = 400;

/** Which metered feature pays for this scope. */
export function editCostKey(scope: PlanEditScope): FeatureCostKey {
  return scope === "plan" ? "plan_edit_full" : "plan_edit";
}

/** What this scope costs, from the one place client prices are declared. */
export function editCost(scope: PlanEditScope): number {
  return creditCost(editCostKey(scope));
}

// Deliberately NOT a discriminated union: this project compiles with
// strict:false, and optional fields keep every call site simple (same note as
// `starterOffer.ts`'s purchase result, for the same reason).
export type InstructionCheck = {
  ok: boolean;
  /** Present when `ok` — the trimmed instruction to send. */
  instruction?: string;
  /** Present when not `ok` — what to tell the athlete. */
  error?: string;
};

/**
 * Trim and bound the instruction. Both bounds are enforced again on the server
 * (a client is not a place to enforce anything), but checking here means the
 * athlete is told what is wrong before they are charged and before a request
 * leaves the phone.
 */
export function validateEditInstruction(raw: string | null | undefined): InstructionCheck {
  const instruction = (raw ?? "").trim();
  if (instruction.length < MIN_EDIT_INSTRUCTION) {
    return { ok: false, error: "Tell the coach what to change — a few words is enough." };
  }
  if (instruction.length > MAX_EDIT_INSTRUCTION) {
    return { ok: false, error: `Keep the request under ${MAX_EDIT_INSTRUCTION} characters.` };
  }
  return { ok: true, instruction };
}

/**
 * The weeks to send. A week edit sends exactly the week it names; a whole-plan
 * edit sends the plan. Selection is by week NUMBER, so a plan whose weeks are
 * not in order still sends the right one.
 */
export function weeksForEdit<T extends PlanWeekLike>(
  planData: T[],
  scope: PlanEditScope,
  week: number,
): T[] {
  if (scope === "plan") return planData;
  const match = planData.find((w) => Number(w.week) === Number(week));
  return match ? [match] : [];
}

export type SpliceResult<T> = {
  plan: T[];
  /** Week numbers that were actually replaced, in plan order. */
  replaced: number[];
  /** Edited weeks that matched no week in the plan and were dropped. */
  orphans: number[];
};

/**
 * Put the edited weeks back into the plan.
 *
 * Only weeks already present are replaced, always in place, and the plan's
 * length and order never change — the alternative (replace by response order)
 * silently rewrites the wrong block the moment the model returns its weeks
 * shuffled, and the athlete has no way to see that it happened.
 */
export function spliceEditedWeeks<T extends PlanWeekLike>(
  planData: T[],
  edited: unknown[],
  scope: PlanEditScope,
  week: number,
): SpliceResult<T> {
  const incoming = (Array.isArray(edited) ? edited : []).filter(
    (w): w is T => !!w && typeof w === "object" && !Array.isArray(w) && Number.isFinite(Number((w as PlanWeekLike).week)),
  );

  // A week edit may only ever touch the week it named, whatever came back.
  const allowed =
    scope === "week"
      ? incoming.filter((w) => Number(w.week) === Number(week))
      : incoming;

  const byWeek = new Map<number, T>();
  for (const w of allowed) byWeek.set(Number(w.week), w);

  const replaced: number[] = [];
  const plan = planData.map((w) => {
    const replacement = byWeek.get(Number(w.week));
    if (!replacement) return w;
    replaced.push(Number(w.week));
    return replacement;
  });

  const orphans = allowed
    .map((w) => Number(w.week))
    .filter((num) => !planData.some((w) => Number(w.week) === num));

  return { plan, replaced, orphans };
}

/** A fresh id per edit attempt; reused only when retrying the same attempt. */
export function newEditRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through to the timestamp form */
  }
  return `edit-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export type PlanEditRequest = {
  scope: PlanEditScope;
  week: number;
  instruction: string;
  weeks: PlanWeekLike[];
  sport?: string;
  level?: string;
  durationWeeks?: number;
  targetEvent?: string;
  requestId: string;
  userLocale?: string;
};

export type PlanEditResponse = {
  ok: boolean;
  /** Present when `ok` — the rewritten weeks, in the plan's own schema. */
  weeks?: Record<string, unknown>[];
  /** What was charged, and what is left. Both absent on failure. */
  cost?: number;
  balance?: number;
  /** Present when not `ok`. */
  error?: string;
  /** Credits the athlete is short by — the top-up sheet's input. */
  shortfall?: number | null;
  attemptComplete?: boolean;
  retryable?: boolean;
};

/**
 * Ask the server to rewrite the requested weeks.
 *
 * `quotaExceeded` distinguishes the one failure the athlete can actually act on
 * (not enough credits) from the ones they cannot, so the caller can open the
 * top-up sheet for the first and show a message for the rest.
 */
/** `quotaExceeded` is the one failure the caller can act on, so it is flagged. */
export type PlanEditOutcome = PlanEditResponse & { quotaExceeded?: boolean };

export async function requestPlanEdit(request: PlanEditRequest): Promise<PlanEditOutcome> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { edgeErrorMessage } = await import("@/lib/edgeErrors");

  try {
    const { data, error } = await supabase.functions.invoke("edit-plan", {
      body: {
        scope: request.scope,
        week: request.week,
        instruction: request.instruction,
        weeks: request.weeks,
        sport: request.sport ?? "",
        level: request.level ?? "",
        duration_weeks: request.durationWeeks ?? request.weeks.length,
        target_event: request.targetEvent ?? "",
        request_id: request.requestId,
        userLocale: request.userLocale,
      },
    });

    if (error) {
      // A 402 is the shortfall path: the body carries exactly how far short the
      // athlete is, which is what the top-up sheet needs — never guessed here.
      const status = (error as { context?: { status?: number } }).context?.status;
      const message = await edgeErrorMessage(error);
      let shortfall: number | null = null;
      let cost: number | undefined;
      let attemptComplete = false;
      let retryable = false;
      try {
        const payload = await (error as { context: Response }).context.json();
        attemptComplete = payload?.attempt_complete === true && !payload?.refund_pending;
        retryable = payload?.retryable === true;
        if (typeof payload?.shortfall === "number") shortfall = payload.shortfall;
        if (typeof payload?.cost === "number") cost = payload.cost;
      } catch {
        /* body unreadable — the message is still usable */
      }
      return {
        ok: false,
        error: message,
        shortfall,
        cost,
        quotaExceeded: status === 402 && retryable && (shortfall ?? 0) > 0,
        attemptComplete, retryable,
      };
    }

    const weeks = Array.isArray(data?.weeks) ? (data.weeks as Record<string, unknown>[]) : [];
    if (weeks.length === 0) {
      return { ok: false, error: "The edit came back empty. Retry to recover the original request." };
    }

    return {
      ok: true,
      weeks,
      cost: Number(data?.cost ?? editCost(request.scope)),
      balance: Number(data?.balance ?? 0),
    };
  } catch {
    return { ok: false, error: "The edit could not be sent. Check your connection and try again." };
  }
}
