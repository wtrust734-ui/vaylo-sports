import { useEffect, useRef, useState } from "react";
import { Flag, Ban, Check, Loader2 } from "lucide-react";
import {
  REPORT_REASONS,
  reportContent,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/safety";
import { blockUser } from "@/lib/blocking";

// ============================================================================
// ReportMenu — the P0-1 / P0-2 safety control
// ----------------------------------------------------------------------------
// Every piece of content another athlete can see gets one of these. Google Play
// requires both a report function and a block function for an app with
// user-generated content; neither existed, and the database had a block table
// with no way to reach it.
//
// Two rules this component follows:
//
//   * It never blocks silently. Blocking is a two-step confirm, because a
//     mis-tap on the wrong athlete is itself a harm.
//   * It never claims a report was sent unless the server said so. A report
//     that appears to succeed but did not is worse than no report, because the
//     athlete stops looking for another way to get help.
//
// The report is filed server-side via the `report_content` RPC, which validates
// the reason, rate-limits, and de-duplicates. See src/lib/safety.ts.
// ============================================================================

export interface ReportMenuProps {
  /** What is being reported. */
  targetType: ReportTargetType;
  targetId: string;
  /** Human-readable label for the moderator, e.g. "shared a workout". */
  targetLabel?: string;
  /** The athlete who posted it. Omit on your own content. */
  authorId?: string;
  /** Show the block action as well as report. */
  allowBlock?: boolean;
  /**
   * Called with the blocked athlete's id once a block has actually been stored.
   *
   * Blocking is not only a safety action: the database also ends the friendship
   * (`guard_block_coherence`), so a screen that lists friends has to reload or
   * it keeps offering to message somebody who has just been blocked.
   */
  onBlocked?: (blockedId: string) => void;
  className?: string;
}

type Status = "idle" | "open" | "sending" | "sent" | "blocked" | "error";

const ReportMenu = ({
  targetType,
  targetId,
  targetLabel,
  authorId,
  allowBlock = true,
  onBlocked,
  className = "",
}: ReportMenuProps) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click and on Escape — a menu that traps a young user
  // mid-decision is its own problem.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = async () => {
    if (!reason) return;
    setStatus("sending");
    const res = await reportContent({
      targetType,
      targetId,
      targetLabel,
      reason,
      details: details || undefined,
    });
    if (res.ok) {
      setStatus("sent");
      setMessage("Thank you. We've logged this and a person will review it.");
    } else {
      setStatus("error");
      setMessage(res.error ?? "We couldn't log that report. Please try again.");
    }
  };

  const doBlock = async () => {
    if (!authorId) return;
    setStatus("sending");
    const res = await blockUser(authorId);
    if (res.ok) {
      setStatus("blocked");
      setMessage(
        "Blocked. You won't see this athlete's activity, you can't message each other, and any friendship or friend request between you is gone.",
      );
      onBlocked?.(authorId);
    } else {
      setStatus("error");
      setMessage(res.error ?? "We couldn't block that athlete.");
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label="Report this content"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setStatus("idle");
          setMessage("");
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <Flag size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Report or block"
          className="absolute right-0 z-50 mt-1 w-[19rem] rounded-2xl border border-border bg-card p-4 shadow-xl"
        >
          {status === "sent" || status === "blocked" ? (
            <div className="flex gap-3">
              <Check size={16} className="mt-0.5 shrink-0 text-success" />
              <p className="text-sm leading-relaxed text-foreground">{message}</p>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">What's wrong with this?</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Reports are read by a person, not filtered automatically. We'll tell you what
                happens next.
              </p>

              <div className="mt-3 grid grid-cols-1 gap-1">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`rounded-lg px-2.5 py-1.5 text-start text-sm transition-colors ${
                      reason === r.value
                        ? "bg-primary/15 text-primary font-semibold"
                        : "text-foreground/85 hover:bg-muted/60"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {reason === "other" && (
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Tell us what happened (optional)"
                  aria-label="Report details"
                  className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
                />
              )}

              {status === "error" && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {message}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!reason || status === "sending"}
                  onClick={submit}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  {status === "sending" ? <Loader2 size={14} className="mx-auto animate-spin" /> : "Send report"}
                </button>
                {allowBlock && authorId && (
                  <button
                    type="button"
                    disabled={status === "sending"}
                    onClick={doBlock}
                    title="Block this athlete"
                    aria-label="Block this athlete"
                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted/60 disabled:opacity-40"
                  >
                    <Ban size={14} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportMenu;
