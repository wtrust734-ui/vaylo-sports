// ============================================================================
// VideoAdsView — the real video-ad creation flow, wired to ads-video.
// ----------------------------------------------------------------------------
// Flow: brief → REAL concept (script + storyboard via Gemini) → per-shot Veo
// generation with a hard quote-then-confirm cost gate → narration via the
// verified ElevenLabs endpoint → render dispatch to the worker.
// Honesty rules kept from the image side:
//   • every "generated" state comes from the backend — never a fake success;
//   • a failed shot stays in the list and is retryable, nothing is lost;
//   • the render step shows exactly what is missing when it cannot run and
//     never claims a video exists that was not stored;
//   • the render worker is NOT currently hosted on this deployment, so the
//     render button reports that precisely instead of pretending.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Video as VideoIcon, Loader2, Sparkles, AlertCircle, CheckCircle2, XCircle, Mic, Download, RefreshCw, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  generateVideoConcept,
  quoteShot,
  startShot,
  pollShot,
  validateVoiceover,
  generateVoiceover,
  uploadNarration,
  renderVideo,
  jobStatus,
  type VideoConceptResult,
  type ShotQuote,
  type VideoStoryboardScene,
} from "./videoAdsApi";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

interface ShotRow {
  scene: VideoStoryboardScene;
  videoUri: string | null;
  state: "pending" | "quoting" | "awaiting_confirm" | "generating" | "ready" | "failed";
  quote?: ShotQuote;
  error?: string | null;
  shotId?: string;
  operationId?: string;
}

type Step = "brief" | "concept" | "shots" | "voice" | "render";

export default function VideoAdsView({ onOpenChat }: { onOpenChat: () => void }) {
  // ------------------------------------------------------------------ brief
  const [request, setRequest] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("15");
  const [callToAction, setCallToAction] = useState("Join the waitlist");
  const [step, setStep] = useState<Step>("brief");
  const [concept, setConcept] = useState<VideoConceptResult | null>(null);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [narrationPath, setNarrationPath] = useState<string | null>(null);
  const [voiceCharacters, setVoiceCharacters] = useState<number | null>(null);
  const [renderJob, setRenderJob] = useState<{ jobId: string; state: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  const duration = Number(durationSeconds);
  const durInvalid = !duration || duration < 6 || duration > 60;

  // ------------------------------------------------------------ concept
  const createConcept = async () => {
    if (busy) return;
    setBusy("concept");
    setError(null);
    try {
      const c = await generateVideoConcept({ prompt: request.trim(), durationSeconds: duration, callToAction: callToAction.trim() || "Join the waitlist" });
      setConcept(c);
      setShots(c.storyboard.map((scene) => ({ scene, videoUri: scene.source || null, state: "pending" })));
      setStep("concept");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Concept generation failed.");
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------ shots
  const refreshOne = useCallback(async (index: number, shotId: string, operationId: string) => {
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        const p = await pollShot(shotId, operationId);
        setShots((rows) => rows.map((r, i) => (i === index ? { ...r, state: p.done ? (p.state === "failed" ? "failed" : "ready") : "generating", videoUri: p.videoUri ?? r.videoUri, error: p.error ?? null } : r)));
        if (p.done) return;
      } catch (e) {
        setShots((rows) => rows.map((r, i) => (i === index ? { ...r, state: "failed", error: e instanceof Error ? e.message : "poll failed" } : r)));
        return;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    setShots((rows) => rows.map((r, i) => (i === index ? { ...r, state: "failed", error: "The shot is still running after ~100 s; retry to re-check." } : r)));
  }, []);

  const quoteOneShot = async (index: number) => {
    if (!concept || busy) return;
    setBusy(`quote-${index}`);
    setError(null);
    try {
      const q = await quoteShot({
        conceptId: concept.conceptId,
        shot: shots[index].scene.shot,
        placement: "reels",
      });
      setShots((rows) => rows.map((r, i) => (i === index ? { ...r, state: "awaiting_confirm", quote: q } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get a cost quote.");
    } finally {
      setBusy(null);
    }
  };

  const confirmOneShot = async (index: number) => {
    const row = shots[index];
    if (!row.quote || busy) return;
    setBusy(`start-${index}`);
    setError(null);
    try {
      const s = await startShot(row.quote);
      setShots((rows) => rows.map((r, i) => (i === index ? { ...r, state: "generating", shotId: s.shotId, operationId: s.operationId, quote: undefined } : r)));
      void refreshOne(index, s.shotId, s.operationId);
    } catch (e) {
      setShots((rows) => rows.map((r, i) => (i === index ? { ...r, state: "failed", error: e instanceof Error ? e.message : "start failed" } : r)));
    } finally {
      setBusy(null);
    }
  };

  const readyShots = shots.filter((s) => s.state === "ready").length;
  const failedShots = shots.filter((s) => s.state === "failed").length;

  // ------------------------------------------------------------ voiceover
  const makeVoiceover = async () => {
    if (!concept || busy) return;
    setBusy("voice");
    setError(null);
    try {
      const quote = await validateVoiceover(concept.concept.script);
      if (!quote.valid) throw new Error("The script fails the voiceover brand checks; revise it first.");
      setVoiceCharacters(quote.characters);
      const audio = await generateVoiceover({ text: concept.concept.script });
      const path = await uploadNarration(audio.audio, audio.mimeType);
      setNarrationPath(path);
      setStep("render");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Narration generation failed.");
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------ render
  const doRender = async () => {
    if (!concept || busy) return;
    setBusy("render");
    setError(null);
    try {
      const missing = shots.filter((s) => !s.videoUri);
      if (readyShots < shots.length && !missing.length) {
        throw new Error("All shots must be ready before the render can be requested.");
      }
      const assetPaths: Record<string, string> = {};
      for (const s of shots) if (s.videoUri) assetPaths[String(s.scene.shot)] = s.videoUri;
      const j = await renderVideo({
        conceptId: concept.conceptId,
        voiceover: concept.concept.script,
        captions: concept.captions,
        narrationPath,
        assetPaths,
      });
      setRenderJob({ jobId: j.jobId, state: j.state });
      pollTimer.current = setInterval(async () => {
        try {
          const st = await jobStatus(j.jobId);
          setRenderJob({ jobId: j.jobId, state: st.status });
          if (st.status === "done" || st.status === "failed") {
            if (pollTimer.current) clearInterval(pollTimer.current);
            if (st.status === "done" && st.publicUrl) window.open(st.publicUrl, "_blank");
          }
        } catch {
          // keep polling; the next tick retries
        }
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render could not start.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* -------- brief -------- */}
      {step === "brief" && (
        <Card className={CARD}>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <VideoIcon className="h-5 w-5" />
              <h2 className="font-medium">New video ad — real pipeline</h2>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">What should the ad show?</label>
              <textarea
                className="min-h-[70px] w-full rounded-lg bg-black/40 px-3 py-2 text-sm"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Athlete premium spot: blue-hour track session, measured and confident."
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/60">Duration (6–60 s)</label>
                <Input className="bg-black/40" type="number" min={6} max={60} value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Call to action</label>
                <Input className="bg-black/40" value={callToAction} onChange={(e) => setCallToAction(e.target.value)} />
              </div>
            </div>
            <p className="text-[10px] text-white/40">
              The concept step is free text generation (no Veo spend). Each Veo shot is quoted separately and only generated after you confirm the cost. The render step needs a hosted render worker — its availability is shown honestly below.
            </p>
            <button onClick={createConcept} disabled={busy !== null || request.trim().length < 4 || durInvalid} className={`rounded-lg px-4 py-2 text-sm ${ACCENT} disabled:opacity-40`}>
              {busy === "concept" ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null} Write the concept
            </button>
            {durInvalid && <p className="text-xs text-red-400">Duration must be between 6 and 60 seconds.</p>}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border border-red-500/30">
          <CardContent className="flex items-start gap-2 p-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
            <button className="ml-auto shrink-0 underline" onClick={() => setError(null)}>dismiss</button>
          </CardContent>
        </Card>
      )}

      {/* -------- concept -------- */}
      {concept && (
        <Card className={CARD}>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-medium">Concept</span>
              <Badge variant="outline" className="border-white/20 text-white/70">
                storyboard: {concept.storyboardSource === "model" ? "model" : "deterministic fallback"}
              </Badge>
              <Badge variant="outline" className="border-white/10 text-[10px] text-white/50">id {concept.conceptId.slice(0, 8)}…</Badge>
            </div>
            <p><span className="text-white/60">Hook:</span> {concept.concept.hook}</p>
            <p><span className="text-white/60">Core message:</span> {concept.concept.message}</p>
            <p className="whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs text-white/80">{concept.concept.script}</p>
            <div className="flex flex-wrap gap-1">
              {concept.captions.map((c, i) => (
                <Badge key={i} variant="outline" className="border-white/10 text-[10px] text-white/60">
                  {c.startSeconds}s–{c.endSeconds}s · {c.text}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* -------- shots -------- */}
      {concept && (
        <Card className={CARD}>
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-medium"><ClipboardList className="h-4 w-4" /> Shots ({readyShots}/{shots.length} ready{failedShots ? `, ${failedShots} failed` : ""})</h3>
              <span className="text-[10px] text-white/40">Each shot is one Veo generation, quoted before spend.</span>
            </div>
            {shots.map((row, i) => (
              <div key={row.scene.shot} className="rounded-lg bg-black/20 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-white/10 px-1.5 py-0.5">shot {row.scene.shot} · {row.scene.durationSeconds}s</span>
                  <span className="text-white/70">{row.scene.visualDescription || "(no visual description — this shot cannot be generated yet)"}</span>
                  <span className={`ml-auto ${row.state === "failed" ? "text-red-400" : row.state === "ready" ? "text-emerald-400" : row.state === "generating" ? "text-amber-300" : "text-white/50"}`}>
                    {row.state === "awaiting_confirm" ? `awaiting your confirmation (~$${(row.quote?.estimatedCostUsd ?? 0).toFixed(2)})` : row.state}
                  </span>
                </div>
                {row.error && <p className="mt-1 text-xs text-red-400">{row.error}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.state === "pending" && (
                    <button onClick={() => quoteOneShot(i)} disabled={busy !== null} className={`rounded px-2.5 py-1 text-xs ${ACCENT} disabled:opacity-40`}>
                      {busy === `quote-${i}` ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} Get quote
                    </button>
                  )}
                  {row.state === "awaiting_confirm" && (
                    <button onClick={() => confirmOneShot(i)} disabled={busy !== null} className="rounded bg-emerald-600 px-2.5 py-1 text-xs text-white disabled:opacity-40">
                      Confirm spend & generate
                    </button>
                  )}
                  {row.state === "generating" && (
                    <span className="flex items-center gap-1 text-xs text-amber-300"><Loader2 className="h-3 w-3 animate-spin" /> waiting for Veo…</span>
                  )}
                  {row.state === "ready" && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3 w-3" /> clip ready</span>
                  )}
                  {row.state === "failed" && (
                    <button onClick={() => { setShots((rows) => rows.map((r, j) => (j === i ? { ...r, state: "pending", error: null, videoUri: r.videoUri } : r))); void quoteOneShot(i); }} disabled={busy !== null} className="rounded bg-white/10 px-2.5 py-1 text-xs text-white/80 disabled:opacity-40">
                      <RefreshCw className="mr-1 inline h-3 w-3" /> Retry this shot
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* -------- voiceover -------- */}
      {concept && (
        <Card className={CARD}>
          <CardContent className="space-y-2 p-4 text-sm">
            <h3 className="flex items-center gap-2 font-medium"><Mic className="h-4 w-4" /> Narration (ElevenLabs)</h3>
            {narrationPath ? (
              <p className="flex items-center gap-2 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Narration stored ({voiceCharacters ?? "?"} billed characters) → <code className="text-[10px]">{narrationPath}</code></p>
            ) : (
              <>
                <button onClick={makeVoiceover} disabled={busy !== null || !concept.concept.script} className={`rounded px-3 py-1.5 text-xs ${ACCENT} disabled:opacity-40`}>
                  {busy === "voice" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <Mic className="mr-1 inline h-3.5 w-3.5" />} Generate narration
                </button>
                <p className="text-[10px] text-white/40">Billed per character; the server reports the exact count it charged.</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* -------- render -------- */}
      {concept && (
        <Card className={CARD}>
          <CardContent className="space-y-2 p-4 text-sm">
            <h3 className="flex items-center gap-2 font-medium"><Download className="h-4 w-4" /> Render</h3>
            {renderJob ? (
              <div className="flex items-center gap-2 text-xs">
                {renderJob.state === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : renderJob.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />}
                <span>render job {renderJob.jobId.slice(0, 8)}… — {renderJob.state}</span>
              </div>
            ) : (
              <>
                <button onClick={doRender} disabled={busy !== null || readyShots === 0} className={`rounded px-3 py-1.5 text-xs ${ACCENT} disabled:opacity-40`}>
                  {busy === "render" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null} Render the finished ad
                </button>
                {readyShots < shots.length && <p className="text-[10px] text-amber-300/80">{shots.length - readyShots} shot(s) still don't have clips — the server will refuse the render until they exist; nothing is charged for that refusal.</p>}
                <p className="text-[10px] text-white/40">
                  Rendering needs a hosted FFmpeg worker (RENDER_WORKER_URL). On deployments without it, this button returns the honest server error instead of a fake success: the clips, script and narration stay saved and retry once a worker is connected.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <button onClick={onOpenChat} className="text-xs text-white/50 underline hover:text-white">Discuss this project with the assistant</button>
      </div>
    </div>
  );
}
