import { useState } from "react";
import { Image as ImageIcon, Video, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createCampaign, type Campaign } from "./api";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

const OBJECTIVES = ["awareness", "installs", "waitlist", "engagement"];

interface BriefState {
  name: string;
  objective: string;
  audience: string;
  platform: string;
  message: string;
  cta: string;
  budget: string;
  durationSeconds?: string;
}

function BriefForm({ format, onOpenChat }: { format: "image" | "video"; onOpenChat: () => void }) {
  const [brief, setBrief] = useState<BriefState>({
    name: "",
    objective: "awareness",
    audience: "",
    platform: format === "image" ? "instagram" : "tiktok",
    message: "",
    cta: "Join the waitlist",
    budget: "50",
    ...(format === "video" ? { durationSeconds: "15" } : {}),
  });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof BriefState, v: string) => setBrief((b) => ({ ...b, [k]: v }));

  const submit = async () => {
    if (saving) return;
    const duration = format === "video" ? Number(brief.durationSeconds) : undefined;
    if (format === "video" && (!duration || duration < 6 || duration > 60)) {
      setError("Video duration must be between 6 and 60 seconds.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const campaign = await createCampaign({
        name: brief.name.trim(),
        objective: brief.objective,
        audience: brief.audience.trim(),
        platform: brief.platform.toLowerCase().trim(),
        budget_usd: Number(brief.budget) || 0,
        message: brief.message.trim(),
        call_to_action: brief.cta.trim(),
        brief: { format, ...(duration ? { durationSeconds: duration } : {}), origin: `${format}-ads-entry` },
      });
      setCreated(campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the campaign.");
    } finally {
      setSaving(false);
    }
  };

  const invalid =
    !brief.name.trim() || !brief.audience.trim() || !brief.message.trim() || (format === "video" && (!Number(brief.durationSeconds) || Number(brief.durationSeconds) < 6 || Number(brief.durationSeconds) > 60));

  if (created) {
    return (
      <Card className={CARD}>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Brief saved — routed to the {format} workflow</span>
          </div>
          <p className="text-sm text-white/70">
            Campaign <span className="text-white">{created.name}</span> is stored with status{" "}
            <Badge variant="outline" className="border-white/20 text-white/80">{created.status}</Badge> on the real backend
            (campaign id <code className="text-[10px] text-white/50">{created.id}</code>). Asset generation for{" "}
            {format === "image" ? "images" : "video shots, narration and assembly"} runs in the specialist workflow stage
            when you press Run — there is no credit balance and nothing to approve first.
          </p>
          <div className="rounded-lg bg-white/5 p-3 text-xs text-white/60">
            Plan on record: {format === "image" ? "image generation with brand layout and text-overlay pass" : "script → narration → shots → assembly"} — each step reports live progress.
          </div>
          <button onClick={onOpenChat} className={`rounded-lg px-3 py-2 text-sm ${ACCENT}`}>
            Discuss this campaign with the assistant
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={CARD}>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          {format === "image" ? <ImageIcon className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          <h2 className="font-medium">{format === "image" ? "Create an image ad brief" : "Create a video ad brief"}</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Campaign name" value={brief.name} onChange={(v) => set("name", v)} placeholder="Launch tease — runners" />
          <Field label="Objective" value={brief.objective} onChange={(v) => set("objective", v)} placeholder="awareness" />
          <Field label="Audience" value={brief.audience} onChange={(v) => set("audience", v)} placeholder="Competitive runners 18-30" />
          <Field label="Platform" value={brief.platform} onChange={(v) => set("platform", v)} placeholder="instagram / tiktok / youtube" />
          {format === "video" && (
            <Field label="Duration (6–60 seconds)" value={brief.durationSeconds ?? ""} onChange={(v) => set("durationSeconds", v)} placeholder="15" />
          )}
          <Field label="Budget (USD)" value={brief.budget} onChange={(v) => set("budget", v)} placeholder="50" />
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/60">Main message</label>
          <textarea
            className="min-h-[70px] w-full rounded-lg bg-black/40 px-3 py-2 text-sm"
            value={brief.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Everyone tracks. Nobody scores you. Vaylo does."
          />
        </div>
        <Field label="Call to action" value={brief.cta} onChange={(v) => set("cta", v)} placeholder="Join the waitlist" />

        {error && (
          <p className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}

        <button onClick={submit} disabled={saving || invalid} className={`rounded-lg px-4 py-2 text-sm ${ACCENT} disabled:opacity-40`}>
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </span>
          ) : (
            "Save brief & route"
          )}
        </button>
        {!invalid && (
          <p className="text-xs text-white/40">
            Saving persists the real campaign on Supabase. No paid generation is triggered here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-white/60">{label}</label>
      <Input className="bg-black/40" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function ImageAdsView({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <BriefForm format="image" onOpenChat={onOpenChat} />
    </div>
  );
}

export function VideoAdsView({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <BriefForm format="video" onOpenChat={onOpenChat} />
    </div>
  );
}
