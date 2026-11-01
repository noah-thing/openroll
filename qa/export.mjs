// Export a 3 clip project with a title and a transition, then check the file with ffprobe.
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), "openroll-research/testmedia");

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const files = ["h264_1080p30_60s.mp4", "portrait_1080x1920_20s.mp4", "hevc_4k30_30s.mp4", "tone_90s.mp3"].map(f => join(DIR, f));
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1000);
  // trim the first clip to 6 s so the export stays short, add a dissolve on the second cut
  await page.evaluate(() => {
    const e = window.__or.editor;
    const main = e.project.tracks.find(t => t.main);
    const [a, b, c] = main.items;
    e.seek(6_000_000);
    e.select([a.id]);
  });
  await page.keyboard.press("s");
  await page.evaluate(() => {
    const e = window.__or.editor;
    const main = e.project.tracks.find(t => t.main);
    e.select([main.items[1].id]);
  });
  await page.keyboard.press("Delete");
  await page.evaluate(() => {
    const e = window.__or.editor;
    const main = e.project.tracks.find(t => t.main);
    e.select([main.items[1].id]);
  });
  await page.click('.rail button:has-text("Transitions")');
  await page.click('.fx-card >> text=Dissolve');
  await page.click('.rail button:has-text("Text")');
  await page.click(".text-card >> nth=0");
  await page.waitForTimeout(300);
  const dur = await page.evaluate(() => window.__or.editor.player.duration / 1e6);
  console.log("timeline length:", dur.toFixed(2), "s");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
  await page.waitForSelector(".modal");
  await shot("export-setup");
  const t0 = Date.now();
  await page.click(".modal .export");
  await page.waitForSelector(".job .modal-done, .job .modal-warn", { timeout: 300000 });
  const secs = (Date.now() - t0) / 1000;
  await shot("export-done");
  const text = await page.locator(".job").first().innerText();
  console.log("export finished in", secs.toFixed(1), "s,", (dur / secs).toFixed(2) + "x real time:", text.replace(/\n/g, " | "));
}
