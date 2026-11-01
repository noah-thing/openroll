// Plays, scrubs, edits and reopens projects for a few minutes and reports memory, open frames,
// decoders, late frames and seek latency. SOAK_SECONDS scales each phase (default 30).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia");
const SECONDS = Number(process.env.SOAK_SECONDS ?? 30);
const MB = n => Math.round(n / 1048576);
const mod = process.platform === "darwin" ? "Meta" : "Control";

export default async function ({ app, page }) {
  await page.waitForSelector(".home");
  const files = readdirSync(DIR).filter(f => /\.mp4$/.test(f) && !f.startsWith("speech")).map(f => join(DIR, f));
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);

  const sample = async label => {
    const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, ws: m.memory.workingSetSize * 1024 })));
    const sum = type => metrics.filter(m => m.type === type).reduce((a, m) => a + m.ws, 0);
    const s = await page.evaluate(() => window.__or?.editor?.player?.stats ?? null);
    const line = `${label.padEnd(16)} heap ${String(heap).padStart(4)} MB | renderer ${String(MB(sum("Tab"))).padStart(5)} MB gpu ${String(MB(sum("GPU"))).padStart(5)} MB main ${String(MB(sum("Browser"))).padStart(4)} MB`;
    console.log(s ? `${line} | fps ${s.fps} late ${s.late} readers ${s.readers} open ${s.open} decoders ${s.decoders} seek ${s.seekMs}/${s.seekP95} ms (${s.seeks})` : line);
  };

  const open = async names => {
    await page.evaluate(i => window.__or.newProject(i), infos.filter(i => !names || names.includes(i.name)));
    await page.waitForSelector(".clip");
    await page.waitForTimeout(1200);
  };
  const play = async seconds => {
    await page.evaluate(() => window.__or.editor.player.play());
    for (let t = 0; t < seconds; t += 10) {
      await page.waitForTimeout(Math.min(10, seconds - t) * 1000);
      await sample(`play +${t + 10}s`);
    }
    await page.evaluate(() => window.__or.editor.player.pause());
  };
  const scrub = async seconds => {
    // seeks at display rate to random places, as a drag across a long ruler would
    const peak = await page.evaluate(async secs => {
      const e = window.__or.editor;
      const peak = { readers: 0, decoders: 0, open: 0 };
      const end = performance.now() + secs * 1000;
      while (performance.now() < end) {
        e.scrub(Math.random() * e.player.duration);
        const s = e.player.stats;
        for (const k in peak) peak[k] = Math.max(peak[k], s[k]);
        await new Promise(r => requestAnimationFrame(r));
      }
      return peak;
    }, seconds);
    console.log(`  peak during scrub: readers ${peak.readers} decoders ${peak.decoders} open frames ${peak.open}`);
    await page.waitForTimeout(1200);
  };
  /** Repeat the first clips until the main track holds `count` of them. */
  const fill = count => page.evaluate(n => {
    window.__or.editor.apply("Fill", p => {
      const next = structuredClone(p);
      const main = next.tracks.find(t => t.main);
      const base = [...main.items];
      let at = base.at(-1).start + base.at(-1).duration;
      for (let i = 0; main.items.length < n; i++) {
        const src = base[i % base.length];
        const dur = Math.min(src.duration, 2_000_000);
        main.items.push({ ...structuredClone(src), id: "x" + i + Math.random().toString(36).slice(2), start: at, in: 0, duration: dur });
        at += dur;
      }
      return next;
    });
  }, count);

  await open();
  await sample("start");
  await play(SECONDS);

  console.log("-- scrub storm");
  await scrub(SECONDS);
  await sample("after scrub");

  console.log("-- edit churn");
  const end = Date.now() + Math.min(SECONDS, 20) * 1000;
  while (Date.now() < end) {
    await page.evaluate(() => window.__or.editor.seek(Math.random() * window.__or.editor.player.duration));
    const count = () => page.evaluate(() => window.__or.editor.project.tracks.reduce((n, t) => n + t.items.length, 0));
    const before = await count();
    await page.keyboard.press("s");
    if ((await count()) > before) await page.keyboard.press(`${mod}+z`);
    await page.waitForTimeout(60);
  }
  await sample("after edits");

  console.log("-- cuts every half second");
  await page.evaluate(() => {
    window.__or.editor.apply("Cuts", p => {
      const next = structuredClone(p);
      const main = next.tracks.find(t => t.main);
      const base = main.items.find(i => p.media[i.mediaId].width === 1920 && p.media[i.mediaId].height === 1080);
      main.items.length = 0;
      for (let i = 0; i < 120; i++) main.items.push({ ...structuredClone(base), id: "c" + i, start: i * 500_000, in: (i * 997_000) % 50_000_000, duration: 500_000 });
      return next;
    });
  });
  await page.evaluate(() => window.__or.editor.seek(0));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__or.editor.player.play());
  let late = 0, fpsMin = 99, worst = 0;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => window.__or.editor.player.stats);
    late += s.late;
    fpsMin = Math.min(fpsMin, s.fps);
    worst = Math.max(worst, s.worstMs);
    if (process.env.SOAK_VERBOSE) console.log(`    t+${i + 1}s fps ${s.fps} late ${s.late} readers ${s.readers}`);
  }
  await page.evaluate(() => window.__or.editor.player.pause());
  console.log(`  15 s over 30 cuts: ${late} late frames, slowest second ${fpsMin} fps, worst frame ${worst} ms`);
  await sample("after cuts");

  console.log("-- 500 clips");
  await fill(500);
  await page.waitForTimeout(800);
  await sample("500 clips");
  await scrub(SECONDS);
  await sample("scrub 500");
  await play(Math.min(SECONDS, 20));

  console.log("-- switch projects x20");
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => document.querySelector(".mark")?.click());
    await page.waitForSelector(".home");
    await open([infos[i % infos.length].name]);
    await page.evaluate(() => window.__or.editor.player.play());
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__or.editor.player.pause());
    if (i % 5 === 4) await sample(`switch ${i + 1}`);
  }
  await page.waitForTimeout(5000);
  await sample("settled");
}
