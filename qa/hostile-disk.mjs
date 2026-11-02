// The projects folder disappearing, going read only, and a read only project file, while the editor is open.
import { chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { check } from "./lib.mjs";

const MEDIA = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia");

export default async function ({ page, userData }) {
  await page.waitForSelector(".home");
  const projects = join(userData, "projects");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(MEDIA, "coffee.jpg")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  const edit = name => page.evaluate(n => window.__or.editor.apply("Marker", p => ({ ...p, markers: [...p.markers, { id: n, t: 1000 }] })), name);
  const state = () => page.evaluate(() => window.__or.editor.saveState);
  const settle = async want => {
    try {
      await page.waitForFunction(w => window.__or.editor.saveState === w, want, { timeout: 8000, polling: 200 });
      return true;
    } catch {
      return false;
    }
  };

  await edit("m0");
  check("first save lands", await settle("saved"));
  const path = await page.evaluate(() => window.__or.editor.path);

  await rm(projects, { recursive: true, force: true });
  await edit("m1");
  check("save recreates a deleted projects folder", await settle("saved"));
  check("file is back on disk", await stat(path).then(() => true, () => false));
  const listed = await page.evaluate(() => window.openroll.projects.list().then(l => l.length));
  check("home list works after the folder came back", listed === 1, String(listed));

  await chmod(path, 0o444);
  await edit("m2");
  check("a read only project file still saves", await settle("saved"));
  const doc = JSON.parse(await readFile(path, "utf8"));
  check("and holds the newest edit", doc.markers.length === 3, String(doc.markers.length));
  await chmod(path, 0o644);

  await chmod(projects, 0o555);
  await edit("m3");
  const failed = await settle("error");
  check("a read only folder shows Not saved", failed);
  const label = await page.locator(".saved").textContent();
  console.log("top bar says:", label);
  await chmod(projects, 0o755);
  await edit("m4");
  check("saving recovers once the folder is writable", await settle("saved"));
  check("editor still alive", (await state()) === "saved");

  // The folder removed and the media list asked for while on the home screen.
  await page.click(".top .mark");
  await page.waitForSelector(".home");
  await rm(projects, { recursive: true, force: true });
  await page.reload();
  await page.waitForSelector(".home");
  const again = await page.evaluate(() => window.openroll.projects.list().then(l => l.length));
  check("home opens with the projects folder missing", again === 0);
  await mkdir(projects, { recursive: true });
}
