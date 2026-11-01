// Renderer crash reloads and reopens the project; a killed app offers to reopen it on the next start.
import { _electron as electron } from "playwright-core";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CLIP = join(process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia"), "h264_1080p30_60s.mp4");

export default async function ({ app, page, shot }) {
  await page.waitForSelector(".home");
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  const projects = await app.evaluate(() => process.env.OPENROLL_PROJECTS_DIR);
  await page.evaluate(async path => {
    const infos = await window.openroll.qa.allow([path]);
    window.__or.newProject(infos);
  }, CLIP);
  await page.waitForSelector(".clip", { timeout: 20000 });
  await page.waitForTimeout(1500);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  // Playwright drops a crashed page, so look at the window from the main process instead.
  const probe = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("document.querySelectorAll('.clip').length + '|' + (document.querySelector('.toast')?.textContent ?? '')"));
  let seen = "";
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    seen = await probe().catch(() => "");
    if (/^[1-9]/.test(seen)) break;
  }
  console.log("after renderer crash (clips|toast):", seen);
  if (!/^[1-9]/.test(seen)) throw new Error("project was not reopened after the crash");

  // Hard kill with the project open, then start again on the same profile.
  process.kill(app.process().pid, "SIGKILL");
  await new Promise(r => setTimeout(r, 1000));
  const again = await electron.launch({
    args: [resolve("."), `--user-data-dir=${userData}`],
    env: { ...process.env, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: projects },
  });
  const p2 = await again.firstWindow();
  await p2.waitForSelector("[role=alertdialog]", { timeout: 20000 });
  console.log("prompt:", await p2.textContent("[role=alertdialog]"));
  await p2.screenshot({ path: "qa/shots/recovery-prompt.png" });
  await p2.click("[role=alertdialog] button.export");
  await p2.waitForSelector(".clip", { timeout: 20000 });
  console.log("reopened with clips:", await p2.locator(".clip").count());
  await again.close();
  // A clean exit leaves no prompt behind.
  const third = await electron.launch({
    args: [resolve("."), `--user-data-dir=${userData}`],
    env: { ...process.env, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: projects },
  });
  const p3 = await third.firstWindow();
  await p3.waitForSelector(".home");
  await p3.waitForTimeout(800);
  console.log("prompt after clean exit:", await p3.locator("[role=alertdialog]").count());
  await third.close();
}
