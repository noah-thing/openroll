// Saving, renaming, damaged files and the cache, checked against the real app and real folders.
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MEDIA = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia");
const ok = (cond, msg) => {
  if (!cond) throw new Error("FAILED: " + msg);
  console.log("ok:", msg);
};
const exists = p => access(p).then(() => true, () => false);

export default async function ({ page, userData }) {
  await page.waitForSelector(".home");
  const projects = join(userData, "projects");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(MEDIA, "coffee.jpg")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");

  // Renames that used to fail the whole save.
  const rename = async name => {
    await page.evaluate(n => window.__or.editor.apply("Rename", p => ({ ...p, name: n })), name);
    await page.waitForFunction(() => window.__or.editor.saveState === "saved", null, { timeout: 8000 });
    return page.evaluate(() => window.__or.editor.path);
  };
  const long = await rename("L".repeat(300));
  ok(long && (await exists(long)), "300 character name still saves");
  const con = await rename("CON");
  ok(con.endsWith("CON_.openroll") && (await exists(con)), "reserved name is made safe");
  const slashes = await rename("a/b\\c");
  ok(slashes.endsWith("a_b_c.openroll"), "slashes are replaced");

  // Rapid renames and edits, then close inside the autosave delay.
  for (const n of ["One", "Two", "Three"]) await page.evaluate(n => window.__or.editor.apply("Rename", p => ({ ...p, name: n })), n);
  await page.evaluate(() => window.__or.editor.apply("Rename", p => ({ ...p, name: "Final" })));
  await page.click(".top .mark");
  await page.waitForSelector(".home");
  const names = (await readdir(projects)).filter(n => n.endsWith(".openroll"));
  ok(names.length === 1 && names[0] === "Final.openroll", `one project file after rapid renames (${names})`);

  // Overlapping saves of a new project cannot overwrite each other.
  const results = await page.evaluate(async () => {
    const docs = ["A", "B", "C"].map(n => JSON.stringify({ format: "openroll", version: 1, id: "p" + n, name: "Same" }));
    return Promise.all(docs.map(d => window.openroll.projects.save(null, "Same", d)));
  });
  ok(results.every(r => r.ok) && new Set(results.map(r => r.path)).size === 3, "three new projects with one name get three files");

  // Damaged files explain themselves and are never changed.
  const path = join(projects, "Final.openroll");
  const good = await readFile(path, "utf8");
  await writeFile(join(projects, "Cut.openroll"), good.slice(0, good.length - 60));
  await writeFile(join(projects, "Future.openroll"), JSON.stringify({ ...JSON.parse(good), version: 99 }));
  await writeFile(join(projects, "Odd.openroll"), JSON.stringify({ hello: "world" }));
  await writeFile(join(projects, "Empty.openroll"), "");
  await writeFile(join(projects, "._Final.openroll"), "junk");
  await mkdir(join(projects, "Folder.openroll"));
  await page.reload();
  await page.waitForSelector(".home");
  const listed = await page.evaluate(() => window.openroll.projects.list().then(l => l.map(p => p.name)));
  ok(!listed.includes("._Final") && !listed.includes("Folder"), `list hides hidden stubs and folders (${listed})`);
  for (const name of ["Cut", "Future", "Odd", "Empty"]) {
    const before = await readFile(join(projects, name + ".openroll"), "utf8");
    const text = await page.evaluate(async n => {
      const r = (await window.openroll.projects.list()).find(p => p.name === n);
      return r ? window.openroll.projects.load(r.path) : null;
    }, name);
    ok(text === before, `${name} loads as text and is untouched`);
  }

  // A hand edited project opens, and the original is kept.
  const edited = JSON.parse(good);
  delete edited.markers;
  delete edited.settings.fps;
  await writeFile(join(projects, "Edited.openroll"), JSON.stringify(edited));
  const text = await page.evaluate(async () => {
    const r = (await window.openroll.projects.list()).find(p => p.name === "Edited");
    return window.openroll.projects.load(r.path);
  });
  ok(!!text, "edited project loads");
  ok(await exists(join(projects, "Edited.openroll.original")), "original of a repaired project is kept beside it");

  // Clearing the cache keeps sound effects that projects point at.
  const cache = join(userData, "cache");
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, "sfx-test-v1.wav"), "RIFF");
  await writeFile(join(cache, "other.bin"), "x");
  await page.evaluate(() => window.openroll.clearCache());
  const left = await readdir(cache);
  ok(left.length === 1 && left[0] === "sfx-test-v1.wav", `cache clear keeps sound effects (${left})`);
}
