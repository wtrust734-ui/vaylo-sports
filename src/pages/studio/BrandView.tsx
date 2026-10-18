import { useEffect, useState } from "react";
import { Palette, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchBrand, saveBrand, type BrandConfig } from "./api";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

export default function BrandView() {
  const [brand, setBrand] = useState<BrandConfig | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrand()
      .then(({ brand: b, isDefault: d }) => {
        setBrand(b);
        setIsDefault(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof BrandConfig>(k: K, v: BrandConfig[K]) => {
    setBrand((b) => (b ? { ...b, [k]: v } : b));
    setSaved(false);
  };

  const save = async () => {
    if (!brand || saving) return;
    setSaving(true);
    setError(null);
    try {
      const merged = await saveBrand(brand);
      setBrand(merged);
      setIsDefault(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save brand settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/50">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading brand settings…
      </div>
    );
  }
  if (!brand) {
    return (
      <p className="flex items-center gap-2 text-xs text-red-400">
        <AlertCircle className="h-3.5 w-3.5" /> {error ?? "Brand settings unavailable."}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className={CARD}>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              <h2 className="font-medium">Vaylo Sports brand configuration</h2>
            </div>
            {isDefault ? (
              <Badge variant="outline" className="border-white/20 text-[10px] text-white/70">
                seeded defaults
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-300">
                customised
              </Badge>
            )}
          </div>
          <p className="text-xs text-white/50">
            One source of truth: chat routing, the image/video/research workflows and the render layer all read
            this config (stored per-owner on Supabase; merged over server defaults).
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Brand name" value={brand.name} onChange={(v) => set("name", v)} />
            <Field label="Slogan" value={brand.slogan} onChange={(v) => set("slogan", v)} />
            <Field label="Positioning" value={brand.positioning} onChange={(v) => set("positioning", v)} />
            <Field label="Typography" value={brand.typography} onChange={(v) => set("typography", v)} />
          </div>

          <Area label="Description" value={brand.description} onChange={(v) => set("description", v)} />
          <Area label="Target audience" value={brand.targetAudience} onChange={(v) => set("targetAudience", v)} />
          <Area label="Tone of voice" value={brand.toneOfVoice} onChange={(v) => set("toneOfVoice", v)} />

          <div className="grid grid-cols-3 gap-3">
            <ColorField label="Black" value={brand.colors.black} onChange={(v) => set("colors", { ...brand.colors, black: v })} />
            <ColorField label="Navy" value={brand.colors.navy} onChange={(v) => set("colors", { ...brand.colors, navy: v })} />
            <ColorField label="Purple" value={brand.colors.purple} onChange={(v) => set("colors", { ...brand.colors, purple: v })} />
          </div>

          <ListField
            label="Approved calls to action"
            list={brand.approvedCtas}
            onChange={(v) => set("approvedCtas", v)}
          />
          <ListField
            label="Prohibited claims"
            list={brand.prohibitedClaims}
            onChange={(v) => set("prohibitedClaims", v)}
          />

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className={`rounded-lg px-4 py-2 text-sm ${ACCENT} disabled:opacity-40`}>
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </span>
              ) : (
                "Save brand settings"
              )}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            {error && (
              <span className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-white/60">{label}</label>
      <Input className="bg-black/40" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-white/60">{label}</label>
      <textarea className="min-h-[60px] w-full rounded-lg bg-black/40 px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-white/60">{label}</label>
      <div className="flex items-center gap-2">
        <Input className="bg-black/40" value={value} onChange={(e) => onChange(e.target.value)} />
        <RefreshCw className="hidden h-3 w-3" />
      </div>
      <div className="mt-1 h-2 w-full rounded" style={{ background: value }} />
    </div>
  );
}

function ListField({ label, list, onChange }: { label: string; list: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState<string>(list.join("\n"));
  useEffect(() => {
    setText(list.join("\n"));
  }, [list]);
  return (
    <div>
      <label className="mb-1 block text-xs text-white/60">{label} (one per line)</label>
      <textarea
        className="min-h-[90px] w-full rounded-lg bg-black/40 px-3 py-2 text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean));
        }}
      />
    </div>
  );
}
