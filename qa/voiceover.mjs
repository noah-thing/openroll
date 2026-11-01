// Voiceover with the fake microphone, then detach audio from a video clip.
// usage: node qa/launch.mjs qa/voiceover.mjs
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const infos = await page.evaluate(p => window.openroll.qa.allow(p), [join(homedir(), "openroll-research/testmedia/h264_1080p30_60s.mp4")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.evaluate(() => window.__or.editor.seek(4_000_000));

  await page.click(".rail button:nth-child(5)");
  await page.click(".aud-rec");
  await page.waitForSelector(".aud-count");
  await shot("voiceover-countin");
  await page.waitForSelector(".aud-rec.live", { timeout: 6000 });
  await page.waitForTimeout(2500);
  await shot("voiceover-recording");
  const level = await page.evaluate(() => document.querySelector(".aud-meter > span").style.transform);
  console.log("level meter while recording:", level);
  await page.click(".aud-rec");
  await page.waitForFunction(() => Object.values(window.__or.editor.project.media).some(m => m.origin === "recording"), null, { timeout: 15000 });
  const rec = await page.evaluate(() => {
    const e = window.__or.editor;
    const m = Object.values(e.project.media).find(x => x.origin === "recording");
    const item = e.project.tracks.flatMap(t => t.items).find(i => i.mediaId === m.id);
    return { path: m.path, duration: m.duration / 1e6, start: item.start / 1e6 };
  });
  console.log("recording:", JSON.stringify(rec), "file exists:", existsSync(rec.path));

  // detach audio from the video clip
  await page.evaluate(() => {
    const e = window.__or.editor;
    const v = e.project.tracks.find(t => t.main).items[0];
    e.select([v.id]);
  });
  await page.click('.tabs [role="tab"]:has-text("Audio")');
  await shot("detach-before");
  await page.click("text=Detach audio");
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const e = window.__or.editor;
    const main = e.project.tracks.find(t => t.main).items[0];
    const lane = e.project.tracks.filter(t => t.kind === "audio").flatMap(t => t.items).find(i => i.link && i.id !== main.id);
    return { videoMuted: main.muteAudio, linked: !!lane && lane.link === main.link, laneDuration: lane?.duration / 1e6 };
  });
  console.log("after detach:", JSON.stringify(after));
  await shot("detach-after");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  const undone = await page.evaluate(() => !window.__or.editor.project.tracks.find(t => t.main).items[0].muteAudio);
  console.log("undo restores the clip's sound:", undone);
}
