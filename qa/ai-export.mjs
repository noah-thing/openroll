// Export a clip with background removal, stabilising, optical flow slow motion and motion blur.
// usage: node qa/launch.mjs qa/ai-export.mjs   (after npm run build)
import { execFileSync } from "node:child_process";
import { check, openProject } from "./lib.mjs";

export default async function ({ page, shot }) {
  await openProject(page, ["people_pan_1280x720.mp4"]);
  await page.evaluate(() => {
    const e = window.__or.editor;
    const id = e.project.tracks[0].items[0].id;
    e.apply("qa", p => {
      const n = structuredClone(p);
      n.settings.background = "#1fae5b";
      const it = n.tracks[0].items[0];
      Object.assign(it, { cutout: true, stabilize: { strength: 0.5 }, speed: 0.5, duration: 4_000_000, slowMotion: "flow", motionBlur: { amount: 0.5 } });
      return n;
    });
    e.select([id]);
  });
  await page.locator(".insp .ai-ok").first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".modal");
  const t0 = Date.now();
  await page.click(".modal .export");
  await page.waitForSelector(".modal-done, .modal-warn", { timeout: 300000 });
  const secs = (Date.now() - t0) / 1000;
  const text = await page.locator(".modal-body.export-jobs").innerText();
  console.log("export of 4 s took", secs.toFixed(1), "s:", text.replace(/\n/g, " | "));
  check("export finished", /Saved/.test(text));
  const path = (await page.locator(".modal-path").textContent())?.trim();
  if (path) {
    console.log(execFileSync(process.env.FFPROBE ?? "ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames", "-of", "csv=p=0", path]).toString().trim());
    execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-y", "-v", "error", "-ss", "1.5", "-i", path, "-frames:v", "1", "qa/shots/ai-export-frame.png"]);
  }
}
