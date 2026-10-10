# Advertising workflow — what works, what needs a person, what is missing

Verified on 2026-10-10 against the deployed Supabase project (`vvwhausdjzdmsyxekrcl`)
and a local render worker running real FFmpeg. Every claim below is either a test
count, a live HTTP call, or a number measured from an actual MP4. Nothing here is
inferred from the existence of an API key.

| Step | State |
|---|---|
| 1. Create a campaign | **Working.** Brief validation, costed, refuses fabrication before anything is written. |
| 2. Three creative concepts | **Working.** Live OpenAI, validated, costed; three distinct concepts per brief. |
| 3. Generate the assets | **Partly manual.** ElevenLabs narration works end to end. Veo works but was not re-run for this pass (it bills per second). Real app footage must be supplied by you. |
| 4. Assemble the advert | **Working.** Real FFmpeg export with captions, CTA, slogan and the supplied logo, in three presets. |
| 5. Preview and approve | **Incomplete.** No UI. The API supports regenerating one asset at a time; there is nothing to look at inside the app. |
| 6. Save and organise | **Not built.** No tables, no storage bucket, nothing persisted. |
| 7. Verify | This document. |

## The proof, in one line each

- **Concepts**: three returned for a real brief, zero rejected, 2,840 OpenAI tokens.
- **Narration**: 92–151 characters billed per concept, real MP3, real voice from the account.
- **Narration is in the mix**: the export's audio stream measures 6.40 s against a 6.36 s narration source — the narration, not the clip audio.
- **Assembly**: H.264 1080×1920, AAC 48 kHz, **12.00 s export against a 12 s plan**.
- **Branding**: 79.5% of the CTA band is brand-purple pixels; the supplied logo changed 36.6% of its own rectangle and 0.0017% of the rest of the frame.
- **Spending**: a $0.05 ceiling refuses a $0.12 step with the amount named; nothing is generated before approval.
- **Tests**: 247 pass in `supabase/functions/_shared`, including 80 written for this work.

## Three real bugs found by running it, not by reading it

1. **The trim was applied to the wrong input.** `renderPlan.ts` emitted a clip's
   `-to` *after* its `-i`. In ffmpeg an option after `-i` belongs to the next
   input, so the first clip was never trimmed, every other clip took its
   neighbour's trim, and the **narration was truncated**. Measured: a 12-second
   plan exported as a 16-second MP4 with 4 seconds of audio. Fixed and covered by
   tests that assert position, not just value.
2. **The scripts were screenplays.** Live output returned
   `"VO: “Pitch or pavement…” End card: “Join the waitlist.” Total: 16 seconds."` —
   narration that literally says "V-O colon" over the advert, and bills for it.
   The prompt now forbids it and validation refuses it before ElevenLabs is called.
3. **The worker rendered with a stale engine.** Its bundle was built from
   `worker/src/renderPlan.ts`, a copy that no longer exists, so `npm run build`
   failed and `dist/renderPlan.mjs` kept using the old, buggy builder. A fix that
   passed every test changed nothing in a real export. The bundle is now built
   from the single shared source and the worker **refuses to start** when the
   stamp does not match.

Two more, found while building rather than debugging: the on-screen text cap was
three when the render layout only has two slots plus the CTA, and the code asked
for music ducking (`duckTo`) that the renderer documents but does not implement.

## Step-by-step

### Step 1 — Create a campaign
`POST /functions/v1/campaign { action: "brief" }` validates name, objective,
audience, platform, budget, message and call to action, returning **every**
problem at once. The brand rules run against the message and the CTA here, not
only against the narration later, so "Guaranteed to make you 30% faster" is
refused at the first step rather than after three paid generations.

Budgets are bounded ($10,000 ceiling), an unknown objective or platform is
refused, and a missing brief does not throw.

### Step 2 — Three creative concepts
`{ action: "concepts" }` makes **one** metered OpenAI call and returns three
concepts, each with a hook, core message, script, storyboard, shot descriptions,
Veo prompts, on-screen text, CTA and a rationale — plus what that concept costs
to generate. A concept that breaks the rules is returned under `rejected` with
its reasons instead of being quietly accepted.

Fabrication is refused, not discouraged: invented statistics, user counts,
reviews, ratings, endorsements and app screens all fail validation before any
asset exists. Shots that should show the product are marked `useAppFootage`:
they carry no Veo prompt, cost nothing, and are filled from real footage.

### Step 3 — Generate the assets
- **Narration (ElevenLabs): working.** `voiceover` deploys, lists real voices,
  validates scripts against the brand rules before billing, caps characters, and
  refuses an unknown model rather than silently using a dearer one. The account's
  key is **scoped** — `/v1/user` and `/v1/models` return `missing_permissions` —
  so usage is reported in characters, which is what is actually billed, and no
  dollar or quota figure is invented.
- **Veo: works, not re-run here.** `ad-video` is deployed and was proven earlier
  with real MP4s; this pass deliberately did not spend money per shot, so the
  photographed proof above uses stand-in clips. **This is the one substitution in
  the evidence.**
- **Real app footage: manual, by design.** No screen recording exists in this
  repository, and the app interface is not fabricated. Supplying it is a person's
  job, and the planner names the shot that needs it.
- **Cost and approval: working.** `{ action: "plan" }` returns the ordered
  pipeline with what each step charges and a refusal when the spend would cross
  your ceiling.

### Step 4 — Assemble the advert
`buildConceptRenderPlan()` turns an approved concept into the render request:
clips trimmed to their storyboard lengths, captions placed against the advert's
real duration (title in the opening quarter, CTA over the close, brand slogan in
the end card), narration foregrounded, and the supplied logo overlaid. It
**refuses** rather than substitutes: a missing clip, a missing font or an unknown
preset stops the plan, and a caption with no slot is reported instead of dropped.

Presets: 9:16 (1080×1920), 1:1 (1080×1080), 16:9 (1920×1080) — the platforms'
own upload sizes. Music is optional and never invented: there is no licensed bed
in this repository and the brief forbids unlicensed audio, so the mix says so.

### Step 5 — Preview and approve
The export is a real, playable MP4 with a download route, and individual assets
can be regenerated independently — narration through `voiceover`, one shot
through `ad-video` — so changing one asset never regenerates the others.

**There is no UI.** No in-app preview, no voice picker, no caption editor, no
timeline. Step 5's interface is the whole of what is missing here.

### Step 6 — Save and organise
**Not built.** No campaigns, concepts, assets, exports or costs are persisted.
The worker's job state is an in-memory map, so it is lost on restart. This needs
a migration (campaigns, concepts, assets, exports, with owner-scoped RLS) and a
Storage bucket, which needs a service-role key this worker deliberately does not
hold.

### Step 7 — Verify
Run it yourself:

```
node .freebuff/verify-campaign.mjs   # the deployed function: brief, concepts, cost, refusal, auth
node .freebuff/verify-advert.mjs     # brief -> concepts -> narration -> render -> measurements
node .freebuff/verify-logo.mjs       # two renders, with and without the logo, pixel-compared

npx vitest run supabase/functions/_shared
cd worker && npm run build && npm start
```

## What still needs a person

1. **Host the render worker.** Nothing renders in production: a Supabase edge
   function cannot spawn FFmpeg. Steps 4 onwards are local-only until it has a host.
2. **Supply the real app footage** for any shot marked `useAppFootage`.
3. **Supply a licensed music bed**, or accept narration-and-ambience mixes.
4. **Build the Step 5 interface** and the Step 6 persistence.
5. **Never let the client hold `RENDER_TOKEN`.** Dispatch must come from an edge
   function.
