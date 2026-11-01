// Chroma key with the viewer eyedropper, then an imported LUT and the curves editor.
// usage: LOOK_KEY_IMAGE=/path/to/greenscreen.png LOOK_LUT=/path/to/file.cube node qa/launch.mjs qa/look-key.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STILLS = "/Users/noahmalekani/openroll/design/directions/footage";

export default async function ({ page, shot }) {
  await page.setViewportSize?.({ width: 1440, height: 900 });
  await page.waitForSelector(".home");
  const files = [process.env.LOOK_KEY_IMAGE, join(STILLS, "coffee.jpg")];
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);

  // Put the coffee picture on a track under the green screen so the key shows through to something.
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.apply("qa", p => {
      const n = structuredClone(p);
      const second = n.tracks[0].items.pop();
      n.tracks.push({ id: "under", kind: "video", name: "Under", items: [{ ...second, start: 0 }] });
      return n;
    });
  });
  await page.waitForTimeout(500);
  await page.locator(".clip").first().click();
  await page.evaluate(() => window.__or.editor.seek(500_000));
  await page.waitForTimeout(500);
  await shot("key-0-before");

  await page.locator('.toggle:has-text("Remove a colour") .switch').click();
  await page.waitForTimeout(300);
  await page.locator('.tool:has-text("Pick from picture")').click();
  await page.waitForTimeout(300);
  const frame = await page.locator(".viewer-frame").boundingBox();
  await page.mouse.click(frame.x + frame.width * 0.05, frame.y + frame.height * 0.5);
  await page.waitForTimeout(800);
  await shot("key-1-picked");
  console.log("key colour:", await page.evaluate(() => window.__or.editor.project.tracks[0].items[0].chroma?.color));

  // LUT: feed the parsed text through the same path the Import button uses
  const lutPath = process.env.LOOK_LUT;
  if (lutPath) {
    const text = readFileSync(lutPath, "utf8");
    await page.click('.rail button:has-text("Filters")');
    await page.locator(".clip").nth(1).click().catch(() => {});
    await page.waitForTimeout(400);
    await page.evaluate(text => {
      const e = window.__or.editor;
      window.__or.importLut(e, { name: "warm", text }, e.selection[0]);
    }, text);
    await page.waitForTimeout(1200);
    await shot("key-2-lut");
    console.log("luts:", await page.evaluate(() => JSON.stringify({ luts: Object.keys(window.__or.editor.project.luts ?? {}), filters: window.__or.editor.project.tracks.flatMap(t => t.items.map(i => i.filter)) })));
  }
}
