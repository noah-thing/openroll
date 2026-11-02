// Template files from strangers, and applying a template more than once.
// Run with OPENROLL_QA_OUT=<folder that exists>; it is emptied first.
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, openProject, project } from "./lib.mjs";

const DIR = process.env.OPENROLL_QA_OUT;
const card = (page, name) => page.locator(".tpl-card", { has: page.locator(".tpl-name", { hasText: new RegExp(`^${name}$`) }) });
const shape = p => JSON.stringify(p.tracks.map(t => t.items.map(i => [i.id, i.start, i.duration])));

export default async function ({ app, page, userData }) {
  if (!DIR) throw new Error("set OPENROLL_QA_OUT to a folder");
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });

  // Import: nothing hostile is kept, writes nothing outside the profile, and says why in plain words.
  const good = readFileSync("templates/quote-card.openrolltemplate", "utf8");
  const file = (name, body) => (writeFileSync(join(DIR, name), body), join(DIR, name));
  const paths = [
    file("a-huge.openrolltemplate", good + " ".repeat(300_000)),
    file("b-deep.openrolltemplate", "[".repeat(200_000) + "]".repeat(200_000)),
    file("c-bad.openrolltemplate", "{nope"),
    file("d-empty.openrolltemplate", ""),
    file("e-id.openrolltemplate", good.replace(/"id": "quote-card"/, '"id": "../../../evil"').replace(/"name": "[^"]*"/, '"name": "Escape"')),
    file("f-font.openrolltemplate", good.replace(/"font": "[^"]*"/g, '"font": "Comic Sans MS"').replace(/"id": "quote-card"/, '"id": "comic"').replace(/"name": "[^"]*"/, '"name": "Comic"')),
  ];
  mkdirSync(join(DIR, "dir.openrolltemplate"));
  symlinkSync("/etc/hosts", join(DIR, "link.openrolltemplate"));
  paths.push(join(DIR, "dir.openrolltemplate"), join(DIR, "link.openrolltemplate"), "/etc/passwd", "relative.openrolltemplate", 5, null);
  const r = await app.evaluate(async ({ ipcMain }, paths) => ipcMain._invokeHandlers.get("templates:import-paths")({}, paths), paths);
  check("only the two readable files were kept", r.added.length === 2, r.added.map(t => t.id).join(", "));
  check("every refusal names the file and ends as a sentence", r.problems.length === 7 && r.problems.every(m => /^[\w.-]+: [A-Z].*\.$/.test(m)), r.problems.join(" | "));
  check("an unsafe id was replaced, nothing escaped the folder", r.added.every(t => /^[a-z0-9-]+$/.test(t.id)) && !readdirSync(userData).some(n => n.includes("evil")));
  const comic = r.added.find(t => t.name === "Comic");
  check("a font that is not bundled came in as the default", !!comic && JSON.stringify(comic).includes('"font":"Familjen Grotesk"') && !JSON.stringify(comic).includes("Comic Sans"));

  // Applying twice, then undo and redo, lands on the same timelines.
  await openProject(page);
  await page.click('.rail button:has-text("Templates")');
  await page.waitForSelector(".tpl-grid .tpl-card, .tpl-empty");
  await page.click('.seg button:has-text("Starters"), [role=radio]:has-text("Starters")');
  await page.waitForSelector(".tpl-grid .tpl-card");
  const start = await project(page);
  await card(page, "Hook title").locator(".tpl-tile").click();
  await page.waitForTimeout(500);
  const once = await project(page);
  await card(page, "Hook title").locator(".tpl-tile").click();
  await page.waitForTimeout(500);
  const twice = await project(page);
  check("the second apply added more", twice.tracks.flatMap(t => t.items).length > once.tracks.flatMap(t => t.items).length);
  await page.evaluate(() => (window.__or.editor.undo(), window.__or.editor.undo()));
  await page.waitForTimeout(300);
  check("two undos restore the start", shape(await project(page)) === shape(start));
  await page.evaluate(() => (window.__or.editor.redo(), window.__or.editor.redo()));
  await page.waitForTimeout(300);
  check("two redos restore the double apply", shape(await project(page)) === shape(twice));

  // A selection on a locked track is not swapped out, since the lock would keep the original in place.
  await page.evaluate(() => (window.__or.editor.undo(), window.__or.editor.undo()));
  await page.waitForTimeout(300);
  const clip = start.tracks.find(t => t.main).items[0].id;
  await page.evaluate(id => {
    const e = window.__or.editor;
    e.apply("Lock", p => ({ ...p, tracks: p.tracks.map(t => (t.main ? { ...t, locked: true } : t)) }));
    e.select([id]);
  }, clip);
  await card(page, "Hook title").locator(".tpl-tile").click();
  await page.waitForTimeout(500);
  const locked = await project(page);
  const uses = locked.tracks.flatMap(t => t.items).filter(i => i.type === "media" && i.mediaId === start.tracks.find(t => t.main).items[0].mediaId).length;
  check("the locked clip stays, and the template did not copy it", locked.tracks.find(t => t.main).items.some(i => i.id === clip) && uses <= 2, `${uses}`);
}
