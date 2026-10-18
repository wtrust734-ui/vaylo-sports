// REAL compose verification: run the EXACT bundled plan builder the worker runs.
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { validateComposeRequest, buildComposePlan, verifyOutput } from "file://C:/Users/gemme/Downloads/.freebuff/worker/dist/composeJob.mjs";

const FFMPEG = "C:/Users/gemme/AppData/Local/Temp/ffmpeg-portable/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe";
const FONT = "C:/Windows/Fonts/arialbd.ttf";

async function runCompose({ placement, outPath, headline, cta }) {
  const verdict = validateComposeRequest({
    jobId: "verify1234",
    placementId: placement,
    background: "C:/Users/gemme/AppData/Local/Temp/compose-verify/job/bg.png",
    text: { headline, cta },
  });
  if (!verdict.ok) throw new Error(`validate: ${verdict.reason}`);
  const plan = buildComposePlan({
    request: verdict.request,
    backgroundPath: "C:/Users/gemme/AppData/Local/Temp/compose-verify/job/bg.png",
    fontPath: FONT,
    outPath,
  });
  if (plan.overflow) throw new Error(`overflow: ${JSON.stringify(plan.overflow)}`);
  // Spawn with an argument ARRAY, shell:false — identical to the worker.
  let errout = "";
  await new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, plan.plan.argv, { shell: false, windowsHide: true });
    child.stderr.on("data", (d) => (errout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code} :: ${errout.split("\n").filter(Boolean).slice(-3).join(" | ")}`)),
    );
  });
  const info = await stat(outPath);
  const quality = verifyOutput(info.size);
  if (quality) throw new Error(quality);
  return { outPath, bytes: info.size, width: plan.plan.width, height: plan.plan.height };
}

console.log("compose ig_story_reels:", JSON.stringify(await runCompose({
  placement: "ig_story_reels",
  outPath: "C:/Users/gemme/AppData/Local/Temp/compose-verify/story.png",
  headline: "Train like the 1500m pros",
  cta: "Join the waitlist",
})));
console.log("compose ig_feed_portrait:", JSON.stringify(await runCompose({
  placement: "ig_feed_portrait",
  outPath: "C:/Users/gemme/AppData/Local/Temp/compose-verify/feed.png",
  headline: "Personalised plans for every race",
  cta: "Join the waitlist",
})));
console.log("ALL REAL COMPOSES VERIFIED");
