// Shared helpers for timeline scenarios: open a project with test footage, read the model, find clips.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia"));

export async function openProject(page, names = ["h264_1080p30_60s.mp4", "longgop_1080p60_20s.mp4", "portrait_1080x1920_20s.mp4"]) {
  await page.waitForSelector(".home");
  const files = names.filter(n => readdirSync(DIR).includes(n)).map(n => join(DIR, n));
  await page.evaluate(async paths => {
    const infos = await window.openroll.qa.allow(paths);
    window.__or.newProject(infos);
  }, files);
  await waitForClips(page);
  await page.waitForTimeout(600);
}

/** Waits for a clip to show. If none does, prints what the timeline holds before failing. */
export async function waitForClips(page, timeout = 20000) {
  try {
    await page.waitForSelector(".clip", { timeout });
  } catch (err) {
    const state = await page.evaluate(async () => {
      const p = window.__or?.editor?.project;
      return {
        media: p && Object.values(p.media).map(m => ({ name: m.name, kind: m.kind, duration: m.duration, width: m.width, height: m.height })),
        items: p && p.tracks.flatMap(t => t.items.map(i => ({ start: i.start, duration: i.duration }))),
        clips: [...document.querySelectorAll(".clip")].slice(0, 5).map(c => { const r = c.getBoundingClientRect(); return [c.className, r.x, r.y, r.width, r.height, getComputedStyle(c).display]; }),
        drawing: await Promise.race([new Promise(r => requestAnimationFrame(() => r(true))), new Promise(r => setTimeout(() => r(false), 2000))]),
        timeline: (() => { const t = document.querySelector(".timeline"); const r = t?.getBoundingClientRect(); return r && [r.width, r.height]; })(),
      };
    }).catch(e => String(e));
    console.log("no visible clip:", JSON.stringify(state));
    throw err;
  }
}

export const project = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__or.editor.project)));
export const selection = page => page.evaluate(() => [...window.__or.editor.selection]);

export async function box(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error("no box for " + selector);
  return b;
}

/** Centre of the nth clip element. */
export async function clipBox(page, n) {
  const b = await page.locator(".clip").nth(n).boundingBox();
  if (!b) throw new Error("no clip " + n);
  return b;
}

export function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}
