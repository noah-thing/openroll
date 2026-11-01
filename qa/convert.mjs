// Import a ProRes file with AC-3 sound, wait for the prepared copy, then compare scrub latency on a
// 4K long GOP file with proxies off and on.
import { join } from "node:path";
import { homedir } from "node:os";
import { check } from "./lib.mjs";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));

// Stats arrive once a second with a median over that second, so collect every report while jumping around.
const jumps = page =>
  page.evaluate(async () => {
    const e = window.__or.editor;
    const d = e.player.duration;
    const seen = new Set();
    const reports = [];
    const timer = setInterval(() => {
      const s = e.player.stats;
      if (!seen.has(s) && s.seeks > 0) {
        seen.add(s);
        reports.push(s);
      }
    }, 100);
    for (let i = 0; i < 16; i++) {
      e.seek(Math.random() * d * 0.95);
      await new Promise(r => setTimeout(r, 700));
    }
    await new Promise(r => setTimeout(r, 1500));
    clearInterval(timer);
    const n = reports.reduce((a, r) => a + r.seeks, 0) || 1;
    return {
      seeks: n,
      median: Math.round(reports.reduce((a, r) => a + r.seekMs * r.seeks, 0) / n),
      p95: Math.max(0, ...reports.map(r => r.seekP95)),
    };
  });

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");

  // ProRes with AC-3 is not decodable here, so it is prepared in the background.
  const [prores] = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(DIR, "prores_ac3_720p.mov")]);
  await page.evaluate(i => window.__or.newProject([i]), prores);
  await page.waitForSelector(".clip");
  const media0 = await page.evaluate(() => Object.values(window.__or.editor.project.media)[0]);
  check("prores media flagged as prepared", media0.prepared === true, `${media0.width}x${media0.height} ${media0.videoCodec} ${media0.fps} fps, ${(media0.duration / 1e6).toFixed(2)} s`);
  await shot("convert-preparing");
  await page.waitForSelector(".clip-badge-preparing", { timeout: 5000 }).catch(() => {});
  const t0 = Date.now();
  await page.waitForFunction(() => !document.querySelector(".clip-badge-preparing"), null, { timeout: 120000 });
  console.log("prepared in", ((Date.now() - t0) / 1000).toFixed(1), "s");
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__or.editor.seek(2_000_000));
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(() => window.__or.editor.player.stats);
  check("prepared clip decodes in the preview", stats.readers >= 1 && stats.seeks >= 0, JSON.stringify(stats));
  const dataUrl = await page.evaluate(() => document.querySelector(".stage canvas, canvas")?.toDataURL?.().length ?? 0);
  console.log("canvas ready:", dataUrl > 0);
  await shot("convert-ready");

  // Proxy and scrub latency on the 4K long GOP file.
  await page.evaluate(() => document.querySelector(".mark")?.click());
  await page.waitForSelector(".home");
  const [big] = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(DIR, "longgop_4k_30s.mp4")]);
  await page.evaluate(() => window.openroll.settings.set({ proxyMode: "off" }));
  await page.evaluate(i => window.__or.newProject([i]), big);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(2000);
  const before = await jumps(page);
  console.log(`proxies off: seek median ${before.median} ms, p95 ${before.p95} ms over ${before.seeks} seeks`);

  await page.evaluate(() => window.openroll.settings.set({ proxyMode: "auto" }));
  const p0 = Date.now();
  await page.waitForSelector(".clip-badge-proxy", { timeout: 180000 });
  console.log("proxy ready in", ((Date.now() - p0) / 1000).toFixed(1), "s");
  await page.waitForTimeout(1500);
  const after = await jumps(page);
  console.log(`proxies on:  seek median ${after.median} ms, p95 ${after.p95} ms over ${after.seeks} seeks`);
  check("proxy cuts scrub latency", after.median < before.median, `${before.median} -> ${after.median} ms median`);
  await shot("convert-proxy");
}
