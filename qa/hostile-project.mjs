// Opens damaged but parseable project files from the home screen and checks the editor still draws them.
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { check } from "./lib.mjs";

const MEDIA = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia");

export default async function ({ page, userData }) {
  await page.waitForSelector(".home");
  const projects = join(userData, "projects");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(MEDIA, "coffee.jpg"), join(MEDIA, "speech_video_en.mp4")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.evaluate(() => window.__or.editor.apply("Name", p => ({ ...p, name: "Base" })));
  await page.waitForFunction(() => window.__or.editor.saveState === "saved", null, { timeout: 8000 });
  const good = JSON.parse(await readFile(join(projects, "Base.openroll"), "utf8"));
  const main = good.tracks.find(t => t.main);
  const one = main.items[0];

  const variants = {
    badEase: p => (p.tracks[0].items[0].keyframes = { "transform.scale": [{ t: 0, v: 1, ease: "bounce" }, null] }),
    overlapVideo: p => p.tracks[0].items.length > 1 && p.tracks[1].items.push({ ...main.items[1], id: "dup1", start: 0 }, { ...main.items[1], id: "dup2", start: 100 }),
    overlapMain: p => p.tracks[0].items.push({ ...one, id: "dup1", start: 100 }),
    imageOnAudio: p => p.tracks[1].items.push({ ...one, id: "dup1", start: 0 }),
    overlap: p => p.tracks[1].items.push({ ...one, id: "dup1", start: 0 }, { ...one, id: "dup2", start: 100 }),
    unsorted: p => p.tracks[0].items.reverse(),
    hugeTime: p => (p.tracks[0].items[0].duration = 1e15),
    negative: p => ((p.tracks[0].items[0].start = -5e6), (p.tracks[0].items[0].in = -3)),
    badFps: p => (p.settings.fps = { num: 1e9, den: 1 }),
    badTransition: p => (p.tracks[0].items[1].transitionIn = { kind: "dissolve", duration: 1e12 }),
    badLook: p => Object.assign(p.tracks[0].items[0], { mask: 5, crop: "x", effects: [null, 3], adjust: { exposure: "a" }, blend: "burn" }),
    badText: p => p.tracks[1].items.push({ id: "t1", type: "text", start: 0, duration: 2e6, transform: null, style: { text: "😀".repeat(5000), size: -4, font: 7 } }),
    thousands: p => (p.tracks[1].items = Array.from({ length: 3000 }, (_, i) => ({ ...one, id: "k" + i, start: i * 1000, duration: 900 }))),
  };
  const names = process.env.ONLY ? process.env.ONLY.split(",") : [];
  for (const [name, mutate] of Object.entries(variants)) {
    if (process.env.ONLY && !names.includes(name)) continue;
    const doc = structuredClone(good);
    if (!doc.tracks[1]) doc.tracks.push({ id: "tt", kind: "video", name: "Over", items: [] });
    mutate(doc);
    await writeFile(join(projects, name + ".openroll"), JSON.stringify(doc));
    if (!process.env.ONLY) names.push(name);
  }
  for (const name of names) {
    await page.reload();
    await page.waitForSelector(".home");
    await page.locator(".home-card", { hasText: name }).first().click();
    let ok = true;
    const stuck = setTimeout(() => {
      console.log(`FAIL ${name} froze the window`);
      process.exit(1);
    }, 40_000);
    try {
      await page.waitForSelector(".tl-ruler", { timeout: 10_000 });
      await page.evaluate(async () => {
        const ed = window.__or.editor;
        ed.seek(500_000);
        await new Promise(r => setTimeout(r, 400));
        ed.seek(2_000_000);
        await new Promise(r => setTimeout(r, 400));
      });
      ok = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(true))));
    } catch (e) {
      ok = false;
      console.log(name, String(e).split("\n")[0], await page.evaluate(() => document.querySelector(".home-error")?.textContent ?? document.body.innerText.slice(0, 300)).catch(() => "page gone"));
    }
    const info = await page.evaluate(() => {
      const p = window.__or.editor?.project;
      return p && { tracks: p.tracks.length, items: p.tracks.reduce((n, t) => n + t.items.length, 0), toast: document.querySelector(".toast")?.textContent };
    }).catch(() => null);
    clearTimeout(stuck);
    check(`${name} opens and draws`, ok, JSON.stringify(info));
    await page.click(".top .mark").catch(() => {});
    await page.waitForTimeout(300);
  }
}
