// Shared helpers for timeline scenarios: open a project with test footage, read the model, find clips.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), "openroll-research/testmedia");

export async function openProject(page, names = ["h264_1080p30_60s.mp4", "longgop_1080p60_20s.mp4", "portrait_1080x1920_20s.mp4"]) {
  await page.waitForSelector(".home");
  const files = names.filter(n => readdirSync(DIR).includes(n)).map(n => join(DIR, n));
  await page.evaluate(async paths => {
    const infos = await window.openroll.qa.allow(paths);
    window.__or.newProject(infos);
  }, files);
  await page.waitForSelector(".clip", { timeout: 20000 });
  await page.waitForTimeout(600);
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
