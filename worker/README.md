# Vaylo Ad Render Worker

The only component in this project that runs FFmpeg.

## Why it is a separate service

It cannot live in the existing backend. Supabase Edge Functions answer this for
themselves — a deployed diagnostic returned:

```json
{
  "runtime": "deno supabase-edge-runtime-1.77.0",
  "hasDenoCommand": "function",
  "spawnedFfmpeg": false,
  "ffmpegError": "Error: Spawning subprocesses is not allowed on Supabase Edge Runtime."
}
```

Subprocesses are blocked outright, and a request gets **2 seconds of CPU**
(`supabase.com/docs/guides/functions/limits`) against a render that takes 4–5
seconds. Your Netlify site is static-only, with no functions directory. So the
render engine (`supabase/functions/_shared/renderPlan.ts`) is shared, and this
container executes it.

## What it does

| Route | Purpose |
|---|---|
| `GET /health` | Reports FFmpeg and FFprobe versions, whether `libx264` is present, and current concurrency. |
| `POST /render` | Validates a job, then queues or starts it. Returns `202` with a job view. |
| `GET /jobs/:id` | State, progress percentage, output facts, and any error. |
| `GET /jobs/:id/file` | Streams the finished MP4. |

Rendering is asynchronous because it is minutes of work, not milliseconds: the
client starts a job and polls it.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port. |
| `RENDER_TOKEN` | *(none)* | **Required.** Shared secret; `/render` returns 503 until it is set and 401 for a wrong token. |
| `WORK_DIR` | OS temp dir | Local sources must resolve inside this. Never `/`. |
| `FONT_FILE` | DejaVu Sans Bold | Required for any text overlay, because the runtime has no fonts. |
| `MAX_CONCURRENCY` | `2` | Simultaneous renders. Further jobs queue. |
| `MAX_CLIPS` | `12` | Per job. |
| `MAX_TOTAL_SECONDS` | `180` | Per job, summed across clips. |
| `MAX_SOURCE_BYTES` | `512 MB` | Download cap per source. |
| `JOB_TIMEOUT_MS` | `600000` | Hard kill for a stuck render. |
| `DOWNLOAD_TIMEOUT_MS` | `60000` | Bounds a remote-source download. |

## Deploying cheaply

The brief asks for free or very cheap. The cheapest host that can actually run
FFmpeg:

**Render free tier** — free, supports Docker, no card required. Caveats that
matter here: roughly 0.1 CPU (a render that takes 5s locally may take a minute),
and it spins down after 15 minutes idle, so the first request takes about a
minute to wake. Its free filesystem is **ephemeral**, which is why a finished
MP4 is served straight back and downloadable for two hours rather than relied on
as storage. Point the platform at this directory; `Dockerfile` is the build.

**Paid upgrades**, if renders feel slow: Railway Hobby (~$5/mo, real CPU and a
persistent volume) or Fly.io (a small always-on machine).

### Steps

1. Create the service from this `worker/` directory (Docker build).
2. Set `RENDER_TOKEN` to a long random value. Do **not** reuse any other secret.
3. Confirm `GET /health` returns `"ok": true`. If `hasLibx264` is false the
   image is wrong — Debian needs `libavcodec-extra` for the encoders.
4. Keep the worker unreachable from the browser: it should accept traffic only
   from the Supabase edge function that holds `RENDER_TOKEN`.

## Security properties, and how they were tested

Every one of these was exercised against a running worker, not asserted:

- **No shell.** FFmpeg is spawned with an argument array and `shell: false`, so a
  caption containing `; rm -rf / && $(whoami)` is inert text.
- **No user-supplied paths.** `../../../../etc/passwd`, an absolute
  `C:/Windows/...` path, and a POSIX `/etc/passwd` are all refused
  (`src must be an http(s) URL or a path inside the work directory`).
- **No SSRF.** `http://169.254.169.254/` (cloud metadata), loopback, `10.0.0.5`,
  and `metadata.google.internal` are refused in ~300 ms with
  `private and link-local addresses are not allowed`. Redirects are followed
  manually and every hop is re-validated.
- **Auth.** Missing or wrong `x-render-token` returns 401.
- **Bounded.** Clip count, total duration, download size, per-job timeout and a
  concurrency semaphore are all enforced; excess jobs queue instead of
  overloading the box.
- **Duplicate-proof.** Re-posting the same `jobId` returns the existing job with
  `"deduplicated": true` instead of rendering twice.
- **No paid calls.** This worker never contacts OpenAI or Veo. Expensive
  provider calls stay in the edge functions behind their own consent gates.

## Building the engine bundle — read this before deploying

The plan builder is not written in this directory. It lives in
`supabase/functions/_shared/renderPlan.ts`, so the edge functions, the tests and
this worker share ONE definition of what a render is. `npm run build` bundles it
to `dist/renderPlan.mjs` and writes the source hash to `dist/build-info.json`.

**This step is not optional, and skipping it is a trap this project already fell
into.** The build script used to read a copy kept at `worker/src/renderPlan.ts`.
That copy is gone, so the build failed and the stale bundle kept rendering: a
fixed trim bug passed every test and changed nothing in a real export. The worker
now checks its stamp against the source on startup and **refuses to start** if
they differ (set `SKIP_BUILD_CHECK=1` to override, which is only sensible inside
a container that has no source to compare against).

```
cd worker
npm install
npm run build     # required after ANY change to renderPlan.ts
npm start
```

## Branding

`POST /render` accepts a `logo` field: `{ src, widthRatio?, marginRatio? }`. The
src is the supplied Vaylo Sports artwork (`public/logo.png`) and it is resolved
under the same work-directory restriction as every other source. It is drawn
after the captions, inset from the top-left, at 22% of the frame width by
default. There is deliberately no generated stand-in for it — the brand rule is
that the official logo is used as supplied. Verified by rendering the same advert
twice, with and without the logo, and comparing frames: 36.6% of the logo's
rectangle changed and 0.0017% of the rest of the frame did.

## Not built yet

- **No durable job table.** Job state is an in-memory map, so it is lost on
  restart and not shared between instances. An `ad_render_jobs` table in Supabase
  (owner-scoped RLS, `jobId` unique for dedupe) is the next step.
- **No Supabase edge function** dispatching to this worker, so nothing calls it
  from the app yet. The client must never hold `RENDER_TOKEN`.
- **No output storage.** Free tiers have no disk. Persisting renders needs a
  Supabase Storage bucket, which needs a service-role key — deliberately not
  something this worker holds, and not a key present in `.env`.
- **No UI.** No timeline, no progress view, no download button.
- **No music bed.** No licensed track exists in this repository and the brief
  forbids unlicensed audio, so every mix is narration and ambience.
- **ElevenLabs is connected** (see `supabase/functions/voiceover`), but the
  narration is generated by that function and handed in — this worker makes no
  provider calls of its own.
