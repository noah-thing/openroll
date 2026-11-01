// Stabilise, slow motion and motion blur on real clips, with preview frame gaps recorded.
// usage: node qa/launch.mjs qa/ai-motion.mjs   (after npm run build)
import { check, openProject } from "./lib.mjs";

export default async function ({ page, shot }) {
  await openProject(page, ["shaky_1080p.mp4"]);
  const canvas = page.locator(".viewer-canvas");
  const snap = async name => {
    await page.waitForTimeout(700);
    await canvas.screenshot({ path: `qa/shots/${name}.png` });
  };
  const patch = fields =>
    page.evaluate(f => {
      const e = window.__or.editor;
      const id = e.project.tracks[0].items[0].id;
      e.apply("qa", p => {
        const n = structuredClone(p);
        Object.assign(n.tracks[0].items.find(i => i.id === id), f);
        return n;
      });
      e.select([id]);
    }, fields);
  const seek = t => page.evaluate(t => window.__or.editor.seek(t), t);

  await patch({});
  await seek(3_000_000);
  await snap("ai-stab-0-off");

  const t0 = Date.now();
  await patch({ stabilize: { strength: 0.85 } });
  await page.locator(".insp .ai-ok").first().waitFor({ timeout: 120000 });
  console.log("stabilise analysis", ((Date.now() - t0) / 1000).toFixed(1), "s,", await page.locator(".insp .ai-ok .ai-detail").first().textContent());
  await snap("ai-stab-1-on");
  const note = await page.locator(".insp .insp-note.num").first().textContent();
  console.log(note);
  check("crop note shown", /cropped in by/.test(note ?? ""));

  await patch({ stabilize: undefined });

  // slow motion on the moving clip
  await patch({ stabilize: undefined, speed: 0.25, duration: 32_000_000 });
  for (const mode of ["blend", "flow"]) {
    await patch({ slowMotion: mode });
    await seek(2_041_000);
    await snap("ai-slow-" + mode);
  }
  // playback gap while flow is running
  await seek(1_000_000);
  await page.evaluate(() => window.__or.editor.player.play());
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => window.__or.editor.player.stats);
  console.log("slow motion flow preview", JSON.stringify(stats));
  check("worst frame under 50 ms", stats.worstMs < 50, `worst ${stats.worstMs} ms`);
  await page.evaluate(() => window.__or.editor.player.pause());

  // motion blur from animation
  await patch({ slowMotion: undefined, speed: 1, duration: 8_000_000, motionBlur: { amount: 1 }, keyframes: { "transform.x": [{ t: 1_000_000, v: -600, ease: "linear" }, { t: 1_300_000, v: 600, ease: "linear" }], "transform.scale": [{ t: 0, v: 0.5, ease: "linear" }] } });
  await seek(1_150_000);
  await snap("ai-blur-on");
  await patch({ motionBlur: undefined });
  await snap("ai-blur-off");
}
