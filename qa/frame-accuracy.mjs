// Every exported frame is the right frame, and the sound stays on its picture, for each way a video is written.
// Run with OPENROLL_QA_OUT=<folder> so the save dialog is skipped:
//   OPENROLL_QA_OUT=/tmp/orx node qa/launch.mjs qa/frame-accuracy.mjs
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "./lib.mjs";
import { clickTimes, frameNumbers, makeClip } from "./codes.mjs";

const OUT = process.env.OPENROLL_QA_OUT;
const SECONDS = Number(process.env.FRAME_SECONDS ?? 6);

export default async function ({ page }) {
  if (!OUT) throw new Error("set OPENROLL_QA_OUT");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const clip = join(mkdtempSync(join(tmpdir(), "openroll-codes-")), "codes.mp4");
  makeClip(clip, SECONDS);

  await page.waitForSelector(".home");
  const [info] = await page.evaluate(p => window.openroll.qa.allow(p), [clip]);
  await page.evaluate(i => window.__or.newProject([i]), info);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1200);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
  await page.waitForSelector(".modal");

  let done = 0;
  for (const [label, file] of [["MP4", "Untitled.mp4"], ["WebM VP9", "Untitled.webm"], ["ProRes 422", "Untitled.mov"]]) {
    await page.click(`.modal .seg button:has-text("${label}"), .modal [role=radio]:has-text("${label}")`);
    await page.click(".modal .export");
    await page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length >= n || document.querySelector(".job .modal-warn"), ++done, { timeout: 300000 });
    const path = join(OUT, file);
    const nums = frameNumbers(path);
    check(`${label}: ${SECONDS * 30} frames, each the one expected`, nums.length === SECONDS * 30 && nums.every((n, i) => n === i), `${nums.length} frames, first ${nums[0]}, last ${nums.at(-1)}`);
    const clicks = clickTimes(path);
    const worst = Math.max(0, ...clicks.map((t, i) => Math.abs(t - i)));
    check(`${label}: ${SECONDS} clicks within 25 ms of their seconds`, clicks.length === SECONDS && worst < 0.025, `${clicks.length} clicks, worst ${(worst * 1000).toFixed(1)} ms`);
  }
}
