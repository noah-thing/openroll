// Imports odd files one at a time and checks the editor stays usable.
// usage: OPENROLL_HOSTILE=<folder> node qa/launch.mjs qa/hostile-media.mjs
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { check } from "./lib.mjs";

const DIR = process.env.OPENROLL_HOSTILE;

export default async function ({ page }) {
  if (!DIR) throw new Error("set OPENROLL_HOSTILE to a folder of hostile files");
  await page.waitForSelector(".home");
  await page.evaluate(() => window.__or.newProject([]));
  await page.waitForTimeout(800);
  for (const name of readdirSync(DIR).sort()) {
    const path = join(DIR, name);
    const t0 = Date.now();
    const out = await page.evaluate(async path => {
      const [info] = await window.openroll.qa.allow([path]);
      const ed = window.__or.editor;
      const before = ed.project.tracks.flatMap(t => t.items).length;
      const toasts = [];
      const orig = ed.toast.bind(ed);
      ed.toast = (m, o) => (toasts.push(m), orig(m, o));
      const done = await Promise.race([
        window.__or.importFiles(ed, [info]).then(r => r.length),
        new Promise(r => setTimeout(() => r("timeout"), 90_000)),
      ]);
      ed.toast = orig;
      const alive = await Promise.race([new Promise(r => requestAnimationFrame(() => r(true))), new Promise(r => setTimeout(() => r(false), 3000))]);
      return { done, toasts, added: ed.project.tracks.flatMap(t => t.items).length - before, alive, preparing: document.querySelectorAll(".ai-text, .clip-preparing").length };
    }, path);
    console.log(name.padEnd(18), JSON.stringify(out), `${Date.now() - t0} ms`);
    check(`${name} import returns and the window keeps drawing`, out.done !== "timeout" && out.alive);
    await page.waitForTimeout(500);
  }
  const media = await page.evaluate(() => Object.values(window.__or.editor.project.media).map(m => `${m.name} ${m.kind} ${(m.duration / 1e6).toFixed(1)}s ${m.width ?? "-"}x${m.height ?? "-"} audio=${m.hasAudio} video=${m.hasVideo}`));
  console.log(media.join("\n"));
  // Put every clip on the timeline, then play and scrub through all of it.
  await page.evaluate(async () => {
    const ed = window.__or.editor;
    for (const m of Object.values(ed.project.media)) {
      const [info] = await window.openroll.qa.allow([m.path]);
      await window.__or.importFiles(ed, [info], { place: true });
    }
  });
  await page.waitForTimeout(1500);
  const played = await page.evaluate(async () => {
    const ed = window.__or.editor;
    const end = Math.max(...ed.project.tracks.flatMap(t => t.items.map(i => i.start + i.duration)));
    for (const f of [0, 0.3, 0.9, 0.99]) {
      ed.seek(Math.round(end * f));
      await new Promise(r => setTimeout(r, 400));
    }
    return { end, items: ed.project.tracks.flatMap(t => t.items).length };
  });
  console.log("timeline", JSON.stringify(played));
  const stuck = await page.evaluate(() => [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && /^Preparing$/.test(e.textContent ?? "")).length);
  check("nothing is left in a Preparing state", stuck === 0, `${stuck} found`);
}
