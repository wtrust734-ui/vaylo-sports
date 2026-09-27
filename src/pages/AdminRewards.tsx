import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RARITY_ORDER, type Rarity } from "@/lib/rewards";

export default function AdminRewards() {
  const [defs, setDefs] = useState<any[]>([]);
  const [cfg, setCfg] = useState<any>(null);

  const load = async () => {
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from("reward_definitions").select("*").order("rarity"),
      supabase.from("reward_config").select("*").eq("id", 1).maybeSingle(),
    ]);
    setDefs(d ?? []); setCfg(c);
  };
  useEffect(() => { load(); }, []);

  const saveCfg = async () => {
    const { error } = await supabase.from("reward_config").update({
      probabilities: cfg.probabilities,
      duplicate_conversion: cfg.duplicate_conversion,
    }).eq("id", 1);
    if (error) toast.error(error.message); else toast.success("Config saved");
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase.from("reward_definitions").update({ active }).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const changeRarity = async (id: string, rarity: Rarity) => {
    const { error } = await supabase.from("reward_definitions").update({ rarity }).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  if (!cfg) return <div className="p-6">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Admin · Rewards</h1>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Rarity probabilities (%)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {RARITY_ORDER.map(r => (
            <div key={r}>
              <label className="text-xs uppercase text-muted-foreground">{r}</label>
              <Input type="number" value={cfg.probabilities[r] ?? 0}
                onChange={e => setCfg({ ...cfg, probabilities: { ...cfg.probabilities, [r]: Number(e.target.value) } })}/>
            </div>
          ))}
        </div>
        <h2 className="mb-3 mt-6 font-semibold">Duplicate → credits conversion</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {RARITY_ORDER.map(r => (
            <div key={r}>
              <label className="text-xs uppercase text-muted-foreground">{r}</label>
              <Input type="number" value={cfg.duplicate_conversion[r] ?? 0}
                onChange={e => setCfg({ ...cfg, duplicate_conversion: { ...cfg.duplicate_conversion, [r]: Number(e.target.value) } })}/>
            </div>
          ))}
        </div>
        <Button className="mt-4" onClick={saveCfg}>Save config</Button>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Rewards ({defs.length})</h2>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-start text-xs text-muted-foreground">
              <tr><th className="p-2">Name</th><th>Type</th><th>Category</th><th>Rarity</th><th>Active</th></tr>
            </thead>
            <tbody>
              {defs.map(d => (
                <tr key={d.id} className="border-t border-muted/20">
                  <td className="p-2">{d.name}</td>
                  <td>{d.type}</td>
                  <td>{d.category}</td>
                  <td>
                    <select value={d.rarity} onChange={e => changeRarity(d.id, e.target.value as Rarity)}
                      className="rounded border bg-background px-1 py-0.5 text-xs">
                      {RARITY_ORDER.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td><Switch checked={d.active} onCheckedChange={v => toggleActive(d.id, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">To add or remove rewards, edit the <code>reward_definitions</code> table.</p>
      </Card>
    </div>
  );
}
