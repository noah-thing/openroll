// Walks the look panels and inspector sections on real pictures and takes screenshots.
// usage: npm run build && node qa/launch.mjs qa/look-ui.mjs
import { join } from "node:path";
import { homedir } from "node:os";

const STILLS = "/Users/noahmalekani/openroll/design/directions/footage";
const VIDEO = join(homedir(), "openroll-research/testmedia/h264_1080p30_60s.mp4");

export default async function ({ page, shot }) {
  await page.setViewportSize?.({ width: 1440, height: 900 });
  await page.waitForSelector(".home");
  const files = [join(STILLS, "coffee.jpg"), join(STILLS, "forest.jpg"), VIDEO];
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(2500);
  await page.locator(".clip").first().click();
  await page.evaluate(() => window.__or.editor.seek(1_200_000));
  await page.waitForTimeout(500);

  await page.click('.rail button:has-text("Filters")');
  await page.waitForTimeout(1200);
  await shot("ui-filters");
  await page.locator(".fx-card").nth(8).hover();
  await page.waitForTimeout(500);
  await shot("ui-filters-hover");
  await page.locator(".fx-card").nth(8).click();
  await page.waitForTimeout(500);
  await shot("ui-filters-applied");

  await page.click('.rail button:has-text("Effects")');
  await page.waitForTimeout(1200);
  await shot("ui-effects");
  await page.locator(".fx-card").nth(3).click();
  await page.locator(".fx-card").nth(10).click();
  await page.waitForTimeout(400);

  await page.click('.tabs button:has-text("Look")');
  await page.waitForTimeout(400);
  await shot("ui-look-tab");
  await page.evaluate(() => {
    const body = document.querySelector(".insp-body");
    body.scrollTop = 700;
  });
  await page.waitForTimeout(300);
  await shot("ui-look-tab-2");

  // Mask and key
  await page.click('.tabs button:has-text("Video")');
  await page.waitForTimeout(300);
  await page.locator('.seg button:has-text("Oval")').click();
  await page.waitForTimeout(500);
  await shot("ui-mask");
  await page.locator('.seg button:has-text("None")').first().click();

  await page.locator('.tool:has-text("Crop on canvas")').click();
  await page.waitForTimeout(400);
  await shot("ui-crop");
  await page.locator('.tool:has-text("Crop on canvas")').click();

  // Keyframes on scale: a diamond, move the playhead, change the value
  await page.locator(".kf").first().click();
  await page.evaluate(() => window.__or.editor.seek(2_400_000));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const e = window.__or.editor;
    const it = e.project.tracks[0].items[0];
    e.apply("qa", p => {
      const n = structuredClone(p);
      const t = n.tracks[0].items[0];
      t.keyframes["transform.scale"].push({ t: 1_200_000, v: 1.6, ease: "ease" });
      return n;
    });
  });
  await page.waitForTimeout(500);
  await shot("ui-keyframes");
  await page.click('.tabs button:has-text("Animate")');
  await page.waitForTimeout(300);
  await shot("ui-keyframe-list");
}
