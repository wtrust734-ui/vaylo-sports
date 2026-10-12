import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";

import BottomSheet from "@/components/ui/bottom-sheet";
import { getAiLocale } from "@/i18n";
import { featureLabel } from "@/lib/credits";
import { requestCreditTopUp } from "@/lib/topUpStore";
import {
  editCost,
  editCostKey,
  newEditRequestId,
  requestPlanEdit,
  spliceEditedWeeks,
  validateEditInstruction,
  weeksForEdit,
  type PlanEditScope,
  type PlanWeekLike,
} from "@/lib/planEdit";

// ============================================================================
// THE PLAN COACH — changing a plan by asking for it
// ----------------------------------------------------------------------------
// The plan is written once and then the athlete's life happens to it: a sore
// knee, a missed Thursday, a week that no longer fits. Every one of those was
// previously answered by starting a new plan or editing a session by hand, so
// this is the conversation that replaces both — a corner button on the open
// plan, and a thread you type a change into.
//
// What this component owns: the thread, the scope (one week or the whole plan),
// the instruction check, and honesty about the charge. What it deliberately
// does NOT own:
//
//   • The charge. `edit-plan` debits the credits server-side and refunds on
//     every failure path, so nothing here calls spendCredits — a client that
//     spent as well would charge twice for one edit.
//   • The splice. The edited weeks go back through `spliceEditedWeeks`, which
//     matches by week NUMBER, so a model that returns its weeks in a different
//     order cannot write week 5's sessions into week 3.
//   • Persistence. `onApplied` hands the caller the new plan; the screen that
//     owns the plan row is the one that writes it, and it can refuse.
//
// The one failure the athlete can act on — not enough credits — is the one this
// sheet does something about: it opens the top-up sheet and retries the SAME
// request id, because that attempt was refused before it was charged.
// ============================================================================

export type PlanEditChatProps = {
  open: boolean;
  onClose: () => void;
  /** The plan in its stored shape: weeks keyed by week number. */
  weeks: PlanWeekLike[];
  /** Which week the "this week" scope opens on. */
  defaultWeek: number;
  sport?: string;
  level?: string;
  durationWeeks?: number;
  targetEvent?: string;
  /**
   * Called with the whole plan once an edit lands. Persisting is the caller's
   * job, and it must REJECT when it could not save — this sheet says "done"
   * only after the caller has written the plan.
   */
  onApplied: (
    weeks: PlanWeekLike[],
    applied: { scope: PlanEditScope; week: number; cost: number },
  ) => void | Promise<void>;
};

type Turn = {
  id: number;
  role: "coach" | "athlete";
  text: string;
  tone?: "error" | "done";
};

/** "week 5" / "weeks 4 and 5" — what was actually rewritten, in the athlete's words. */
function replacedPhrase(weeks: number[]): string {
  if (weeks.length === 0) return "your plan";
  if (weeks.length === 1) return `week ${weeks[0]}`;
  const last = weeks[weeks.length - 1];
  return `weeks ${weeks.slice(0, -1).join(", ")} and ${last}`;
}

export default function PlanEditChat({
  open,
  onClose,
  weeks,
  defaultWeek,
  sport,
  level,
  durationWeeks,
  targetEvent,
  onApplied,
}: PlanEditChatProps) {
  const weekOptions = weeks.map((w) => Number(w.week)).filter((n) => Number.isFinite(n));
  const firstWeek = weekOptions.length ? Math.min(...weekOptions) : 1;

  const [scope, setScope] = useState<PlanEditScope>("week");
  const [week, setWeek] = useState<number>(defaultWeek || firstWeek);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(0);
  const threadEnd = useRef<HTMLDivElement>(null);

  const cost = editCost(scope);

  // Opening the sheet on a different week (the athlete expanded week 3, then
  // asked to edit) should point the week scope at it — but never move a week the
  // athlete has already chosen inside the sheet, and never while a paid edit is
  // in flight.
  useEffect(() => {
    if (!open || busy) return;
    if (weekOptions.length && !weekOptions.includes(week)) setWeek(defaultWeek || firstWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-point only when the sheet opens or the plan's weeks change
  }, [open, defaultWeek, weekOptions.join(","), busy]);

  useEffect(() => {
    // jsdom has no layout engine and no scrollIntoView; a missing method here is
    // not a failure the athlete should ever see.
    threadEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns, open]);

  const push = (role: Turn["role"], text: string, tone?: Turn["tone"]) => {
    setTurns((prev) => [...prev, { id: nextId.current++, role, text, tone }]);
  };

  /** One attempt. Kept separate so a top-up can retry exactly the same request. */
  const attempt = (instruction: string, target: PlanWeekLike[], requestId: string) =>
    requestPlanEdit({
      scope,
      week,
      instruction,
      // Exactly the weeks this price buys: one for a week edit, the plan for a
      // whole-plan edit. Nothing else is ever sent.
      weeks: target,
      sport,
      level,
      durationWeeks: durationWeeks ?? weeks.length,
      targetEvent,
      requestId,
      userLocale: getAiLocale(),
    });

  const send = async () => {
    if (busy) return;
    const check = validateEditInstruction(draft);
    if (!check.ok) {
      push("coach", check.error ?? "Tell me what to change.", "error");
      return;
    }
    const instruction = check.instruction!;
    const target = weeksForEdit(weeks, scope, week);
    if (target.length === 0) {
      push("coach", "That week is not part of this plan — pick another one.", "error");
      return;
    }

    push("athlete", instruction);
    setDraft("");
    setBusy(true);
    const requestId = newEditRequestId();

    try {
      let outcome = await attempt(instruction, target, requestId);

      if (!outcome.ok && outcome.quotaExceeded) {
        push("coach", outcome.error ?? `That edit needs ${cost} credits.`, "error");
        const topUp = await requestCreditTopUp({
          shortfall: outcome.shortfall ?? cost,
          reasonLabel: featureLabel(editCostKey(scope)),
          balance: outcome.balance,
        });
        if (!topUp.purchased) {
          push("coach", "No problem — nothing was charged. Tell me when you want to try again.");
          return;
        }
        push("coach", "Thanks. Applying that edit now…");
        // The same request id, because the refused attempt was never charged:
        // the idempotency key exists for exactly this retry.
        outcome = await attempt(instruction, target, requestId);
      }

      if (!outcome.ok) {
        push(
          "coach",
          outcome.error ?? "The edit could not be applied. Your credits were refunded.",
          "error",
        );
        return;
      }

      const spliced = spliceEditedWeeks(weeks, outcome.weeks ?? [], scope, week);
      if (spliced.replaced.length === 0) {
        push("coach", "The edit came back empty. Your credits were refunded.", "error");
        return;
      }

      try {
        await onApplied(spliced.plan, { scope, week, cost: outcome.cost ?? cost });
      } catch {
        // The rewrite came back and was charged; the plan row was not updated.
        // "Done" here would be a lie the athlete sees the moment they close
        // the sheet and their week is unchanged.
        push(
          "coach",
          "The rewrite came back but saving it to your plan failed. Your plan is unchanged — check your connection and ask again.",
          "error",
        );
        return;
      }

      const spent = outcome.cost ?? cost;
      const balance = Number.isFinite(outcome.balance) ? ` You have ${outcome.balance} left.` : "";
      push(
        "coach",
        `Done — ${replacedPhrase(spliced.replaced)} rewritten. ${spent} credits used.${balance}`,
        "done",
      );
      if (spliced.orphans.length) {
        // Not a silent drop: the athlete paid for an edit and is owed the fact
        // that part of what came back matched nothing in their plan.
        push(
          "coach",
          `One part of the answer did not match this plan (week ${spliced.orphans.join(", ")}) and was ignored.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="lg"
      z="z-[70]"
      leading={<MessageSquare size={16} className="mt-0.5 shrink-0 text-primary" />}
      title="Plan coach"
      subtitle="Describe the change — a few words is enough."
      headerRight={
        <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          {cost} credits
        </span>
      }
      footer={
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter is a new line, because this is a
                // request box, not a document.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={400}
              aria-label="What should the coach change?"
              placeholder="e.g. swap Thursday for a swim, or ease the next two weeks"
              className="min-h-11 w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || draft.trim().length === 0}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {busy ? "Applying…" : "Send"}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Each edit is charged once. If the AI fails, the credits are refunded automatically —
            nothing here is free-text guessing at your week, the coach returns the same plan with
            only the change you asked for.
          </p>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Scope is the price: one week or the whole plan, named before the
            athlete types rather than after they are charged. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "week" as PlanEditScope, label: "One week" },
              { id: "plan" as PlanEditScope, label: "Whole plan" },
            ] satisfies { id: PlanEditScope; label: string }[]
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setScope(option.id)}
              aria-pressed={scope === option.id}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                scope === option.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:border-primary/30"
              }`}
            >
              {option.label} · {editCost(option.id)}
            </button>
          ))}
          {scope === "week" && weekOptions.length > 1 && (
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
              Week
              <select
                value={week}
                onChange={(event) => setWeek(Number(event.target.value))}
                aria-label="Which week to edit"
                className="rounded-lg border border-border bg-card px-2 py-1 text-[12px] text-foreground"
              >
                {weekOptions.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {turns.length === 0 && (
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-[12px] leading-relaxed text-foreground">
              Tell me what to change and I will rewrite it. The rest of the plan stays exactly as it
              is — same sessions, same days, same order.
            </p>
            <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
              <li>“Swap Thursday's run for a swim”</li>
              <li>“My knee is sore — ease the next fortnight”</li>
              <li>“Add one more rest day a week”</li>
            </ul>
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`flex ${turn.role === "athlete" ? "justify-end" : "justify-start"}`}
          >
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                turn.role === "athlete"
                  ? "bg-primary/15 text-foreground"
                  : turn.tone === "error"
                    ? "border border-destructive/30 bg-destructive/[0.07] text-foreground"
                    : turn.tone === "done"
                      ? "border border-success/30 bg-success/[0.07] text-foreground"
                      : "border border-border bg-card text-muted-foreground"
              }`}
            >
              {turn.text}
            </p>
          </div>
        ))}
        <div ref={threadEnd} />
      </div>
    </BottomSheet>
  );
}
