// Settings, report, about and version history dialogs, with screenshots.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLIP = join(process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"), "h264_1080p30_60s.mp4");

export default async function ({ app, page, shot }) {
  await page.waitForSelector(".home");
  const send = cmd => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send("menu", c), cmd);
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));

  await send("settings");
  await page.waitForSelector("[aria-label=Settings]");
  await page.waitForTimeout(600);
  await shot("dialogs-settings");
  await page.click("[role=radio]:has-text('Quarter')");
  await page.click("[role=switch][aria-label='Reduce motion']");
  await page.waitForTimeout(300);
  const saved = JSON.parse(readFileSync(join(userData, "settings.json"), "utf8"));
  if (saved.previewQuality !== "quarter" || !saved.reduceMotion) throw new Error("settings did not persist: " + JSON.stringify(saved));
  console.log("settings persisted:", JSON.stringify(saved));
  await page.keyboard.press("Escape");

  await send("report");
  await page.waitForSelector("[aria-label='Report a problem']");
  await page.fill("textarea", "Export stops at 40 percent on a 4K clip.");
  await page.waitForFunction(() => !document.querySelector(".report-system")?.textContent?.includes("Collecting"));
  await shot("dialogs-report");
  console.log(await page.textContent(".report-system"));
  await page.keyboard.press("Escape");

  await send("about");
  await page.waitForSelector("[aria-label='About OpenRoll']");
  await shot("dialogs-about");
  await page.keyboard.press("Escape");

  // History: make a project, back date an older version, restore it from the home screen.
  await page.evaluate(async path => {
    const infos = await window.openroll.qa.allow([path]);
    window.__or.newProject(infos);
  }, CLIP);
  await page.waitForSelector(".clip", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const clipsNow = await page.locator(".clip").count();
  await page.click("text=Projects", { timeout: 1000 }).catch(() => {});
  await page.evaluate(() => window.__or.editor.dispose());
  await page.reload();
  await page.waitForSelector(".home-card");
  const projectPath = await page.evaluate(async () => (await window.openroll.projects.list())[0].path);
  const text = readFileSync(projectPath, "utf8");
  const doc = JSON.parse(text);
  const hist = join(userData, "history", doc.id);
  const old = JSON.parse(text);
  old.name = "Earlier cut";
  mkdirSync(hist, { recursive: true });
  writeFileSync(join(hist, `${Date.now() - 3_600_000}.json`), JSON.stringify(old));
  writeFileSync(join(hist, `${Date.now() - 86_400_000}.json`), JSON.stringify({ ...old, name: "Yesterday" }));

  await page.hover(".home-card-wrap");
  await page.click(".home-more");
  await shot("dialogs-menu");
  await page.click("text=Restore an earlier version…");
  await page.waitForSelector(".history-list");
  await shot("dialogs-history");
  console.log("versions listed:", await page.locator(".history-list li").count());
  await page.locator(".history-list li").nth(1).click();
  await page.click("text=Restore this version");
  await page.waitForSelector(".clip", { timeout: 15000 });
  const name = await page.evaluate(() => window.__or.editor.project.name);
  console.log("restored project name:", name, "clips:", await page.locator(".clip").count(), "was", clipsNow);
  if (name !== "Earlier cut") throw new Error("restore did not bring back the older version");
}
