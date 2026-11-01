// A heavily graded clip, rendered once in the preview and once by the exporter, so the two can be compared.
// usage: mkdir -p /tmp/orx && OPENROLL_QA_OUT=/tmp/orx node qa/launch.mjs qa/look-export.mjs
import { join } from "node:path";

const STILLS = "/Users/noahmalekani/openroll/design/directions/footage";

export default async function ({ page }) {
  await page.waitForSelector(".home");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(STILLS, "coffee.jpg")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.apply("qa look", p => {
      const n = structuredClone(p);
      const it = n.tracks[0].items[0];
      it.duration = 2_000_000;
      it.transform.scale = 0.72;
      it.filter = { id: "cutting-room", amount: 0.8 };
      it.adjust = { vignette: 30, grain: 30, fade: 15, sharpen: 40, contrast: 10 };
      it.curves = { master: [{ x: 0, y: 0.04 }, { x: 0.33, y: 0.3 }, { x: 0.66, y: 0.72 }, { x: 1, y: 0.97 }] };
      it.hsl = { orange: { hue: -20, sat: 40, light: 0 } };
      it.mask = { shape: "ellipse", x: 0.05, y: 0, width: 0.8, height: 0.9, rotation: 12, feather: 0.12, invert: false };
      it.effects = [
        { id: "a", kind: "prism", amount: 0.5, params: { speed: 1 } },
        { id: "b", kind: "bloom", amount: 0.5 },
        { id: "c", kind: "raster", amount: 0.4, params: { speed: 1 } },
      ];
      it.fill = { mode: "blur", blur: 0.6 };
      return n;
    });
    e.seek(1_000_000);
  });
  await page.waitForTimeout(1200);
  await page.locator(".viewer-canvas").screenshot({ path: "qa/shots/export-preview.png" });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
  await page.waitForSelector(".modal");
  await page.click(".modal .export");
  await page.waitForSelector(".modal-done, .modal-warn", { timeout: 300000 });
  console.log((await page.locator(".modal-body").innerText()).replace(/\n/g, " | "));
}
