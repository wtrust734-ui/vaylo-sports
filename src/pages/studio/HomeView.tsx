import { useEffect, useState } from "react";
import { Image, Video, FlaskConical, MessageSquare, Loader2, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { listCampaigns, listLibrary, type Campaign, type LibraryItem } from "./api";
import type { StudioView } from "./StudioApp";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

export default function HomeView({ onNavigate }: { onNavigate: (v: StudioView) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listCampaigns().catch((e: Error) => (setError(e.message), [])), listLibrary().catch(() => [])]).then(
      ([c, i]) => {
        if (!alive) return;
        setCampaigns(c);
        setItems(i);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const actions: { view: StudioView; label: string; icon: typeof Image; desc: string }[] = [
    { view: "image", label: "Image ad", icon: Image, desc: "Static social ads, placements and variants" },
    { view: "video", label: "Video ad", icon: Video, desc: "15–60s spots: script, shots, voiceover, export" },
    { view: "research", label: "Research competitors", icon: FlaskConical, desc: "Evidence-led study before creating" },
    { view: "chat", label: "Creative Assistant", icon: MessageSquare, desc: "Describe what you want in plain words" },
  ];

  const loading = campaigns === null || items === null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Start with a sentence</h2>
        <p className="mt-1 text-sm text-white/60">
          Type what you want in the Creative Assistant, or pick a workflow below. Describe it in a
          sentence and it gets built.
        </p>
        <button
          onClick={() => onNavigate("chat")}
          className={`mt-3 w-full rounded-xl px-4 py-3 text-left text-sm text-white/60 ${CARD}`}
        >
          e.g. “Research Strava and Runna before creating a 15-second launch video”
        </button>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {actions.map((a) => (
          <button key={a.view} onClick={() => onNavigate(a.view)} className={`rounded-xl p-4 text-left ${CARD} hover:bg-white/10`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${ACCENT}`}>
                <a.icon className="h-4 w-4" />
              </span>
              <span className="font-medium">{a.label}</span>
            </div>
            <p className="mt-2 text-xs text-white/60">{a.desc}</p>
          </button>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Campaigns" value={campaigns?.length} loading={loading} />
        <SummaryTile label="Assets" value={items?.length} loading={loading} />
        <SummaryTile label="In planning" value={campaigns?.filter((c) => c.status === "planning").length} loading={loading} />
        <SummaryTile label="Approved" value={campaigns?.filter((c) => c.status === "approved" || c.status === "done").length} loading={loading} />
      </section>

      <section className={`rounded-xl p-4 ${CARD}`}>
        <h3 className="text-sm font-medium">Recent campaigns</h3>
        {error && (
          <p className="mt-2 flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
        {campaigns?.slice(0, 4).map((c) => (
          <button
            key={c.id}
            onClick={() => onNavigate("campaigns")}
            className="mt-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10"
          >
            <span className="truncate">{c.name}</span>
            <span className="ml-3 flex items-center gap-2 text-xs text-white/50">
              {c.platform} · {c.status}
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            </span>
          </button>
        ))}
        {campaigns && campaigns.length === 0 && !error && (
          <Card className="mt-2 border-none bg-transparent">
            <CardContent className="px-0 pb-0 text-xs text-white/50">
              No campaigns yet — create your first from Home or the chat.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function SummaryTile({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <CardHeader className={`rounded-xl ${CARD} px-4 py-3`}>
      <CardTitle className="text-xs font-normal text-white/60">{label}</CardTitle>
      <div className="mt-1 flex items-center gap-2 text-xl font-semibold">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-white/50" /> : value ?? 0}
      </div>
    </CardHeader>
  );
}
