// Playback and scrub numbers per test file. One clip at a time on an empty project.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));

export default async function ({ page }) {
  await page.waitForSelector(".home");
  const files = readdirSync(DIR).filter(f => f.endsWith(".mp4")).map(f => join(DIR, f));
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  for (const info of infos) {
    await page.evaluate(i => window.__or.newProject([i]), info);
    await page.waitForSelector(".clip");
    await page.waitForTimeout(1500);
    const stats = () => page.evaluate(() => window.__or.editor.player.stats);

    await page.evaluate(() => window.__or.editor.player.play());
    await page.waitForTimeout(3200);
    const play = await stats();
    await page.evaluate(() => window.__or.editor.player.pause());

    // random jumps, like clicking around the ruler
    await page.evaluate(async () => {
      const e = window.__or.editor;
      const d = e.player.duration;
      for (let i = 0; i < 12; i++) {
        e.seek(Math.random() * d * 0.95);
        await new Promise(r => setTimeout(r, 120));
      }
    });
    await page.waitForTimeout(1100);
    const jumps = await stats();

    // a steady forward drag across 5 seconds, 60 updates per second
    await page.evaluate(async () => {
      const e = window.__or.editor;
      for (let i = 0; i < 60; i++) {
        e.seek(1_000_000 + i * 83_333);
        await new Promise(r => requestAnimationFrame(r));
      }
    });
    await page.waitForTimeout(1100);
    const drag = await stats();
    console.log(`${info.name.padEnd(30)} play ${play.fps} fps, ${play.late} late, worst ${play.worstMs} ms | jump seek median ${jumps.seekMs} ms p95 ${jumps.seekP95} ms | drag settle median ${drag.seekMs} ms p95 ${drag.seekP95} ms`);
    await page.evaluate(() => document.querySelector(".mark")?.click());
    await page.waitForSelector(".home");
  }
}
