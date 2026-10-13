# Rill walkthrough — AI Video Form Analysis (Vaylo Sports)

One user-facing flow: upload a technique clip and read the AI coaching report, then
find it again in History. Screen: `/form/video` (`src/pages/VideoFormAnalysis.tsx`),
reached from the **AI Video Analysis** card on the Form screen (`/form`).

## Prerequisites / test data

- The app running locally (`npm run dev`, dev server on `http://localhost:8080/`).
- One signed-in **test athlete** account (no real account, no customer data).
- One short test clip: `test-run-sideon.mp4` — a few seconds of easy running, filmed
  side-on with the full body in frame. An MP4, MOV or WebM file under 10 minutes and
  under 512MB. Do not use a real athlete's footage.
- Enough credits for one analysis (the screen states whether the weekly Flash analysis
  is still free, otherwise the per-analysis credit cost).

## Steps and expected behavior

1. Start the app (`npm run dev`) and open `http://localhost:8080/` signed in as a test athlete.
   Expected: the home dashboard renders.
2. Open **Form** (Train hub or `/form`) and tap the **AI Video Analysis** card.
   Expected: the AI Video Form Analysis screen opens at `/form/video` with **Analyse** and
   **History** tabs.
3. Pick **Movement type** Running (or Sprint / General movement).
   Expected: the chosen chip highlights and the upload card shows the limits
   (MP4, MOV or WebM, up to 10 minutes, under 512MB).
4. Tap **Choose video** and pick `test-run-sideon.mp4`.
   Expected: the clip previews, progress reads "Uploading video…" then "Coach is analysing
   your movement…", and a toast says "Analysis ready".
5. Read the report.
   Expected: Overall form score out of 100, Coach summary, a "What happens in the clip"
   timeline of timestamps, Focus next session, Strengths, Areas to improve, Technique
   breakdown and Recommended drills, plus a note that the clip is deleted and only the
   report is kept.
6. Open the **History** tab and expand the new row.
   Expected: the row shows the score, movement type and date; expanding shows the summary,
   focus, improvements and drills, and **Delete analysis** removes it.
7. Optional negative check: choose a non-video file, or a clip longer than 10 minutes.
   Expected: nothing uploads and a toast reads "Cannot analyse this clip".

## Missing inputs

- **Public app URL** — the app runs at `http://localhost:8080/` only; no public URL was
  supplied, so the link below carries no `&url=`. Add the public URL in Rill before running.
- **Test account** — credentials for a signed-in test athlete are not recorded here; supply
  them in Rill, never in this file.
- **Credits** — how many analysis credits the test account holds is unknown, so step 5 may
  stop at a credit prompt rather than a report.

## Run it

Because the app only runs on localhost (a cloud run cannot reach it), record it another way
if needed: [manual recording](https://userill.dev/record?utm_source=freebuff&utm_medium=paid&utm_campaign=rill)
or an [existing browser agent](https://userill.dev/docs/agent-quickstart?utm_source=freebuff&utm_medium=paid&utm_campaign=rill).

[Open your walkthrough in Rill](https://userill.dev/freebuff?utm_source=freebuff&utm_medium=paid&utm_campaign=rill&bfcid=bfc_1.eyJpZCI6IjMwYjA3ZDY0LWYwNmEtNGRkZS04YzQ5LWMxMzI5MjYwYzBkMyIsImMiOiIxNDQyMTUzOS1kYjNiLTQ1YzEtYjQ5OC1hYTMxOTFmNDkxYzAiLCJrIjoiNDU4ODZlNWEtYzkyZC00ZDUxLTg1ZjgtYzc4YTRmMTY3ZWYwIiwiaWF0IjoxNzkxODc1MDUzfQ.SWX9d7qLFkUq4Ot6qS74M4g7yd11lxgfjj2O5QyP5EY#task=1.%20Start%20the%20app%20%28npm%20run%20dev%29%20and%20open%20http%3A%2F%2Flocalhost%3A8080%2F%20signed%20in%20as%20a%20test%20athlete.%20Expected%3A%20the%20home%20dashboard%20renders.%0A2.%20Open%20Form%20%28Train%20hub%20or%20%2Fform%29%20and%20tap%20the%20%22AI%20Video%20Analysis%22%20card.%20Expected%3A%20the%20AI%20Video%20Form%20Analysis%20screen%20opens%20at%20%2Fform%2Fvideo%20with%20Analyse%20and%20History%20tabs.%0A3.%20Pick%20Movement%20type%20Running%20%28or%20Sprint%20%2F%20General%20movement%29.%20Expected%3A%20the%20chosen%20chip%20highlights%20and%20the%20upload%20card%20shows%20the%20limits%20%28MP4%2C%20MOV%20or%20WebM%2C%20up%20to%2010%20minutes%2C%20under%20512MB%29.%0A4.%20Tap%20%22Choose%20video%22%20and%20pick%20a%20short%20side-on%20test%20clip%20with%20the%20full%20body%20in%20frame.%20Expected%3A%20the%20clip%20previews%2C%20progress%20reads%20Uploading%20video%20then%20Coach%20is%20analysing%20your%20movement%2C%20and%20a%20toast%20says%20%22Analysis%20ready%22.%0A5.%20Read%20the%20report.%20Expected%3A%20Overall%20form%20score%20out%20of%20100%2C%20Coach%20summary%2C%20a%20%22What%20happens%20in%20the%20clip%22%20timeline%20of%20timestamps%2C%20Focus%20next%20session%2C%20Strengths%2C%20Areas%20to%20improve%2C%20Technique%20breakdown%20and%20Recommended%20drills%2C%20plus%20a%20note%20that%20the%20clip%20is%20deleted%20and%20only%20the%20report%20is%20kept.%0A6.%20Open%20the%20History%20tab%20and%20expand%20the%20new%20row.%20Expected%3A%20the%20row%20shows%20the%20score%2C%20movement%20type%20and%20date%3B%20expanding%20shows%20summary%2C%20focus%2C%20improvements%20and%20drills%2C%20and%20Delete%20analysis%20removes%20it.%0A7.%20Optional%3A%20choose%20a%20non-video%20file%20or%20a%20clip%20longer%20than%2010%20minutes.%20Expected%3A%20nothing%20uploads%20and%20a%20toast%20reads%20%22Cannot%20analyse%20this%20clip%22.)

Your walkthrough is prepared. No recording has been made yet. In Rill, review the steps, add a public app URL, and choose Sign up to run if you need an account. The walkthrough uses Interact mode. Press Run to start it.
