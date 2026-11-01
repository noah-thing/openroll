// Checks that a packaged build finds its bundled ffmpeg and can convert a ProRes file with it.
// usage: node qa/packaged-ffmpeg.mjs <path to the app executable>
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
const clip = join(homedir(), "openroll-research/testmedia/prores_ac3_720p.mov");
const userData = await mkdtemp(join(tmpdir(), "openroll-pkg-"));
const port = 9334;
// A bare PATH proves the app is not borrowing a system ffmpeg.
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: join(userData, "projects") },
  stdio: "ignore",
});

try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
    if (!browser) await new Promise(r => setTimeout(r, 500));
  }
  if (!browser) throw new Error("app did not open a debugging port");
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector(".home", { timeout: 20000 });
  console.log("status:", JSON.stringify(await page.evaluate(() => window.openroll.convert.status())));
  const [info] = await page.evaluate(p => window.openroll.qa.allow(p), [clip]);
  await page.evaluate(i => window.__or.newProject([i]), info);
  await page.waitForSelector(".clip");
  const t0 = Date.now();
  await page.waitForSelector(".clip-badge-preparing", { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".clip-badge-preparing"), null, { timeout: 120000 });
  const state = await page.evaluate(p => window.openroll.convert.existing([p]), clip);
  console.log("prepared in", ((Date.now() - t0) / 1000).toFixed(1), "s:", JSON.stringify(state[clip]?.map(s => ({ kind: s.kind, status: s.status, file: s.file }))));
} finally {
  child.kill();
  await rm(userData, { recursive: true, force: true });
}
