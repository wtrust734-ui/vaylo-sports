import { useEffect, useState } from "react";
import { Megaphone, Pencil, Trash2, Loader2, AlertCircle, Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  type Campaign,
} from "./api";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

const STATUSES: Campaign["status"][] = ["draft", "planning", "approved", "rendering", "done", "failed"];
const OBJECTIVES = ["awareness", "installs", "waitlist", "engagement"];

function statusChip(status: Campaign["status"]) {
  const map: Record<Campaign["status"], string> = {
    draft: "bg-white/10 text-white/70",
    planning: "bg-blue-500/20 text-blue-300",
    approved: "bg-emerald-500/20 text-emerald-300",
    rendering: "bg-amber-500/20 text-amber-300",
    done: "bg-emerald-500/30 text-emerald-200",
    failed: "bg-red-500/20 text-red-300",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${map[status]}`}>{status}</span>;
}

interface Draft {
  name: string;
  objective: string;
  audience: string;
  platform: string;
  budget_usd: string;
  message: string;
  call_to_action: string;
  status: Campaign["status"];
  format: string;
}

const emptyDraft = (): Draft => ({
  name: "",
  objective: "awareness",
  audience: "",
  platform: "instagram",
  budget_usd: "50",
  message: "",
  call_to_action: "Join the waitlist",
  status: "draft",
  format: "image",
});

export default function CampaignsView() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; initial: Draft; id?: string } | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listCampaigns()
      .then((c) => {
        setCampaigns(c);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const startCreate = () => setEditing({ mode: "create", initial: emptyDraft() });

  const startEdit = (c: Campaign) =>
    setEditing({
      mode: "edit",
      id: c.id,
      initial: {
        name: c.name,
        objective: c.objective,
        audience: c.audience,
        platform: c.platform,
        budget_usd: String(c.budget_usd ?? 0),
        message: c.message,
        call_to_action: c.call_to_action,
        status: c.status,
        format: (c.brief?.format as string) ?? "image",
      },
    });

  const save = async (draft: Draft) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        objective: draft.objective,
        audience: draft.audience.trim(),
        platform: draft.platform.toLowerCase().trim(),
        budget_usd: Number(draft.budget_usd) || 0,
        message: draft.message.trim(),
        call_to_action: draft.call_to_action.trim(),
        status: draft.status,
        brief: { format: draft.format },
      };
      if (editing?.mode === "edit" && editing.id) await updateCampaign(editing.id, payload);
      else await createCampaign(payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the campaign.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteCampaign(deleting.id);
      setDeleting(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the campaign.");
    } finally {
      setBusy(false);
    }
  };

  const filtered = (campaigns ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.objective, c.audience, c.platform, c.status].some((f) => f?.toLowerCase().includes(q));
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
          <Input
            className="bg-black/40 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, audience, platform, status…"
          />
        </div>
        <button onClick={startCreate} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${ACCENT}`}>
          <Plus className="h-4 w-4" /> New campaign
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {campaigns === null && (
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading campaigns…
        </div>
      )}

      {campaigns !== null && filtered.length === 0 && (
        <Card className={`${CARD} p-6 text-center text-sm text-white/60`}>
          {campaigns.length === 0 ? "No campaigns yet." : "No campaigns match that search."}
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((c) => (
          <div key={c.id} className={`flex flex-wrap items-center gap-3 rounded-xl p-4 ${CARD}`}>
            <Megaphone className="h-4 w-4 text-white/50" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{c.name}</span>
                {statusChip(c.status)}
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                  {(c.brief?.format as string) ?? "—"}
                </span>
              </div>
              <p className="truncate text-xs text-white/50">
                {c.objective} · {c.audience} · {c.platform} · ${Number(c.budget_usd).toFixed(0)} ·{" "}
                {new Date(c.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => startEdit(c)}
                className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20"
                aria-label={`Edit ${c.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeleting(c)}
                className="rounded-lg bg-red-500/20 p-2 text-red-300 hover:bg-red-500/30"
                aria-label={`Delete ${c.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] w-[min(92vw,480px)] overflow-y-auto border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle>{editing?.mode === "edit" ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription className="text-white/50">
              Stored on Supabase with owner-scoped RLS; owner comes from your session, never from the form.
            </DialogDescription>
          </DialogHeader>
          {editing && <CampaignDraftForm draft={editing.initial} onSave={save} busy={busy} />}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)} aria-modal>
        <DialogContent className="w-[min(92vw,420px)] border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription className="text-white/50">
              The campaign and its concepts, assets and exports are removed permanently. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className="rounded-lg bg-white/10 px-3 py-2 text-sm">
              Cancel
            </button>
            <button onClick={confirmDelete} disabled={busy} className="rounded-lg bg-red-500 px-3 py-2 text-sm text-white disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete permanently"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignDraftForm({ draft, onSave, busy }: { draft: Draft; onSave: (d: Draft) => void; busy: boolean }) {
  const [form, setForm] = useState<Draft>(draft);
  const set = (k: keyof Draft, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const invalid = !form.name.trim() || !form.audience.trim() || !form.message.trim();

  return (
    <div className="space-y-3">
      <Row label="Name">
        <Input className="bg-black/40" value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Objective">
          <select className="rounded-lg bg-black/40 px-3 py-2 text-sm" value={form.objective} onChange={(e) => set("objective", e.target.value)}>
            {OBJECTIVES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Row>
        <Row label="Status">
          <select className="rounded-lg bg-black/40 px-3 py-2 text-sm" value={form.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Audience">
          <Input className="bg-black/40" value={form.audience} onChange={(e) => set("audience", e.target.value)} />
        </Row>
        <Row label="Platform">
          <Input className="bg-black/40" value={form.platform} onChange={(e) => set("platform", e.target.value)} />
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Budget (USD)">
          <Input className="bg-black/40" type="number" min="0" value={form.budget_usd} onChange={(e) => set("budget_usd", e.target.value)} />
        </Row>
        <Row label="Format">
          <select className="rounded-lg bg-black/40 px-3 py-2 text-sm" value={form.format} onChange={(e) => set("format", e.target.value)}>
            <option value="image">image</option>
            <option value="video">video</option>
          </select>
        </Row>
      </div>
      <Row label="Main message">
        <textarea
          className="min-h-[60px] w-full rounded-lg bg-black/40 px-3 py-2 text-sm"
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
        />
      </Row>
      <Row label="Call to action">
        <Input className="bg-black/40" value={form.call_to_action} onChange={(e) => set("call_to_action", e.target.value)} />
      </Row>
      <div className="flex justify-end">
        <button disabled={busy || invalid} onClick={() => onSave(form)} className={`rounded-lg px-4 py-2 text-sm ${ACCENT} disabled:opacity-40`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save campaign"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-white/60">{label}</label>
      {children}
    </div>
  );
}
