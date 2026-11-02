// Cut to the beat. Beats are injected so the check does not depend on detection.
import { check, openProject, project } from "./lib.mjs";

export default async function ({ page, shot }) {
  await openProject(page, ["h264_1080p30_60s.mp4", "longgop_1080p60_20s.mp4", "tone_90s.mp3"]);
  // The automatic analysis writes its own beats when it finishes, so inject after it.
  await page.waitForFunction(() => Object.values(window.__or.editor.project.media).find(m => m.kind === "audio")?.loudness !== undefined, null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    const e = window.__or.editor;
    const song = Object.values(e.project.media).find(m => m.kind === "audio");
    e.annotateMedia(song.id, { beats: Array.from({ length: 170 }, (_, i) => Math.round((0.4 + i * 0.5) * 1e6)), bpm: 120 });
  });
  await page.click('.rail button:has-text("Smart")');
  await page.click('.seg button:has-text("Cut to the beat")');
  await page.waitForSelector(".smart-body .export");
  await page.waitForTimeout(300);
  await shot("beat-01-panel");
  await page.click('.seg button:has-text("Every 2")');
  await page.click(".smart-body .export");
  await page.waitForTimeout(600);
  const p = await project(page);
  const main = p.tracks.find(t => t.main).items;
  const beats = p.media[Object.keys(p.media).find(k => p.media[k].kind === "audio")].beats;
  check("many pieces replace the two clips", main.length > 20, String(main.length));
  check("every cut lands on a beat", main.slice(1).every(i => beats.includes(i.start)));
  check("the pieces run as long as the music", Math.abs(main.at(-1).start + main.at(-1).duration - 90e6) < 150_000);
  await shot("beat-02-result");
}
