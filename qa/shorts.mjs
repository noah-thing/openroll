// Long video to shorts, then cut to the beat. Needs a long talking video: build one with
// SHORTS_FILE=/path/to/long_talk.mp4 (speech over several scenes, a few minutes).
import { check, openProject, project } from "./lib.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const file = process.env.SHORTS_FILE ?? join(process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia"), "speech_video_en.mp4");
  await page.evaluate(async p => window.__or.newProject(await window.openroll.qa.allow([p])), file);
  await page.waitForSelector(".clip", { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.click('.rail button:has-text("Smart")');
  await page.waitForSelector(".smart-body");
  await page.waitForTimeout(300);
  await shot("shorts-01-panel");
  await page.click('.smart-body .export:has-text("Find highlights")');
  const t0 = Date.now();
  let seen = "";
  while (!(await page.locator(".short-card").count())) {
    const label = await page.locator(".smart-progress > span").innerText().catch(() => "");
    if (label.replace(/\d+/g, "#") !== seen) {
      seen = label.replace(/\d+/g, "#");
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s]`, label);
    }
    if (Date.now() - t0 > 600000) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(800);
  const cards = await page.locator(".short-card").count();
  check("highlight cards appear", cards >= 3 && cards <= 8, `${cards} cards`);
  console.log((await page.locator(".short-info").allInnerTexts()).map(t => "  " + t.replace(/\n/g, " | ")).join("\n"));
  await shot("shorts-02-cards");
  await page.locator(".short-card").first().hover();
  await page.waitForTimeout(1500);
  check("hover plays a preview", (await page.locator(".short-card video").count()) === 1);
  await shot("shorts-03-hover");

  await page.locator(".short-card .export").first().click();
  await page.waitForFunction(() => window.__or.editor.project.settings.height === 1920, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const p = await project(page);
  const main = p.tracks.find(t => t.main).items[0];
  check("the short is a new tall project", p.settings.width === 1080 && p.settings.height === 1920 && main.duration >= 15e6 && main.duration <= 61e6, `${(main.duration / 1e6).toFixed(1)} s`);
  check("it is filled from the centre and captioned", main.transform.scale > 1.5 && p.tracks.some(t => t.name === "Captions" && t.items.length > 0), `scale ${main.transform.scale.toFixed(2)}`);
  await shot("shorts-04-short-project");
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  await shot("shorts-05-playing");
}
