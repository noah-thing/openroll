// A realistic editing state for screenshots: clips, a title, a selection.
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));

export default async function ({ page, shot }) {
  await page.setViewportSize?.({ width: 1440, height: 900 });
  await page.waitForSelector(".home");
  await shot("look-home");
  const files = ["h264_1080p30_60s.mp4", "portrait_1080x1920_20s.mp4", "hevc_4k30_30s.mp4", "tone_90s.mp3"].map(f => join(DIR, f));
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(2500);
  await page.click('.rail button:has-text("Text")');
  await page.waitForTimeout(300);
  await page.click(".text-card >> nth=0");
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__or.editor.seek(1_500_000));
  await page.waitForTimeout(600);
  await shot("look-editor-text");
  await page.click('.rail button:has-text("Transitions")');
  await page.locator(".clip-video").nth(1).click();
  await page.waitForTimeout(600);
  await shot("look-editor-clip");
}
