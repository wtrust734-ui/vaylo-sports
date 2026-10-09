import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Download, Mail, UserMinus2, UserPlus2 } from "lucide-react";

/**
 * The waiting list, as the operator sees it.
 *
 * Route-level access is decided by RequireAdmin in App.tsx, but that only
 * decides what to DRAW — the real authorization is the RLS policy added in
 * 20261004140000_waitlist_admin_access.sql, which is the only reason this query
 * returns anything at all. A non-admin rendering this page by any means gets an
 * empty list, not somebody else's addresses.
 *
 * Two things about the shape of this screen are deliberate:
 *
 *   * It shows the whole list, not a paged slice. A waiting list for an app
 *     that is not released yet is tens or hundreds of rows, and an operator
 *     who has to page through it will export it and work somewhere else — where
 *     the data is outside our controls. Search is here instead.
 *
 *   * Removal sets a timestamp rather than deleting the row, matching the
 *     published terms and the schema: "we will delete your address" is honoured
 *     by marking it, and the record of the request survives. The address stops
 *     being used; it is not left in a state anybody has to guess about.
 */
type Signup = {
  id: string;
  email: string;
  display_name: string | null;
  source: string;
  created_at: string;
  unsubscribed_at: string | null;
};

export default function AdminWaitlist() {
  const [rows, setRows] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("waitlist_signups")
      .select("id, email, display_name, source, created_at, unsubscribed_at")
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setError(null);
    setRows((data ?? []) as unknown as Signup[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const active = useMemo(() => rows.filter((r) => !r.unsubscribed_at), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = showRemoved ? rows : active;
    if (!q) return base;
    return base.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        (r.display_name ?? "").toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q)
    );
  }, [rows, active, query, showRemoved]);

  const setRemoved = async (row: Signup, removed: boolean) => {
    const value = removed ? new Date().toISOString() : null;
    const { error: updateError } = await supabase
      .from("waitlist_signups")
      .update({ unsubscribed_at: value })
      .eq("id", row.id);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success(removed ? "Marked as removed" : "Back on the list");
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, unsubscribed_at: value } : r))
    );
  };

  /**
   * Copy the addresses that are actually on the list.
   *
   * Only the active ones, one per line, so this can be pasted straight into
   * whatever sends the announcement. Removed addresses are excluded here rather
   * than filtered later by hand, because "we deleted your address" has to be
   * true of the thing an operator actually uses.
   */
  const copyAll = async () => {
    const text = active.map((r) => r.email).join("\n");
    if (!text) {
      toast.error("No addresses to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(`Copied ${active.length} address${active.length === 1 ? "" : "es"}`);
    } catch {
      toast.error("The clipboard is not available here.");
    }
  };

  const downloadCsv = () => {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["email", "name", "source", "joined", "removed"].join(","),
      ...active.map((r) =>
        [r.email, r.display_name ?? "", r.source, r.created_at, ""].map(escape).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vaylo-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-electric-purple" /> Waiting list
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everyone who asked to be told when the Android release opens.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copyAll} disabled={!active.length}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-1.5">Copy all</span>
          </Button>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!active.length}>
            <Download className="h-4 w-4" />
            <span className="ml-1.5">CSV</span>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search address, name or source"
          aria-label="Search the waiting list"
          className="max-w-xs"
        />
        <button
          type="button"
          onClick={() => setShowRemoved((v) => !v)}
          aria-pressed={showRemoved}
          className="text-xs font-semibold text-muted-foreground underline"
        >
          {showRemoved ? "Hide removed" : `Show removed (${rows.length - active.length})`}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        <strong className="text-foreground">{active.length}</strong> on the list
        {rows.length - active.length > 0 && ` · ${rows.length - active.length} removed`}
      </p>

      {loading && <p className="text-sm text-muted-foreground mt-4">Loading…</p>}

      {/* An empty list from a denied policy is indistinguishable from an empty
          list, so the two are separated: this says which one you are looking
          at rather than letting a broken permission look like no signups. */}
      {error && (
        <Card className="mt-4 p-4 border-destructive/40">
          <p className="text-sm">
            <strong>Could not read the list.</strong> {error}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            If this says permission denied, the admin policy from
            20261004140000_waitlist_admin_access.sql has not been applied yet.
          </p>
        </Card>
      )}

      {!loading && !error && shown.length === 0 && (
        <Card className="mt-4 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {query ? "No signups match that search." : "Nobody has joined the waiting list yet."}
          </p>
        </Card>
      )}

      <div className="mt-4 space-y-2">
        {shown.map((row) => (
          <Card
            key={row.id}
            className="p-4 flex items-start justify-between gap-4"
            data-removed={row.unsubscribed_at ? "true" : "false"}
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{row.email}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {row.display_name ? `${row.display_name} · ` : ""}
                {row.source} · joined{" "}
                {new Date(row.created_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {row.unsubscribed_at && " · removed"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRemoved(row, !row.unsubscribed_at)}
              className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            >
              {row.unsubscribed_at ? (
                <>
                  <UserPlus2 className="h-3.5 w-3.5" /> Restore
                </>
              ) : (
                <>
                  <UserMinus2 className="h-3.5 w-3.5" /> Mark removed
                </>
              )}
            </button>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-4">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Removing someone</strong> marks the row
          rather than deleting it, which is what the published waiting-list terms
          describe: the address stops being used and the request is still
          auditable. Removed addresses are excluded from Copy all and from the
          CSV, so the list you send to is the list that asked to be on it.
        </p>
      </Card>
    </div>
  );
}