import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Bug, ChevronDown } from "lucide-react";
import { formatDate } from "@/i18n/format";

/**
 * Failures reported by the app itself, as the operator sees them.
 *
 * Why this screen exists: the reports arrive in a table, and a table nobody
 * opens is not monitoring. The operator runs a closed test from a phone, and a
 * tester's "it broke when I logged a set" has to be answerable from that same
 * phone — so the triage lives here rather than in a SQL console. Reports are
 * also mailed, but only the first time a failure is seen; repeats only bump a
 * counter, so the inbox stays readable.
 *
 * Route access is decided by RequireAdmin in App.tsx, but that only decides what
 * to DRAW. The real authorization is the RLS pair in
 * 20261010120000_app_error_reports.sql: an admin read policy and an admin update
 * policy, both testing has_role(auth.uid(), 'admin'). A non-admin who reached
 * this page by any means would get an empty list, and their status change would
 * update no rows.
 *
 * What is deliberately NOT here: a delete button. A failure that has been fixed
 * is evidence the fix was needed, and "ignored" already says "stop showing me
 * this" without destroying it.
 */
type ReportStatus = "new" | "investigating" | "fixed" | "ignored";

type Report = {
  id: string;
  fingerprint: string;
  app_version: string;
  name: string;
  message: string;
  stack: string | null;
  screen: string | null;
  platform: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  status: ReportStatus;
};

const FILTERS: Array<{ key: ReportStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "investigating", label: "Investigating" },
  { key: "fixed", label: "Fixed" },
  { key: "ignored", label: "Ignored" },
];

const NEXT_ACTIONS: Record<ReportStatus, Array<{ status: ReportStatus; label: string }>> = {
  new: [
    { status: "investigating", label: "Investigating" },
    { status: "fixed", label: "Fixed" },
    { status: "ignored", label: "Ignore" },
  ],
  investigating: [
    { status: "fixed", label: "Fixed" },
    { status: "new", label: "Back to new" },
    { status: "ignored", label: "Ignore" },
  ],
  fixed: [
    { status: "investigating", label: "Reopen" },
    { status: "ignored", label: "Ignore" },
  ],
  ignored: [
    { status: "new", label: "Back to new" },
    { status: "investigating", label: "Investigating" },
  ],
};

export default function AdminErrorReports() {
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReportStatus | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("app_error_reports")
      .select(
        "id, fingerprint, app_version, name, message, stack, screen, platform, occurrences, first_seen_at, last_seen_at, status"
      )
      .order("last_seen_at", { ascending: false })
      .limit(200);
    setError(loadError?.message ?? null);
    setRows((data ?? []) as unknown as Report[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: rows.length };
    for (const row of rows) tally[row.status] = (tally[row.status] ?? 0) + 1;
    return tally;
  }, [rows]);

  const setStatus = async (row: Report, status: ReportStatus) => {
    const previous = row.status;
    // Optimistic: the admin is on a phone on a train, and a round trip should
    // not decide whether the button responds.
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, status } : r)));
    const { error: updateError } = await supabase
      .from("app_error_reports")
      .update({ status })
      .eq("id", row.id);
    if (updateError) {
      setRows((current) => current.map((r) => (r.id === row.id ? { ...r, status: previous } : r)));
      toast.error(`Could not update that report: ${updateError.message}`);
    }
  };

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-3xl mx-auto">
      <div className="flex items-start gap-2">
        <Bug className="h-6 w-6 text-electric-purple mt-1" aria-hidden />
        <div>
          <h1 className="text-2xl font-display font-bold">App failures</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reported by the app itself. One row per distinct failure per build —
            the count beside each one is how many times testers hit it.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === f.key
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
            {counts[f.key] ? ` (${counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground mt-4">Loading…</p>}

      {/* An empty list from a denied policy looks exactly like an empty list, so
          the two are separated: this says which one you are looking at instead
          of letting a missing migration look like a healthy app. */}
      {error && (
        <Card className="mt-4 p-4 border-destructive/40">
          <p className="text-sm">
            <strong>Could not read the failure list.</strong> {error}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            If this says permission denied, the admin policies from
            20261010120000_app_error_reports.sql have not been applied yet.
          </p>
        </Card>
      )}

      {!loading && !error && shown.length === 0 && (
        <Card className="mt-4 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "No failures have been reported."
              : `Nothing in ${filter}.`}
          </p>
          {filter === "all" && (
            <p className="text-xs text-muted-foreground mt-2">
              Empty can mean two things, and only one of them is good: either
              nothing is throwing in the app, or the reports are not arriving.
              The second is worth ruling out — open a build and check that
              report-error is deployed with its JWT check off.
            </p>
          )}
        </Card>
      )}

      <div className="mt-4 space-y-2">
        {shown.map((row) => (
          <Card key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium break-words">
                  <span className="text-muted-foreground">{row.name}:</span>{" "}
                  {row.message}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {row.occurrences}× · {row.screen ?? "unknown screen"} · v
                  {row.app_version} ({row.platform}) · last{" "}
                  {formatDate(row.last_seen_at, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {row.first_seen_at !== row.last_seen_at &&
                    ` · first ${formatDate(row.first_seen_at, {
                      day: "numeric",
                      month: "short",
                    })}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  row.status === "new"
                    ? "bg-primary/15 text-primary"
                    : row.status === "fixed"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {row.status}
              </span>
            </div>

            {row.stack && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                  aria-expanded={open === row.id}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      open === row.id ? "rotate-180" : ""
                    }`}
                  />
                  {open === row.id ? "Hide frames" : "Show frames"}
                </button>
                {open === row.id && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                    {row.stack}
                  </pre>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {NEXT_ACTIONS[row.status].map((action) => (
                <button
                  key={action.status}
                  type="button"
                  onClick={() => setStatus(row, action.status)}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  {action.label}
                </button>
              ))}
              <span className="text-[11px] text-muted-foreground/70 ml-auto font-mono">
                {row.fingerprint.slice(0, 8)}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-4">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">What reaches this list.</strong>{" "}
          JavaScript failures only: an uncaught error, an unhandled promise
          rejection, a React render error. This is the app reporting itself —
          there is no crash-reporting SDK, which is what the published privacy,
          cookie and advertising documents promise. Tokens, addresses and health
          data are stripped before a report leaves a device.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          <strong className="text-foreground">What does not.</strong> A native
          crash — the Kotlin side, or the WebView process being killed — never
          reaches JavaScript and cannot appear here. Play Console's Android
          vitals reports those: look under Quality → Crashes and ANRs for the
          release the testers installed.
        </p>
      </Card>
    </div>
  );
}
