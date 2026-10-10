// ============================================================================
// A FAILED READ IS NOT AN EMPTY RESULT
// ----------------------------------------------------------------------------
// `const { data } = await supabase.from("training_plans")...; setPlans(data ?? [])`
// is the single most common shape in this app, and it has a failure mode nobody
// can see: an outage, an expired session or a row-level policy that says no all
// produce `data === null`, which is indistinguishable from "you have nothing".
// The athlete then reads a wrong statement as fact — "no plan yet" on the screen
// where creating one costs 20 credits a week, "not started" over learning
// progress that exists, an empty basket over a basket with items in it.
//
// This is the smallest thing that fixes the class: destructure the error, hand
// it here, and the failure is logged and said out loud once. Screens that render
// something derived from the data should also branch on the return value and
// show an error state instead of the empty one — `readFailed` returning true is
// the signal for that.
//
// The toast is de-duplicated per message: a screen that fires six reads on an
// offline load gets one notice, not six, and the console keeps the full trace.
// Sonner is the app's single toast renderer (see the note in src/App.tsx), and
// @/hooks/use-toast forwards to it, so this works from a plain module.
// ============================================================================

import { toast } from "sonner";

const reported = new Set<string>();

/**
 * Report a failed Supabase read. True when it failed, so callers can render an
 * error state rather than an empty one.
 *
 * @param error the `error` from a Supabase response (null/undefined when fine)
 * @param what  what the athlete would have been looking at: "your plan",
 *              "your check-ins", "the Market" — it is used verbatim in copy, so
 *              it reads as a sentence: `Could not load your plan`.
 * @param opts.quiet log only — for polling and background refreshes, where a
 *              toast per attempt would be noise rather than information.
 */
export function readFailed(
  error: { message?: string } | null | undefined,
  what: string,
  opts: { quiet?: boolean } = {},
): boolean {
  if (!error) return false;

  const message = error.message || "Unknown error";
  // Always logged: the console keeps the full trace even when the UI is quiet.
  console.error(`[read] ${what} failed:`, message);

  if (!opts.quiet && !reported.has(message)) {
    reported.add(message);
    toast.error(`Could not load ${what}`, { description: message, id: `read-failed:${message}` });
  }
  return true;
}

/** Test seam: the de-duplication is per session, and a test needs a clean slate. */
export function resetReadFailureReports(): void {
  reported.clear();
}
