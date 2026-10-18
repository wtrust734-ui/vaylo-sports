/**
 * VAYLO AD RENDER WORKER — the only component that runs FFmpeg.
 *
 * WHY THIS EXISTS AS A SEPARATE SERVICE
 *
 * Supabase Edge Functions cannot run it. The edge runtime answers for itself:
 *   "Error: Spawning subprocesses is not allowed on Supabase Edge Runtime."
 * ...and caps a request at 2 seconds of CPU, against a render that takes 4-5
 * seconds on a fast machine. So the render engine (supabase/functions/_shared/
 * renderPlan.ts) is shared, and this worker is the thing that executes it.
 *
 * DESIGN RULES, all of them load-bearing:
 *
 *  - NO SHELL, EVER. FFmpeg is spawned with an argument ARRAY (shell: false).
 *    Captions and filenames are data, never command syntax.
 *  - NO USER-SUPPLIED PATHS. A local `src` must resolve inside WORK_DIR; a
 *    remote `src` must be http(s) and is downloaded under a size cap. A path
 *    like ../../etc/passwd is rejected before it reaches the filesystem.
 *  - NOTHING PAID HAPPENS HERE. This worker only assembles footage it is given.
 *    Veo and OpenAI calls stay in the edge functions, behind their own consent
 *    gates, so a render can never quietly spend money.
 *  - BOUNDED. A concurrency semaphore, per-job timeout, and hard caps on clip
 *    count, total duration and download size, so one caller cannot take the box
 *    down or fill the disk.
 */

import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PRESET_IDS, buildProbeArgs, buildRenderPlan, summariseProbe } from "./dist/renderPlan.mjs";
import { validateComposeRequest, buildComposePlan, verifyOutput } from "./dist/composeJob.mjs";

// ---------------------------------------------------------------------------
// Refuse to render with a stale engine.
//
// The plan builder is bundled from supabase/functions/_shared/renderPlan.ts, and
// this check exists because that bundle once went stale silently: the tests and
// the edge functions used a fixed engine while the worker kept rendering with an
// old one, so a verified fix changed nothing in a real export.
//
// In the container the source is not copied in, so the stamp is simply reported.
// Locally — where the source IS present — a mismatch is fatal, because rendering
// with an out-of-date plan builder is worse than not starting.
// ---------------------------------------------------------------------------
if (process.env.SKIP_BUILD_CHECK !== "1") {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const info = JSON.parse(await readFile(path.join(here, "dist/build-info.json"), "utf8"));
    const source = await readFile(info.entryPoint, "utf8").catch(() => null);
    if (source === null) {
      console.log(`render engine: built ${info.builtAt} from ${info.entryPoint} (source not present in this image)`);
    } else {
      const current = createHash("sha256").update(source).digest("hex");
      if (current !== info.sourceHash) {
        console.error(
          "REFUSING TO START: dist/renderPlan.mjs is stale.\n" +
            `  bundled source : ${info.entryPoint}\n` +
            `  bundled hash   : ${info.sourceHash.slice(0, 12)}\n` +
            `  current hash   : ${current.slice(0, 12)}\n` +
            "Run `npm run build` in worker/ and start again.",
        );
        process.exit(1);
      }
      console.log(`render engine: fresh (${info.sourceHash.slice(0, 12)})`);
    }
    // Same stale-bundle rule, for the image compose engine.
    try {
      const cinfo = JSON.parse(await readFile(path.join(here, "dist/composeJob.build-info.json"), "utf8"));
      const csource = await readFile(cinfo.entryPoint, "utf8").catch(() => null);
      if (csource !== null) {
        const ccurrent = createHash("sha256").update(csource).digest("hex");
        if (ccurrent !== cinfo.sourceHash) {
          console.error("REFUSING TO START: dist/composeJob.mjs is stale. Run `npm run build` in worker/.");
          process.exit(1);
        }
        console.log(`compose engine: fresh (${cinfo.sourceHash.slice(0, 12)})`);
      }
    } catch (e) {
      console.warn("could not verify the compose engine bundle:", e instanceof Error ? e.message : e);
    }
  } catch (e) {
    // A missing stamp is not a reason to refuse a container that was built earlier.
    console.warn("could not verify the render engine bundle:", e instanceof Error ? e.message : e);
  }
}

const PORT = Number(process.env.PORT ?? 8080);
const RENDER_TOKEN = process.env.RENDER_TOKEN ?? "";
/** Local sources must live under here. Defaults to a scratch dir, never "/". */
const WORK_DIR = path.resolve(process.env.WORK_DIR ?? tmpdir());
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? 2);
const MAX_CLIPS = Number(process.env.MAX_CLIPS ?? 12);
const MAX_TOTAL_SECONDS = Number(process.env.MAX_TOTAL_SECONDS ?? 180);
const MAX_SOURCE_BYTES = Number(process.env.MAX_SOURCE_BYTES ?? 512 * 1024 * 1024);
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 10 * 60 * 1000);
/** Bounds a source download, so an unreachable host cannot hold a render slot. */
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS ?? 60_000);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS ?? 2 * 60 * 60 * 1000);
/** Font baked into the image; the runtime has none of its own. */
const FONT_FILE = process.env.FONT_FILE ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN ?? "ffprobe";

// ---------------------------------------------------------------------------
// Job registry — in memory on purpose.
//
// Free container tiers have no persistent disk, so durable job state belongs in
// Supabase (see supabase/migrations for ad_render_jobs). This map is the
// single-instance working set: it drives dedupe, progress and downloads, and it
// is honest about being lost on restart.
// ---------------------------------------------------------------------------

/** @type {Map<string, {state:string, progress:number, error:string|null, filePath:string|null, bytes:number|null, startedAt:number, finishedAt:number|null, meta:object}>} */
const jobs = new Map();
let running = 0;
const queue = [];

const nowMs = () => Date.now();

/**
 * Cumulative usage, so hosting cost is observable rather than guessed.
 *
 * The brief asks for processing time, storage use and resource consumption to
 * be tracked. Storage use is deliberately reported as "bytes produced" and NOT
 * as bytes retained: on a free tier the disk is ephemeral, so retained bytes
 * would be a number that quietly means nothing.
 */
const stats = {
  rendersStarted: 0,
  rendersSucceeded: 0,
  rendersFailed: 0,
  totalRenderMs: 0,
  totalOutputBytes: 0,
  totalSourceBytes: 0,
  longestRenderMs: 0,
};

/** Remove finished jobs once they are too old to be downloadable. */
setInterval(() => {
  for (const [id, job] of jobs) {
    if (job.finishedAt && nowMs() - job.finishedAt > JOB_TTL_MS) {
      if (job.filePath) rm(job.filePath, { force: true }).catch(() => {});
      jobs.delete(id);
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/** Run a binary with an argument array. Never a shell. */
function run(binary, argv, { onStderr, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(binary, argv, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs)
      : null;

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\nspawn failed: ${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** The versions reported by /health — the "FFmpeg is actually working" check. */
async function toolVersions() {
  const [ff, fp] = await Promise.all([run(FFMPEG, ["-version"]), run(FFPROBE, ["-version"])]);
  const first = (s) => s.split("\n")[0]?.trim() ?? "";
  return {
    ffmpeg: ff.code === 0 ? first(ff.stdout) : null,
    ffprobe: fp.code === 0 ? first(fp.stdout) : null,
    // libx264 and aac are the compatibility requirement; a build without them
    // would produce an export nothing can play.
    hasLibx264: /libx264/.test(first(ff.stdout)) || /enable-libx264/.test(ff.stdout),
  };
}

async function probe(filePath) {
  const r = await run(FFPROBE, buildProbeArgs(filePath), { timeoutMs: 30_000 });
  if (r.code !== 0) return null;
  try {
    return summariseProbe(JSON.parse(r.stdout));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source resolution — the path-safety boundary
// ---------------------------------------------------------------------------

/**
 * Turn a requested source into a local file path, or throw.
 *
 * Two accepted forms, and nothing else:
 *   http(s)://...  downloaded under a byte cap
 *   a path that resolves INSIDE WORK_DIR
 *
 * The containment check is done on the resolved absolute path so that
 * `../../etc/passwd`, an encoded traversal, or an absolute path elsewhere all
 * fail the same way.
 */
/**
 * Hosts that exist to leak instance credentials.
 *
 * Without this, the worker is an SSRF proxy: a caller could ask it to fetch
 * http://169.254.169.254/... and read a cloud instance's metadata through us.
 * An early test did exactly that and the request hung rather than failing,
 * occupying a render slot until it timed out.
 */
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog", "metadata"]);

/** Loopback, link-local, private, CGNAT and IPv6 equivalents. */
export function isPrivateAddress(ip) {
  if (!ip) return true;
  const v = String(ip).toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Reject a URL that is not a plain, public http(s) target. */
async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`scheme ${url.protocol} is not allowed`);
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".internal")) throw new Error("that host is not allowed");
  if (isPrivateAddress(host)) throw new Error("private and link-local addresses are not allowed");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(":")) {
    // Resolve once and check the answer too, so a public-looking name that
    // points inward (including a simple DNS-rebinding setup) is refused. Only
    // the first address is checked, which is not a complete defence against a
    // round-robin rebind.
    const { address } = await lookup(host).catch(() => ({ address: null }));
    if (isPrivateAddress(address)) throw new Error("that host resolves to a private address");
  }
  return url;
}

/** Follow at most a couple of redirects, validating every hop. */
async function fetchPublic(raw, index) {
  let target = await assertPublicUrl(raw);
  for (let hop = 0; hop <= 2; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(target, { redirect: "manual", signal: controller.signal });
    } catch (err) {
      throw new Error(
        err?.name === "AbortError"
          ? `clip ${index + 1}: downloading the source timed out`
          : `clip ${index + 1}: could not download source`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`clip ${index + 1}: redirect without a destination`);
      target = await assertPublicUrl(new URL(location, target).toString());
      continue;
    }
    return res;
  }
  throw new Error(`clip ${index + 1}: too many redirects`);
}

const DATA_URL_EXTENSIONS = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac", "audio/mp4": "m4a", "video/mp4": "mp4", "video/quicktime": "mov" };

/**
 * Write an inline `data:` URL to disk.
 *
 * This is how a generated voiceover reaches FFmpeg: the ElevenLabs work happens
 * in an edge function that returns audio bytes, and there is no storage bucket
 * to put them in, so the caller passes them inline. Size-capped like any other
 * source, and the media type is checked against a fixed list rather than trusted
 * to name its own file extension.
 */
async function writeDataUrl(src, jobDir, index) {
  const match = /^data:([\w.+-]+\/[\w.+-]+)(;charset=[\w-]+)?;base64,(.*)$/is.exec(src);
  if (!match) throw new Error(`inline source ${index + 1}: only base64 data URLs are accepted`);

  const [, mediaType, , payload] = match;
  const extension = DATA_URL_EXTENSIONS[mediaType.toLowerCase()];
  if (!extension) throw new Error(`inline source ${index + 1}: unsupported media type ${mediaType}`);

  // Reject on the encoded length first, so an oversized payload is never decoded.
  const estimatedBytes = Math.floor((payload.length * 3) / 4);
  if (estimatedBytes > MAX_SOURCE_BYTES) {
    throw new Error(`inline source ${index + 1}: larger than the ${Math.round(MAX_SOURCE_BYTES / 1048576)} MB limit`);
  }

  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength === 0) throw new Error(`inline source ${index + 1}: decoded to no bytes`);
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error(`inline source ${index + 1}: exceeds the size limit`);

  const dest = path.join(jobDir, `src-${index}.${extension}`);
  await writeFile(dest, bytes);
  return dest;
}

async function resolveSource(src, jobDir, index) {
  if (typeof src !== "string" || !src.trim()) throw new Error(`clip ${index + 1}: src is required`);

  if (/^data:/i.test(src)) {
    return writeDataUrl(src, jobDir, index);
  }

  if (/^https?:\/\//i.test(src)) {
    const res = await fetchPublic(src, index);
    if (!res.ok) throw new Error(`clip ${index + 1}: could not download source (HTTP ${res.status})`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
      throw new Error(`clip ${index + 1}: source is larger than the ${Math.round(MAX_SOURCE_BYTES / 1048576)} MB limit`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_SOURCE_BYTES) {
      throw new Error(`clip ${index + 1}: source exceeds the size limit after download`);
    }
    const dest = path.join(jobDir, `src-${index}.mp4`);
    await writeFile(dest, buffer);
    return dest;
  }

  const resolved = path.resolve(WORK_DIR, src);
  const inside = resolved === WORK_DIR || resolved.startsWith(WORK_DIR + path.sep);
  if (!inside) throw new Error(`clip ${index + 1}: src must be an http(s) URL or a path inside the work directory`);
  if (!existsSync(resolved)) throw new Error(`clip ${index + 1}: source not found`);
  return resolved;
}

// ---------------------------------------------------------------------------
// The render itself
// ---------------------------------------------------------------------------

/** ffmpeg writes `time=00:00:03.20` to stderr; that is the only progress it gives. */
function parseProgress(text, job) {
  const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+\.?\d*)/g)];
  if (matches.length === 0) return;
  const [, h, m, s] = matches[matches.length - 1];
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  const total = job.meta.estimatedSeconds || seconds || 1;
  job.progress = Math.max(job.progress, Math.min(99, Math.round((seconds / total) * 100)));
}

async function renderJob(job, request) {    const jobDir = await mkdtemp(path.join(tmpdir(), "vaylo-render-"));
  try {
    job.state = "preparing";
    job.meta.estimatedSeconds = estimateSeconds(request);

    const clipPaths = [];
    for (const [i, clip] of request.clips.entries()) {
      clipPaths.push(await resolveSource(clip.src, jobDir, i));
    }
    const musicPath = request.music ? await resolveSource(request.music.src, jobDir, 900) : null;
    const voicePath = request.voiceover ? await resolveSource(request.voiceover.src, jobDir, 901) : null;
    // The logo takes the same path restrictions as every other local source.
    const logoPath = request.logo ? await resolveSource(request.logo.src, jobDir, 902) : null;

    // Input bytes actually pulled in, so "storage use" is measured rather than
    // assumed. Download transfer and disk read are the same quantity here.
    const allPaths = [...clipPaths, musicPath, voicePath, logoPath].filter(Boolean);
    let sourceBytes = 0;
    for (const p of allPaths) sourceBytes += (await stat(p).catch(() => ({ size: 0 }))).size;
    job.meta.sourceBytes = sourceBytes;
    stats.totalSourceBytes += sourceBytes;

    for (const [i, p] of clipPaths.entries()) {
      const info = await probe(p);
      if (!info?.hasVideo) throw new Error(`clip ${i + 1}: not a readable video`);
      // A dissolve needs a real length, and probing is the honest way to get it.
      request.clips[i].durationSeconds = info.durationSeconds ?? request.clips[i].durationSeconds;
    }

    const outputPath = path.join(jobDir, "out.mp4");
    const plan = buildRenderPlan({
      presetId: request.presetId,
      clips: request.clips.map((clip, i) => ({ ...clip, src: clipPaths[i] })),
      overlays: request.overlays ?? [],
      music: request.music ? { src: musicPath, volume: Number(request.music.volume ?? 0.3) } : undefined,
      voiceover: request.voiceover ? { src: voicePath, volume: Number(request.voiceover.volume ?? 1) } : undefined,
      // Real artwork only: the supplied logo file, positioned by the planner.
      logo: request.logo
        ? { src: logoPath, widthRatio: request.logo.widthRatio, marginRatio: request.logo.marginRatio }
        : undefined,
      keepSourceAudio: request.keepSourceAudio !== false,
      fontFile: request.overlays?.length ? FONT_FILE : undefined,
      outputPath,
    });
    job.meta.width = plan.width;
    job.meta.height = plan.height;

    job.state = "rendering";
    const result = await run(FFMPEG, plan.argv, {
      timeoutMs: JOB_TIMEOUT_MS,
      onStderr: (text) => parseProgress(text, job),
    });

    if (result.timedOut) throw new Error(`render exceeded the ${Math.round(JOB_TIMEOUT_MS / 60000)} minute limit`);
    if (result.code !== 0) {
      // The last few lines of stderr name the actual cause; the rest is banner.
      const tail = result.stderr.split("\n").filter(Boolean).slice(-4).join(" | ");
      throw new Error(`ffmpeg failed: ${tail.slice(0, 400)}`);
    }

    const info = await probe(outputPath);
    if (!info?.hasVideo) throw new Error("the render finished but produced no playable video");

    job.filePath = outputPath;
    job.bytes = (await stat(outputPath)).size;
    job.progress = 100;
    job.state = "done";
    job.meta.output = info;
    return { plan, info };
  } finally {
    // Everything except the finished mp4, which stays until the job expires.
    // Failed renders have no out.mp4, so this also cleans a failed job up fully.
    const entries = await readdir(jobDir).catch(() => []);
    for (const entry of entries) {
      if (entry !== "out.mp4") await rm(path.join(jobDir, entry), { force: true, recursive: true }).catch(() => {});
    }
  }
}

function estimateSeconds(request) {
  return (request.clips ?? []).reduce((total, clip) => {
    const start = Number(clip.trimStart ?? 0) || 0;
    const end = Number(clip.trimEnd);
    return total + (Number.isFinite(end) ? Math.max(0, end - start) : 8);
  }, 0);
}

function validate(request) {
  if (!request || typeof request !== "object") return "a JSON body is required";
  if (typeof request.jobId !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(request.jobId)) {
    return "jobId must be 6-64 characters of letters, digits, dash or underscore";
  }
  // Caught here rather than inside the render: a bad preset is a bad request,
  // and returning 202 for something that is guaranteed to fail wastes a render
  // slot and gives the caller a job to poll instead of an error to fix.
  if (typeof request.presetId !== "string" || !PRESET_IDS.includes(request.presetId)) {
    return `presetId must be one of: ${PRESET_IDS.join(", ")}`;
  }
  if (!Array.isArray(request.clips) || request.clips.length === 0) return "at least one clip is required";
  if (request.clips.length > MAX_CLIPS) return `at most ${MAX_CLIPS} clips are accepted`;
  const total = estimateSeconds(request);
  if (total <= 0) return "the clips describe no usable duration";
  if (total > MAX_TOTAL_SECONDS) return `total duration exceeds the ${MAX_TOTAL_SECONDS}s limit`;
  if (request.logo && typeof request.logo.src !== "string") return "the logo needs a src";
  if (request.overlays && (!Array.isArray(request.overlays) || request.overlays.length > 12)) return "at most 12 overlays";
  for (const o of request.overlays ?? []) {
    if (typeof o?.text !== "string" || o.text.length > 400) return "each overlay needs text of at most 400 characters";
    if (!["title", "subhead", "cta", "slogan"].includes(o?.role)) return "overlay role must be title, subhead, cta or slogan";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Image compose pass (prompt 4) — background + logo + brand text → PNG.
//
// Reuses the video pipeline's registry, queue, dedup, TTL and source
// resolution so the security story is IDENTICAL: argument arrays, no shell,
// WORK_DIR containment, SSRF-guarded downloads, size-capped inline data URLs.
// The plan builder (dist/composeJob.mjs, bundled from _shared/composeJob.ts)
// refuses an overflow layout before any render slot is consumed.
// ---------------------------------------------------------------------------

/** FFmpeg does not give progress for a single-frame compose; a short fixed arc. */
function composeJob(job, request) {
  return new Promise(async (resolve, reject) => {
    const jobDir = await mkdtemp(path.join(tmpdir(), "vaylo-compose-"));
    try {
      job.state = "preparing";
      job.progress = 5;

      // The background and logo arrive as data URLs (treated like any other
      // inline source) or WORK_DIR paths — resolveSource enforces both.
      const backgroundPath = await resolveSource(request.background, jobDir, 0);
      const logoPath = request.logo ? await resolveSource(request.logo, jobDir, 1) : null;

      job.state = "rendering";
      job.progress = 20;
      const outPath = path.join(jobDir, "out.png");
      const config = buildComposePlan({
        request,
        backgroundPath,
        logoPath,
        fontPath: FONT_FILE,
        outPath,
      });
      if (config.overflow) throw new Error(`layout overflow: ${config.overflow.join("; ")}`);

      const result = await run(FFMPEG, config.plan.argv, { timeoutMs: Math.min(JOB_TIMEOUT_MS, 120_000) });
      if (result.timedOut) throw new Error(`composition exceeded the ${Math.round(Math.min(JOB_TIMEOUT_MS, 120_000) / 1000)}s limit`);
      if (result.code !== 0) {
        const tail = result.stderr.split("\n").filter(Boolean).slice(-4).join(" | ");
        throw new Error(`ffmpeg failed: ${tail.slice(0, 400)}`);
      }

      job.progress = 90;
      const bytes = (await stat(outPath)).size;
      const quality = verifyOutput(bytes);
      if (quality) throw new Error(quality);

      job.filePath = outPath;
      job.bytes = bytes;
      job.progress = 100;
      job.state = "done";
      job.meta.filename = "out.png";
      console.log(`[compose] ${request.jobId} ok, ${Math.round(bytes / 1024)} KiB`);
      resolve();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      const entries = await readdir(jobDir).catch(() => []);
      for (const entry of entries) {
        if (entry !== "out.png") await rm(path.join(jobDir, entry), { force: true, recursive: true }).catch(() => {});
      }
    }
  });
}

function dispatch(job, request) {
  running += 1;
  job.state = "queued";
  job.queuedMs = job.queuedMs ?? nowMs() - job.startedAt;
  // Wall-clock time inside the render, separate from time spent queued behind
  // another job. Conflating the two makes a slow box look like a slow FFmpeg.
  job.renderStartedAt = nowMs();
  stats.rendersStarted += 1;

  const work = request.compose === true ? composeJob(job, request) : renderJob(job, request);
  work
    .then(() => {
      job.finishedAt = nowMs();
      job.renderMs = job.finishedAt - job.renderStartedAt;
      stats.rendersSucceeded += 1;
      stats.totalRenderMs += job.renderMs;
      stats.totalOutputBytes += job.bytes ?? 0;
      stats.longestRenderMs = Math.max(stats.longestRenderMs, job.renderMs);
      console.log(
        `[render] ${job.meta.presetId} ok in ${job.renderMs}ms, ${Math.round((job.bytes ?? 0) / 1024)} KiB output`,
      );
    })
    .catch((err) => {
      job.state = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = nowMs();
      job.renderMs = job.finishedAt - job.renderStartedAt;
      stats.rendersFailed += 1;
      console.error(`[render] failed after ${job.renderMs}ms: ${job.error}`);
    })
    .finally(() => {
      running -= 1;
      const next = queue.shift();
      if (next) dispatch(next.job, next.request);
    });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
};

const readBody = (req, limit = 2 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  // ---- health: no auth, and it proves the toolchain is present ----------
  if (req.method === "GET" && url.pathname === "/health") {
    const versions = await toolVersions();
    return json(res, versions.ffmpeg && versions.ffprobe ? 200 : 503, {
      ok: Boolean(versions.ffmpeg && versions.ffprobe && versions.hasLibx264),
      ...versions,
      concurrency: { limit: MAX_CONCURRENCY, running, queued: queue.length },
      limits: { maxClips: MAX_CLIPS, maxTotalSeconds: MAX_TOTAL_SECONDS, maxSourceMb: Math.round(MAX_SOURCE_BYTES / 1048576) },
      jobs: jobs.size,
      usage: {
        ...stats,
        averageRenderMs: stats.rendersSucceeded ? Math.round(stats.totalRenderMs / stats.rendersSucceeded) : null,
        totalOutputMb: Math.round((stats.totalOutputBytes / 1048576) * 10) / 10,
      },
    });
  }

  if (parts[0] !== "jobs" && url.pathname !== "/render" && url.pathname !== "/compose") return json(res, 404, { error: "not found" });

  // ---- auth for everything that costs CPU ------------------------------
  if (!RENDER_TOKEN) return json(res, 503, { error: "the render worker is not configured (RENDER_TOKEN is unset)" });
  const token = req.headers["x-render-token"];
  if (typeof token !== "string" || token !== RENDER_TOKEN) return json(res, 401, { error: "unauthorized" });

  // ---- start a render --------------------------------------------------
  // ---- start an image compose ------------------------------------------
  if (req.method === "POST" && url.pathname === "/compose") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { error: err instanceof Error ? err.message : "invalid JSON body" });
    }
    const verdict = validateComposeRequest(body);
    if (!verdict.ok) return json(res, 400, { error: verdict.reason });
    const request = { ...verdict.request, compose: true };

    const existing = jobs.get(request.jobId);
    if (existing) {
      return json(res, 200, buildJobView(request.jobId, existing, { deduplicated: true }));
    }
    const job = {
      state: "queued",
      progress: 0,
      error: null,
      filePath: null,
      bytes: null,
      startedAt: nowMs(),
      finishedAt: null,
      meta: { kind: "image_compose", placementId: request.placementId, jobId: request.jobId },
    };
    jobs.set(request.jobId, job);

    if (running >= MAX_CONCURRENCY) {
      queue.push({ job, request });
      job.state = "queued";
      return json(res, 202, buildJobView(request.jobId, job, { queued: true, position: queue.length }));
    }
    dispatch(job, request);
    return json(res, 202, buildJobView(request.jobId, job, {}));
  }

  if (req.method === "POST" && url.pathname === "/render") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { error: err instanceof Error ? err.message : "invalid JSON body" });
    }

    const problem = validate(body);
    if (problem) return json(res, 400, { error: problem });

    // Duplicate prevention: the same jobId is never rendered twice.
    const existing = jobs.get(body.jobId);
    if (existing) {
      return json(res, 200, buildJobView(body.jobId, existing, { deduplicated: true }));
    }

    const job = {
      state: "queued",
      progress: 0,
      error: null,
      filePath: null,
      bytes: null,
      startedAt: nowMs(),
      finishedAt: null,
      meta: { presetId: body.presetId, clips: body.clips.length, estimatedSeconds: estimateSeconds(body) },
    };
    jobs.set(body.jobId, job);

    if (running >= MAX_CONCURRENCY) {
      queue.push({ job, request: body });
      job.state = "queued";
      return json(res, 202, buildJobView(body.jobId, job, { queued: true, position: queue.length }));
    }
    dispatch(job, body);
    return json(res, 202, buildJobView(body.jobId, job, {}));
  }

  // ---- poll a job ------------------------------------------------------
  if (req.method === "GET" && parts[0] === "jobs" && parts[1] && !parts[2]) {
    const job = jobs.get(parts[1]);
    if (!job) return json(res, 404, { error: "no such job" });
    return json(res, 200, buildJobView(parts[1], job, {}));
  }

  // ---- download the finished mp4 / png ----------------------------------
  if (req.method === "GET" && parts[0] === "jobs" && parts[2] === "file") {
    const job = jobs.get(parts[1]);
    if (!job) return json(res, 404, { error: "no such job" });
    if (job.state !== "done" || !job.filePath) return json(res, 409, { error: `job is ${job.state}` });
    const isImage = job.meta?.kind === "image_compose";
    const info = await stat(job.filePath);
    res.writeHead(200, {
      "Content-Type": isImage ? "image/png" : "video/mp4",
      "Content-Length": info.size,
      "Content-Disposition": `attachment; filename="${parts[1]}.${isImage ? "png" : "mp4"}"`,
      "Cache-Control": "private, no-store",
    });
    createReadStream(job.filePath).pipe(res);
    return;
  }

  return json(res, 404, { error: "not found" });
});

function buildJobView(jobId, job, extra) {
  return {
    jobId,
    state: job.state,
    progress: job.progress,
    error: job.error,
    bytes: job.bytes,
    // Timing is reported per job so a caller can see whether a slow render was
    // the encoder or the queue.
    timing: {
      queuedMs: job.queuedMs ?? null,
      renderMs: job.renderMs ?? null,
      totalMs: job.finishedAt ? job.finishedAt - job.startedAt : nowMs() - job.startedAt,
    },
    meta: job.meta,
    // The client downloads from here; it never sees a server path.
    downloadUrl: job.state === "done" ? `/jobs/${jobId}/file` : null,
    ...extra,
  };
}

server.listen(PORT, () => {
  console.log(`vaylo render worker listening on :${PORT} (concurrency ${MAX_CONCURRENCY}, work dir ${WORK_DIR})`);
});
