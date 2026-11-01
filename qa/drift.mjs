// How far the audio clock (which the playhead follows) walks away from the wall clock the
// preview worker draws by. DRIFT_SECONDS sets the length (default 60).
import { openProject } from "./lib.mjs";

export default async function ({ page }) {
  await openProject(page, ["h264_1080p30_60s.mp4"]);
  const seconds = Number(process.env.DRIFT_SECONDS ?? 60);
  await page.evaluate(() => window.__or.editor.player.play());
  await page.waitForTimeout(1000);
  const read = () => page.evaluate(() => ({ audio: window.__or.editor.player.time / 1000, wall: performance.now() }));
  const a = await read();
  for (let s = 10; s <= seconds; s += 10) {
    await page.waitForTimeout(10_000);
    const b = await read();
    console.log(`+${s}s audio minus wall: ${(b.audio - a.audio - (b.wall - a.wall)).toFixed(2)} ms`);
  }
}
