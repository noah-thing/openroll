// Import the test footage, play, scrub, split, export. Prints timings.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { waitForClips } from "./lib.mjs";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  await shot("01-home");
  const files = readdirSync(DIR).filter(f => /\.(mp4|mp3)$/.test(f)).map(f => join(DIR, f));
  const t0 = Date.now();
  await page.evaluate(async paths => {
    const infos = await window.openroll.qa.allow(paths);
    window.__or.newProject(infos.filter(i => !i.name.includes("4k") && !i.name.endsWith(".mp3")).slice(0, 3));
  }, files);
  await waitForClips(page);
  console.log("import to first clip on timeline:", Date.now() - t0, "ms");
  await page.waitForTimeout(2500);
  await shot("02-editor");

  await page.keyboard.press("Space");
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => window.__or.editor.player.stats);
  console.log("playback stats (1 s window):", JSON.stringify(stats));
  await shot("03-playing");
  await page.keyboard.press("Space");

  // scrub across the ruler
  const ruler = await page.locator(".tl-ruler").boundingBox();
  await page.mouse.move(ruler.x + 40, ruler.y + 10);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(ruler.x + 40 + i * 15, ruler.y + 10, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await shot("04-scrubbed");

  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  const clips = await page.locator(".clip").count();
  console.log("clips after split:", clips);
  await shot("05-split");
}
