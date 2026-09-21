import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { BUILT_IN_EVENT_PACKS, EVENT_PACK_DIFFICULTIES } from "@/config/eventPacks";

type Row = {
  id?: string;
  pack_id: string;
  name: string;
  sport: string;
  category: string | null;
  target_event: string | null;
  description: string | null;
  weeks: number | null;
  price_cents: number | null;
  difficulty: string | null;
  designed_for: string | null;
  includes: string[] | null;
  version: string | null;
  future_updates_included: boolean | null;
  featured: boolean | null;
  sections: string[] | null;
  popularity: number | null;
  retired: boolean | null;
};

const blank = (): Row => ({
  pack_id: "", name: "", sport: "Running", category: "General", target_event: "",
  description: "", weeks: 8, price_cents: 1999, difficulty: "Intermediate",
  designed_for: "", includes: [], version: "1.0", future_updates_included: true,
  featured: false, sections: [], popularity: 50, retired: false,
});

export default function AdminEventPacks() {
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Row>(blank());
  const [importId, setImportId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("event_packs" as any).select("*").order("name");
    if (error) toast.error(error.message);
    setRows((data || []) as unknown as Row[]);
  };
  useEffect(() => { load(); }, []);

  const builtInMatches = useMemo(() => {
    const q = importId.trim().toLowerCase();
    if (!q) return [];
    return BUILT_IN_EVENT_PACKS.filter(
      (p) => p.id.includes(q) || p.name.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [importId]);

  const importBuiltIn = (id: string) => {
    const p = BUILT_IN_EVENT_PACKS.find((x) => x.id === id);
    if (!p) return;
    setDraft({
      pack_id: p.id, name: p.name, sport: p.sport, category: p.category,
      target_event: p.targetEvent, description: p.description, weeks: p.weeks,
      price_cents: p.priceCents, difficulty: p.difficulty, designed_for: p.designedFor,
      includes: p.includes, version: p.version, future_updates_included: p.futureUpdatesIncluded,
      featured: p.featured, sections: p.sections, popularity: p.popularity, retired: false,
    });
    setImportId("");
  };

  const save = async () => {
    if (!draft.pack_id.trim() || !draft.name.trim()) {
      toast.error("Pack ID and name are required");
      return;
    }
    setSaving(true);
    const { id, ...payload } = draft;
    const { error } = await supabase
      .from("event_packs" as any)
      .upsert(payload as any, { onConflict: "pack_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Event Pack saved"); setDraft(blank()); load(); }
  };

  const patch = async (pack_id: string, changes: Partial<Row>) => {
    const { error } = await supabase.from("event_packs" as any).update(changes as any).eq("pack_id", pack_id);
    if (error) toast.error(error.message); else load();
  };

  const set = (k: keyof Row, v: any) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="min-h-screen bg-background px-5 pb-24 pt-14">
      <h1 className="font-display text-2xl font-bold">Event Pack Management</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Rows here override built-in packs by Pack ID, or add brand-new packs. Retiring a pack hides it from
        the shop but existing owners keep lifetime access.
      </p>

      <Card className="mt-5 space-y-3 p-4">
        <h2 className="font-display text-sm font-bold">Create or edit a pack</h2>

        <div>
          <label className="text-[11px] text-muted-foreground">Start from a built-in pack (search name or id)</label>
          <Input value={importId} onChange={(e) => setImportId(e.target.value)} placeholder="e.g. Marathon" />
          {builtInMatches.length > 0 && (
            <div className="mt-2 space-y-1">
              {builtInMatches.map((p) => (
                <button key={p.id} onClick={() => importBuiltIn(p.id)}
                  className="block w-full rounded-lg border border-border px-2 py-1.5 text-left text-[11px]">
                  {p.name} · {p.sport} · {p.id}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Pack ID" value={draft.pack_id} onChange={(e) => set("pack_id", e.target.value)} />
          <Input placeholder="Name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          <Input placeholder="Sport" value={draft.sport} onChange={(e) => set("sport", e.target.value)} />
          <Input placeholder="Category" value={draft.category ?? ""} onChange={(e) => set("category", e.target.value)} />
          <Input placeholder="Target event" value={draft.target_event ?? ""} onChange={(e) => set("target_event", e.target.value)} />
          <Input type="number" placeholder="Weeks" value={draft.weeks ?? 0} onChange={(e) => set("weeks", Number(e.target.value))} />
          <Input type="number" placeholder="Price (cents)" value={draft.price_cents ?? 0} onChange={(e) => set("price_cents", Number(e.target.value))} />
          <Input placeholder="Version" value={draft.version ?? ""} onChange={(e) => set("version", e.target.value)} />
          <Input type="number" placeholder="Popularity 0-100" value={draft.popularity ?? 0} onChange={(e) => set("popularity", Number(e.target.value))} />
          <Input placeholder="Sections (comma separated)" value={(draft.sections ?? []).join(", ")}
            onChange={(e) => set("sections", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EVENT_PACK_DIFFICULTIES.map((d) => (
            <button key={d} onClick={() => set("difficulty", d)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                draft.difficulty === d ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
              }`}>{d}</button>
          ))}
        </div>

        <Textarea placeholder="Description" value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        <Textarea placeholder="Who this plan is designed for" value={draft.designed_for ?? ""} onChange={(e) => set("designed_for", e.target.value)} />
        <Textarea placeholder="What's included (one per line)" value={(draft.includes ?? []).join("\n")}
          onChange={(e) => set("includes", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />

        <div className="flex items-center justify-between text-xs">
          <span>Featured</span>
          <Switch checked={!!draft.featured} onCheckedChange={(v) => set("featured", v)} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>Future updates included</span>
          <Switch checked={!!draft.future_updates_included} onCheckedChange={(v) => set("future_updates_included", v)} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>Retired (hidden from shop, owners keep access)</span>
          <Switch checked={!!draft.retired} onCheckedChange={(v) => set("retired", v)} />
        </div>

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} className="flex-1">{saving ? "Saving…" : "Save pack"}</Button>
          <Button variant="outline" onClick={() => setDraft(blank())}>Clear</Button>
        </div>
      </Card>

      <h2 className="mt-6 font-display text-sm font-bold">Managed packs ({rows.length})</h2>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <Card key={r.pack_id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{r.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {r.pack_id} · {r.sport} · {r.difficulty} · ${((r.price_cents ?? 0) / 100).toFixed(2)} · v{r.version}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setDraft({ ...r })}>Edit</Button>
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px]">
              <label className="flex items-center gap-2">Featured
                <Switch checked={!!r.featured} onCheckedChange={(v) => patch(r.pack_id, { featured: v })} />
              </label>
              <label className="flex items-center gap-2">Retired
                <Switch checked={!!r.retired} onCheckedChange={(v) => patch(r.pack_id, { retired: v })} />
              </label>
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No overrides yet — the shop is showing the built-in catalogue.</p>
        )}
      </div>
    </div>
  );
}
