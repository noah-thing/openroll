// Templates in the real app: apply a starter to selected clips, save a template, export it,
// import it back, check what lands on the timeline and that the frame renders with it.
// Run with OPENROLL_QA_OUT=/some/dir so the template dialogs skip the picker.
// Add OPENROLL_TEMPLATES_URL=http://127.0.0.1:PORT/ (a folder with index.json) to check the community tab too.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, openProject, project } from "./lib.mjs";

const OUT = process.env.OPENROLL_QA_OUT;

const panel = page => page.click('.rail button:has-text("Templates")');
const card = (page, name) => page.locator(".tpl-card", { has: page.locator(".tpl-name", { hasText: new RegExp(`^${name}$`) }) });
const history = page => page.evaluate(() => window.__or.editor.history.timeline.applied);

/** Share of pixels in a rendered frame that are not the project background. */
const frameStats = page =>
  page.evaluate(async () => {
    const e = window.__or.editor;
    const img = await e.player.snapshot(e.time, undefined, { settle: true, width: 480 });
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 20 && img.data[i] + img.data[i + 1] + img.data[i + 2] > 60) lit++;
    return { lit: lit / (img.data.length / 4), width: img.width };
  });

export default async function ({ page, userData, shot }) {
  if (!OUT) throw new Error("set OPENROLL_QA_OUT to a folder");
  await openProject(page);
  await panel(page);
  await page.waitForSelector(".tpl-grid .tpl-card");
  await page.waitForTimeout(1000);
  await shot("tpl-01-panel");
  const starters = await page.locator(".tpl-card").count();
  check("panel lists the starters", starters >= 15, `${starters}`);

  const canvases = await page.evaluate(() => [...document.querySelectorAll(".tpl-stage canvas")].map(c => {
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 80) lit++;
    return lit / (d.length / 4);
  }));
  check("every preview card drew something", canvases.length === starters && canvases.every(v => v > 0.01), `${canvases.filter(v => v <= 0.01).length} empty`);

  // Search narrows the list.
  await page.fill('input[aria-label="Search templates"]', "caption");
  await page.waitForTimeout(200);
  check("search finds the caption styles", (await page.locator(".tpl-card").count()) === 4);
  await page.fill('input[aria-label="Search templates"]', "");

  // Apply to the selected clip: it is replaced, and it is one undo step.
  const before = await project(page);
  const firstClip = before.tracks.find(t => t.main).items[0].id;
  await page.evaluate(id => window.__or.editor.select([id]), firstClip);
  const steps = await history(page);
  await card(page, "Hook title").locator(".tpl-tile").click();
  await page.waitForTimeout(800);
  let p = await project(page);
  const main = p.tracks.find(t => t.main).items;
  check("selected clip went into the template", main[0].type === "media" && main[0].mediaId === before.tracks.find(t => t.main).items[0].mediaId && main[0].id !== firstClip && main[0].duration <= 3_000_000);
  check("hook title text and underline are there", p.tracks.some(t => t.items.some(i => i.type === "text" && i.style.text === "WAIT FOR IT")) && p.tracks.some(t => t.items.some(i => i.type === "shape")));
  check("one undo step", (await history(page)) === steps + 1);
  await page.evaluate(() => window.__or.editor.seek(1_500_000));
  await page.waitForTimeout(600);
  const lit = await frameStats(page);
  check("the frame renders with the template", lit.lit > 0.15, `${(lit.lit * 100).toFixed(0)}% lit`);
  await shot("tpl-02-applied");

  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(400);
  p = await project(page);
  check("undo puts the project back", JSON.stringify(p.tracks.map(t => t.items.map(i => i.id))) === JSON.stringify(before.tracks.map(t => t.items.map(i => i.id))));

  // Nothing selected and the library has clips: three fast cuts uses them in order.
  await page.evaluate(() => window.__or.editor.select([]));
  await card(page, "Three fast cuts").locator(".tpl-tile").click();
  await page.waitForTimeout(600);
  p = await project(page);
  const used = p.tracks.flatMap(t => t.items).filter(i => i.name && i.type === "media" && i.keyframes?.["transform.scale"]);
  check("fast cuts took three library clips with punch zooms", used.length === 3, `${used.length}`);
  check("cut markers added", p.markers.length >= 3);
  await shot("tpl-03-fast-cuts");
  await page.keyboard.press("Meta+z");

  // Save the title and its clip as a template of my own.
  await page.evaluate(() => window.__or.editor.select([]));
  await card(page, "Hook title").locator(".tpl-tile").click();
  await page.waitForTimeout(500);
  const picked = await page.evaluate(() => [...window.__or.editor.selection]);
  check("applying selects what it added", picked.length >= 3, `${picked.length}`);
  await page.click('.panel-head button:has-text("Save")');
  await page.fill('input[aria-label="Template name"]', "My hook");
  await shot("tpl-04-save-form");
  await page.click('button:has-text("Save template")');
  await page.waitForSelector('.tpl-name:text-is("My hook")');
  check("saved template shows under Yours", true);
  const dir = join(userData, "templates");
  const files = existsSync(dir) ? readdirSync(dir) : [];
  check("template file is in the profile", files.length === 1 && files[0].endsWith(".openrolltemplate"), files.join());
  const saved = readFileSync(join(dir, files[0]), "utf8");
  check("saved file holds no path or media id", !/\/Users|h264_|longgop|mediaId|"path"|\.mp4/.test(saved));
  const savedJson = JSON.parse(saved);
  check("saved file has a slot, title and format", savedJson.slots.length === 1 && savedJson.format === "openroll-template" && saved.includes("WAIT FOR IT"));
  await shot("tpl-05-yours");

  // Export, then import a changed copy.
  await card(page, "My hook").hover();
  await card(page, "My hook").locator('button[aria-label="Export My hook"]').click();
  await page.waitForTimeout(500);
  const exported = readdirSync(OUT).filter(f => f.endsWith(".openrolltemplate"));
  check("export wrote a file", exported.includes("My hook.openrolltemplate"), exported.join());
  const text = readFileSync(join(OUT, "My hook.openrolltemplate"), "utf8");
  check("exported file reads back the same", JSON.stringify(JSON.parse(text)) === JSON.stringify(savedJson));

  await page.click('.panel-head button:has-text("Import")');
  await page.waitForSelector('.toast:has-text("Already in your templates")', { timeout: 5000 });
  check("importing the same file again is a no-op", (await readdirSync(dir).length) === 1);

  const copy = { ...JSON.parse(text), id: "shared-hook", name: "Shared hook", author: "Someone" };
  writeFileSync(join(OUT, "Shared hook.openrolltemplate"), JSON.stringify(copy));
  await page.click('.panel-head button:has-text("Import")');
  await page.waitForSelector('.tpl-name:text-is("Shared hook")');
  check("imported template appears and is stored", readdirSync(dir).length === 2);

  // A damaged file is refused in plain words and nothing is stored.
  writeFileSync(join(OUT, "Broken.openrolltemplate"), '{"format":"openroll-template","version":1,"name":"x"');
  await page.click('.panel-head button:has-text("Import")');
  await page.waitForSelector('.toast-error:has-text("damaged")', { timeout: 5000 });
  check("a damaged file is refused", readdirSync(dir).length === 2);

  // Apply the imported one to an empty timeline: marked empty slot, still renders.
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+z");
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.select(e.project.tracks.flatMap(t => t.items.map(i => i.id)));
    e.deleteSelection();
  });
  await page.waitForTimeout(300);
  await card(page, "Shared hook").locator(".tpl-tile").click();
  await page.waitForTimeout(800);
  p = await project(page);
  check("empty slot is marked", p.tracks.flatMap(t => t.items).some(i => i.name === "Empty slot: Clip 1"));
  await page.evaluate(() => window.__or.editor.seek(1_000_000));
  await page.waitForTimeout(600);
  await shot("tpl-06-empty-slot");

  // A caption style needs captions.
  await page.evaluate(() => window.__or.editor.select([]));
  await page.click('.tpl-tools button:has-text("Starters")');
  await card(page, "Bold yellow highlight").locator(".tpl-tile").click();
  await page.waitForSelector('.toast:has-text("no captions")');
  check("caption style says why it did nothing", true);
  await page.evaluate(() => {
    const e = window.__or.editor;
    const style = { text: "", font: "Familjen Grotesk", size: 40, weight: 400, color: "#ffffff", align: "center", lineHeight: 1.1, letterSpacing: 0 };
    e.apply("Add caption", p => ({ ...p, tracks: [{ id: "cap", kind: "text", name: "Captions", items: [{ id: "cap1", type: "caption", start: 0, duration: 3_000_000, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, style, words: [{ text: "Hello", start: 0, end: 1_000_000 }, { text: "there", start: 1_000_000, end: 2_000_000 }] }] }, ...p.tracks] }));
  });
  await card(page, "Bold yellow highlight").locator(".tpl-tile").click();
  await page.waitForTimeout(500);
  p = await project(page);
  const cap = p.tracks.flatMap(t => t.items).find(i => i.type === "caption");
  check("caption style restyled the caption", cap.style.size > 40 && cap.highlight === "#f2c23a" && cap.words.length === 2);
  await page.evaluate(() => window.__or.editor.seek(500_000));
  await page.waitForTimeout(600);
  await shot("tpl-07-caption-style");

  // Remove the imported template.
  await page.click('.tpl-tools button:has-text("Yours")');
  await card(page, "Shared hook").hover();
  await card(page, "Shared hook").locator('button[aria-label="Remove Shared hook"]').click();
  await page.waitForTimeout(400);
  check("removed template is gone from disk", readdirSync(dir).length === 1);

  // The community tab, when a test index is served.
  await page.click('.tpl-tools button:has-text("Community")');
  await page.waitForTimeout(2500);
  if (process.env.OPENROLL_TEMPLATES_URL) {
    const names = await page.locator(".tpl-name").allInnerTexts();
    check("community tab shows the served template", names.includes("Neon title"), names.join());
    check("a template the index mislabels is left out", !names.includes("Liar"));
    await card(page, "Neon title").hover();
    await card(page, "Neon title").locator('button[aria-label^="Add Neon title"]').click();
    await page.waitForTimeout(500);
    check("community template can be kept", readdirSync(dir).length === 2);
    await shot("tpl-08-community");
  } else {
    check("offline community tab fails quietly", (await page.locator(".tpl-empty").count()) === 1);
    await shot("tpl-08-community-offline");
  }
}
