// Screens of every library tab and inspector tab on a realistic project, for visual review.
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), "openroll-research/testmedia");
const STILLS = join(homedir(), "openroll/design/directions/footage");

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  await shot("tour-00-home");
  const files = [join(STILLS, "ferry.jpg"), join(STILLS, "coffee.jpg"), join(STILLS, "forest.jpg"), join(DIR, "speech_video_en.mp4"), join(DIR, "tone_90s.mp3")];
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__or.editor.seek(2_000_000));
  for (const tab of ["Media", "Audio", "Text", "Captions", "Transitions", "Filters", "Effects"]) {
    await page.click(`.rail button:has-text("${tab}")`);
    await page.waitForTimeout(700);
    await shot(`tour-${tab.toLowerCase()}`);
  }
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
  for (const t of await page.locator(".tabs button").allInnerTexts()) {
    await page.click(`.tabs button:has-text("${t}")`);
    await page.waitForTimeout(400);
    await shot(`tour-insp-${t.toLowerCase()}`);
  }
  await page.locator(".clip").first().click({ button: "right" });
  await page.waitForTimeout(300);
  await shot("tour-context");
}
