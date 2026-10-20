// ============================================================================
// ImageAdsView — the real image-ad creation flow, wired to ads-image.
// ----------------------------------------------------------------------------
// Flow: brief (+ optional research linkage) → concept cards (select one)
//   → REAL background generation on the chosen placements → deterministic
//   compose (render worker) → preview/revise/export.
// Rules the prompt sets and this file keeps:
//   • every "generated/composed" state on screen comes from the backend;
//     a failed provider call shows the honest reason and the retry stays on
//     the SAME project (brief and concepts are never lost);
//   • text changed by the user recomposes from the SAME background without
//     spending provider budget; visual changes go through the edit provider;
//   • placement switching recomposes per format instead of stretching;
//   • downloads use fresh signed URLs — never a public link.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Loader2, Sparkles, Download, RefreshCw, Layers, AlertCircle, CheckCircle2, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  startImageProject,
  generateConcepts,
  selectConcept,
  generateBackgrounds,
  composeAd,
  imageProjectStatus,
  reviseAd,
  exportAd,
  type ArtifactView,
  type StoredConcept,
} from "./imageAdsApi";
import { listResearchProjects } from "./researchApi";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";
const SURFACE = "bg-white/5 border border-white/10";

const PLACEMENT_LABELS: { id: string; label: string }[] = [
  { id: "ig_feed_portrait", label: "IG Feed 4:5" },
  { id: "ig_feed_square", label: "IG/FB Square 1:1" },
  { id: "ig_story_reels", label: "IG Story/Reels 9:16" },
  { id: "tiktok_static", label: "TikTok 9:16" },
  { id: "fb_feed_portrait", label: "FB Feed 4:5" },
  { id: "youtube_thumbnail", label: "YT Thumbnail 16:9" },
];

// ---------------------------------------------------------------------------
// Phase 1: the brief
// ---------------------------------------------------------------------------

function BriefForm({ onCreated }: { onCreated: (projectId: string) => void }) {
  const [request, setRequest] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("waitlist signups");
  const [cta, setCta] = useState("Join the waitlist");
  const [researchId, setResearchId] = useState<string>("");
  const [researchProjects, setResearchProjects] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listResearchProjects().then((rows) => setResearchProjects(rows.slice(0, 8))).catch(() => setResearchProjects([]));
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await startImageProject({
        request: request.trim(),
        message: message.trim() || undefined,
        audience: audience.trim() || undefined,
        objective,
        cta,
        researchProjectId: researchId || null,
      });
      onCreated(p.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={CARD}>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          <h2 className="font-medium">New image ad</h2>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">What should the ad promote?</label>
          <textarea
            className="min-h-[70px] w-full rounded-lg bg-black/40 px-3 py-2 text-sm"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Create a premium-looking ad for 1500m runners promoting Vaylo Coach."
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-white/60">Main message (optional)</label>
            <Input className="bg-black/40" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Everyone tracks. Nobody scores you." />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Audience (optional)</label>
            <Input className="bg-black/40" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Competitive runners 18-30" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Call to action</label>
            <Input className="bg-black/40" value={cta} onChange={(e) => setCta(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Use competitor research (optional)</label>
            <select
              className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm"
              value={researchId}
              onChange={(e) => setResearchId(e.target.value)}
            >
              <option value="">No saved research</option>
              {researchProjects.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="flex items-center gap-2 text-xs text-red-400"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>}
        <button
          onClick={submit}
          disabled={busy || request.trim().length < 4}
          className={`rounded-lg px-4 py-2 text-sm ${ACCENT} disabled:opacity-40`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start project"}
        </button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: concepts
// ---------------------------------------------------------------------------

function ConceptCards({
  projectId,
  concepts,
  onSelected,
}: {
  projectId: string;
  concepts: StoredConcept[];
  onSelected: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await selectConcept(projectId, id);
      onSelected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not select the concept");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm text-white/70"><Sparkles className="h-4 w-4" /> Concepts — pick one to produce</h3>
      {concepts.map((c) => {
        const p = c.payload;
        const selected = c.status === "selected";
        return (
          <Card key={c.id} className={`${selected ? "border-[#8505D5]" : ""} ${CARD}`}>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-medium">{p.headline}</span>
                  {p.supportingCopy && <p className="text-white/60">{p.supportingCopy}</p>}
                </div>
                <Badge variant="outline" className="shrink-0 border-white/20 text-white/70">#{c.concept_number}</Badge>
              </div>
              <p className="text-xs text-white/50"><span className="text-white/70">Angle:</span> {p.angle}</p>
              <p className="text-xs text-white/50"><span className="text-white/70">Visual:</span> {p.visualDirection}</p>
              <p className="text-xs text-white/50"><span className="text-white/70">Why it appeals:</span> {p.appeal}</p>
              <div className="flex flex-wrap items-center gap-1 pb-1 pt-1">
                {p.placements.map((pl) => (
                  <Badge key={pl} variant="outline" className="border-white/10 text-[10px] text-white/50">
                    {PLACEMENT_LABELS.find((x) => x.id === pl)?.label ?? pl}
                  </Badge>
                ))}
                {p.evidenceRefs.length > 0 && (
                  <Badge variant="outline" className="border-white/10 text-[10px] text-white/50">
                    evidence ×{p.evidenceRefs.length}
                  </Badge>
                )}
              </div>
              <button
                onClick={() => pick(c.id)}
                disabled={busyId !== null || selected}
                className={`rounded-lg px-3 py-1.5 text-xs ${selected ? "bg-emerald-600/80" : ACCENT} disabled:opacity-60`}
              >
                {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                {selected ? " Selected" : " Use this concept"}
              </button>
            </CardContent>
          </Card>
        );
      })}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 3: artifacts
// ---------------------------------------------------------------------------

function ArtifactCard({
  artifact,
  onRecompose,
  onVisualRevise,
  onExport,
}: {
  artifact: ArtifactView;
  onRecompose: (a: ArtifactView) => void;
  onVisualRevise: (a: ArtifactView, instruction: string) => void;
  onExport: (a: ArtifactView) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const isComposed = artifact.stage === "composed";
  const failed = artifact.status === "failed";
  return (
    <Card className={CARD}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="border-white/20 text-white/70">{artifact.artifactKind}</Badge>
            <Badge variant="outline" className="border-white/10 text-[10px] text-white/50">{artifact.placementId}</Badge>
            <span className="text-white/40">{artifact.width}×{artifact.height}</span>
          </div>
          <span className={failed ? "text-red-400" : isComposed ? "text-emerald-400" : "text-amber-300"}>
            {failed ? "failed" : artifact.status}
          </span>
        </div>
        {failed && artifact.failureReason && <p className="text-xs text-red-400">{artifact.failureReason}</p>}
        {artifact.downloadUrl && (
          <img src={artifact.downloadUrl} alt={`Ad ${artifact.placementId}`} className="max-h-64 w-auto rounded-lg border border-white/10" />
        )}
        {!isComposed && artifact.status === "ready" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => onRecompose(artifact)} className={`rounded-lg px-3 py-1.5 text-xs ${ACCENT}`}>
              <Layers className="mr-1 inline h-3.5 w-3.5" /> Compose with brand text
            </button>
          </div>
        )}
        <details className="text-xs text-white/60">
          <summary className="cursor-pointer"><Pencil className="mr-1 inline h-3 w-3" /> Revise</summary>
          <div className="mt-2 space-y-2">
            <Input
              className="bg-black/40"
              placeholder="Visual change, e.g. a dawn track session instead of night"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button
              onClick={() => onVisualRevise(artifact, instruction)}
              disabled={!instruction.trim()}
              className={`rounded-lg px-3 py-1.5 text-xs ${ACCENT} disabled:opacity-40`}
            >
              Ask for a variant
            </button>
            <p className="text-[10px] text-white/40">Headline and CTA edits recompose from this background without regenerating it (change them in the concept's compose form).</p>
          </div>
        </details>
        <button onClick={() => onExport(artifact)} className="pt-1 text-xs text-white/70 underline hover:text-white">
          <Download className="mr-1 inline h-3.5 w-3.5" /> Open full-resolution export
        </button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

export default function ImageAdsView({ onOpenChat }: { onOpenChat: () => void }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof imageProjectStatus>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const s = await imageProjectStatus(id);
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the project");
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const t = setInterval(() => refresh(projectId), 4000);
    refresh(projectId);
    return () => clearInterval(t);
  }, [projectId, refresh]);

  const act = async (key: string, fn: () => Promise<void>, refetchId?: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (refetchId) await refresh(refetchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The step failed — retry stays safe.");
    } finally {
      setBusy(null);
    }
  };

  if (!projectId) {
    return (
      <div className="mx-auto max-w-3xl">
        <BriefForm onCreated={(id) => { setProjectId(id); generateConcepts(id, 3).catch(() => {}); }} />
      </div>
    );
  }

  const s = status;
  const selected = s?.concepts.find((c) => c.status === "selected") ?? null;
  const originals = (s?.artifacts ?? []).filter((a) => a.artifactKind === "original" && a.parentArtifactId === null);
  const composed = (s?.artifacts ?? []).filter((a) => a.artifactKind === "composed" || (a.artifactKind === "variant" && a.stage === "composed"));
  const variants = (s?.artifacts ?? []).filter((a) => a.artifactKind === "variant" && a.stage === "generated");
  const jobs = s?.jobs ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className={SURFACE}>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <div className="min-w-0">
            <p className="truncate text-white/80">{s?.project.request ?? "…"}</p>
            <p className="text-xs text-white/50">
              Project <code className="text-[10px]">{projectId.slice(0, 8)}…</code>
              {s?.project.status ? ` · ${s.project.status}` : ""}
              {selected ? ` · concept #${selected.concept_number} selected` : ""}
            </p>
          </div>
          <button onClick={() => act("concepts", async () => { await generateConcepts(projectId, 3); await refresh(projectId); }, projectId)} disabled={busy !== null} className={`rounded-lg px-3 py-1.5 text-xs ${ACCENT} disabled:opacity-40`}>
            {busy === "concepts" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 inline h-3.5 w-3.5" />} New concepts
          </button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border border-red-500/30"><CardContent className="flex items-center gap-2 p-3 text-sm text-red-300"><AlertCircle className="h-4 w-4" /> {error} <button className="underline" onClick={() => setError(null)}>dismiss</button></CardContent></Card>
      )}

      {s && s.concepts.length > 0 && !selected && (
        <ConceptCards projectId={projectId} concepts={s.concepts} onSelected={() => refresh(projectId)} />
      )}

      {selected && originals.length === 0 && (
        <Card className={CARD}>
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="text-white/70">Concept #{selected.concept_number} selected. Produce backgrounds for:</p>
            <div className="flex flex-wrap gap-1">
              {PLACEMENT_LABELS.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => act(`gen-${pl.id}`, async () => { await generateBackgrounds(projectId, [pl.id]); await refresh(projectId); }, projectId)}
                  disabled={busy !== null}
                  className={`rounded-lg px-3 py-1.5 text-xs ${ACCENT} disabled:opacity-40`}
                >
                  {busy === `gen-${pl.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {pl.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/40">Each generation quotes one provider image into usage tracking; nothing here spends without that cost line appearing in the artifact's metadata.</p>
          </CardContent>
        </Card>
      )}

      {jobs.length > 0 && (
        <Card className={CARD}>
          <CardContent className="space-y-1 p-4 text-xs text-white/60">
            {jobs.map((j) => (
              <p key={j.jobId}>
                compose {j.placementId}: <span className={j.status === "failed" ? "text-red-400" : j.status === "done" ? "text-emerald-400" : ""}>{j.status}</span>
                {j.error ? ` — ${j.error}` : ""}
                {j.bytes ? ` — ${Math.round(j.bytes / 1024)} KiB` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {originals.map((a) => (
          <ArtifactCard
            key={a.id}
            artifact={a}
            onRecompose={(art) => act(`c-${art.id}`, async () => {
              const concept = selected?.payload;
              await composeAd(projectId, art.id, concept ? { headline: concept.headline, supportingCopy: concept.supportingCopy, cta: concept.cta } : undefined);
              await refresh(projectId);
            }, projectId)}
            onVisualRevise={(art, instruction) => act(`v-${art.id}`, async () => {
              const r = await reviseAd(art.id, { visualInstruction: instruction });
              if (r.kind === "variant") await composeAd(projectId, r.variantArtifactId);
              await refresh(projectId);
            }, projectId)}
            onExport={async (art) => {
              try {
                const out = await exportAd(art.id);
                if (out.downloadUrl) window.open(out.downloadUrl, "_blank");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Export failed");
              }
            }}
          />
        ))}
        {variants.map((a) => (
          <ArtifactCard
            key={a.id}
            artifact={a}
            onRecompose={async (art) => {
              await composeAd(projectId, art.id);
              await refresh(projectId);
            }}
            onVisualRevise={async (art, instruction) => {
              const r = await reviseAd(art.id, { visualInstruction: instruction });
              if (r.kind === "variant") await composeAd(projectId, r.variantArtifactId);
              await refresh(projectId);
            }}
            onExport={async (art) => {
              const out = await exportAd(art.id);
              if (out.downloadUrl) window.open(out.downloadUrl, "_blank");
            }}
          />
        ))}
      </div>

      {composed.length > 0 && (
        <p className="text-xs text-white/50">Finished ads are composed to the exact placement size — the same background recomposed per format, never stretched.</p>
      )}

      <div>
        <button onClick={onOpenChat} className="text-xs text-white/50 underline hover:text-white">
          Discuss this project with the assistant
        </button>
      </div>
    </div>
  );
}
