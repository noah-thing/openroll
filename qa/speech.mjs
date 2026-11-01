// Read aloud on a text item. Downloads the voice model on first run, so it needs a network.
// usage: node qa/launch.mjs qa/speech.mjs
import { homedir } from "node:os";
import { join } from "node:path";

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const infos = await page.evaluate(p => window.openroll.qa.allow(p), [join(process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia"), "h264_1080p30_60s.mp4")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.click('.rail button:has-text("Text")');
  await page.click(".text-card >> nth=0");
  await page.waitForTimeout(400);
  await page.fill("textarea.text-input", "OpenRoll reads this sentence aloud, on your own computer.");
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.click("text=Read aloud >> nth=-1");
  await page.waitForSelector(".aud-progress");
  await shot("speech-downloading");
  await page.waitForFunction(() => Object.values(window.__or.editor.project.media).some(m => m.origin === "speech"), null, { timeout: 420000 });
  const r = await page.evaluate(() => {
    const m = Object.values(window.__or.editor.project.media).find(x => x.origin === "speech");
    return { path: m.path, seconds: m.duration / 1e6 };
  });
  console.log("speech made in", ((Date.now() - t0) / 1000).toFixed(0), "s:", JSON.stringify(r));
  await shot("speech-done");
}
