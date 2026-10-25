// ============================================================================
// AdPlayer — plays the assembled cut
// ----------------------------------------------------------------------------
// The storyboard's own clips play back-to-back on one clock, each held to the
// slot the storyboard gave it; the narration file runs underneath and the
// caption text is timed to the same clock. Every frame is a stored asset the
// owner can also download — nothing is composited on the fly and no progress is
// simulated.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { AdPreview } from "./videoAdsApi";

const ACCENT = "bg-[#8505D5] text-white";

export default function AdPlayer({ ad, onRenew }: { ad: AdPreview; onRenew?: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advancingRef = useRef(false);

  const offsets: number[] = [];
  let running = 0;
  for (const c of ad.clips) {
    offsets.push(running);
    running += c.durationSeconds;
  }
  const total = running;
  const clip = ad.clips[Math.min(index, ad.clips.length - 1)];
  const caption = ad.captions.find((c) => elapsed >= c.startSeconds && elapsed < c.endSeconds) ?? null;

  const stop = () => {
    setPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
  };

  const advance = () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    if (index + 1 >= ad.clips.length) {
      stop();
      setElapsed(total);
      return;
    }
    setIndex((i) => i + 1);
  };

  // A new clip resets the guard that stops one clip advancing twice, then
  // resumes playback if the ad was playing.
  useEffect(() => {
    advancingRef.current = false;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    if (playing) void v.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const start = async () => {
    setLoadError(null);
    if (elapsed >= total - 0.05) {
      setElapsed(0);
      setIndex(0);
      advancingRef.current = false;
    }
    setPlaying(true);
    try {
      await videoRef.current?.play();
      const audio = audioRef.current;
      if (audio) {
        // The narration runs on the ad's own clock: join it where the cut is
        // rather than restarting the voice from zero mid-advert.
        if (Math.abs(audio.currentTime - elapsed) > 0.35) {
          audio.currentTime = Math.min(elapsed, Number.isFinite(audio.duration) ? audio.duration : elapsed);
        }
        await audio.play();
      }
    } catch {
      // Autoplay was refused by the browser; the play button stays and says so.
      setPlaying(false);
    }
  };

  const restart = () => {
    stop();
    setElapsed(0);
    setIndex(0);
    advancingRef.current = false;
    if (videoRef.current) videoRef.current.currentTime = 0;
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    setElapsed(offsets[Math.min(index, offsets.length - 1)] + Math.min(v.currentTime, clip.durationSeconds));
    if (v.currentTime >= clip.durationSeconds - 0.05) advance();
  };

  if (!clip) return <p className="text-xs text-white/50">This cut has no clips to play yet.</p>;

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          key={clip.shot}
          ref={videoRef}
          src={clip.url}
          playsInline
          muted
          className="mx-auto max-h-[420px] w-full object-contain"
          onTimeUpdate={onTime}
          onEnded={advance}
          onError={() => {
            setPlaying(false);
            setLoadError("This clip's signed link could not be loaded.");
          }}
        />
        {caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
            <span className="rounded bg-black/70 px-2.5 py-1 text-center text-sm font-medium text-white">{caption.text}</span>
          </div>
        )}
        <div className="absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/80">
          shot {Math.min(index + 1, ad.clips.length)}/{ad.clips.length}
        </div>
      </div>

      {ad.narrationUrl && <audio ref={audioRef} src={ad.narrationUrl} />}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => (playing ? stop() : void start())} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs ${ACCENT}`}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? "Pause" : "Play the ad"}
        </button>
        <button onClick={restart} className="inline-flex items-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/20">
          <RotateCcw className="h-3.5 w-3.5" /> Restart
        </button>
        <span className="ml-auto tabular-nums text-white/50">{elapsed.toFixed(1)}s / {total.toFixed(1)}s</span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded bg-black/40">
        <div className="h-full rounded bg-[#8505D5] transition-all duration-200" style={{ width: `${Math.min(100, Math.round((elapsed / Math.max(total, 0.1)) * 100))}%` }} />
      </div>

      {clip.description && <p className="text-[11px] text-white/50">shot {clip.shot}: {clip.description}</p>}
      {!ad.narrationUrl && <p className="text-[10px] text-white/40">No narration file is attached, so the cut plays silent.</p>}
      {loadError && (
        <p className="flex flex-wrap items-center gap-2 rounded bg-black/30 px-2 py-1.5 text-[11px] text-amber-300">
          {loadError} Signed links expire after 12 hours.
          {onRenew && <button onClick={onRenew} className="underline">Renew the links</button>}
        </p>
      )}
    </div>
  );
}
