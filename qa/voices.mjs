// Finished clips must release their audio nodes while the timeline keeps playing.
import { check, openProject } from "./lib.mjs";

export default async function ({ page }) {
  await openProject(page, ["h264_1080p30_60s.mp4"]);
  // 120 half second clips, each with sound
  await page.evaluate(() => {
    window.__or.editor.apply("Fill", p => {
      const next = structuredClone(p);
      const main = next.tracks.find(t => t.main);
      const base = main.items[0];
      main.items.length = 0;
      for (let i = 0; i < 120; i++) main.items.push({ ...structuredClone(base), id: "v" + i, start: i * 500_000, in: i * 500_000, duration: 500_000 });
      return next;
    });
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__or.editor.player.play());
  const live = () => page.evaluate(() => window.__or.editor.player.audio.voices.length);
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    peak = Math.max(peak, await live());
  }
  const t = await page.evaluate(() => window.__or.editor.player.time / 1e6);
  console.log(`played to ${t.toFixed(1)} s, voices held at the end ${await live()}, peak ${peak}`);
  check("finished clips are released", peak < 12, String(peak));
}
