// Panels and dialogs at the minimum window size, for visual review.
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia");

export default async function ({ app, page, shot }) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 600));
  await page.waitForSelector(".home");
  await page.waitForTimeout(300);
  await shot("small-00-home");
  const files = ["speech_video_en.mp4", "ferry.jpg", "tone_90s.mp3"].map(n => join(DIR, n));
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);
  for (const tab of ["Media", "Audio", "Text", "Captions", "Transitions", "Filters", "Effects", "Stickers", "Smart"]) {
    await page.click(`.rail button:has-text("${tab}")`);
    await page.waitForTimeout(400);
    await shot(`small-${tab.toLowerCase()}`);
  }
  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  await shot("small-clip");
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await shot("small-cmdbar");
  await page.keyboard.press("Escape");
  await page.click("text=Export");
  await page.waitForTimeout(500);
  await shot("small-export");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  console.log("export closed by Escape:", (await page.locator(".modal").count()) === 0);
  await page.keyboard.press("Meta+,");
  await page.waitForTimeout(400);
  await shot("small-settings");
  console.log("settings open:", await page.locator(".modal").count());
}
