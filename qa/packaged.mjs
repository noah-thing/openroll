// Starts a packaged build (fuses hardened, so no Playwright inspector) over the Chromium debugging port,
// imports a clip, plays it and reports playback stats.
// usage: node qa/packaged.mjs <path to the app executable>
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
const clip = join(process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"), "h264_1080p30_60s.mp4");
const userData = await mkdtemp(join(tmpdir(), "openroll-pkg-"));
const port = 9333;
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  env: { ...process.env, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: join(userData, "projects") },
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
  page.on("pageerror", e => console.log("[pageerror]", e.message));
  await page.waitForSelector(".home", { timeout: 20000 });
  console.log("version shown to the page:", await page.evaluate(() => window.openroll.versions.app));
  await page.evaluate(async path => {
    const infos = await window.openroll.qa.allow([path]);
    window.__or.newProject(infos);
  }, clip);
  await page.waitForSelector(".clip", { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => ({ ...window.__or.editor.player.stats, time: window.__or.editor.player.time }));
  console.log("playback:", JSON.stringify(stats));
  await page.screenshot({ path: "qa/shots/packaged-playing.png" });
  if (!(stats.time > 1_000_000)) throw new Error("playhead did not move");
  console.log("PACKAGED OK");
  await browser.close();
} finally {
  child.kill();
  await new Promise(r => setTimeout(r, 500));
  await rm(userData, { recursive: true, force: true });
}
